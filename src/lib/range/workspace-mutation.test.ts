import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeRangeWorkspaceMutation,
  rangeWorkspaceVersionConflict,
  withRangeResultRevisions,
} from "./workspace-mutation.ts";
import { withStoredCopiesOfUnchangedRecords } from "./workspace-client-state.ts";

const base = () => ({
  rangeDays: [{ id: "day-1", departmentId: "agency-a", status: "Planned", packetStatus: "Needs Setup" }],
  drillLibrary: [{ id: "template-1", departmentId: "agency-a", name: "Baseline", status: "Active" }],
  rangeDayDrills: [{ id: "drill-1", rangeDayId: "day-1", sourceTemplateId: "template-1" }],
  rangeRoster: [{ id: "roster-1", rangeDayId: "day-1", officerId: "officer-1" }],
  results: [],
  malfunctions: [],
});
test("range managers may edit planning records in their agency", () => {
  const existing = base();
  const next = { ...existing, rangeDays: [{ ...existing.rangeDays[0], title: "Updated" }] };
  assert.deepEqual(authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: next,
    departmentId: "agency-a",
    permissions: ["manage_range_days"],
  }), { ok: true, mode: "manage" });
});

test("viewers and participants cannot forge direct planning updates", () => {
  const existing = base();
  const next = { ...existing, rangeDayDrills: [] };
  const decision = authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: next,
    departmentId: "agency-a",
    permissions: [],
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 403);
});

test("scorers can add results but cannot edit range days, rosters, or drills", () => {
  const existing = base();
  const scored = { ...existing, results: [{ id: "result-1", rangeDayId: "day-1", drillId: "drill-1" }] };
  assert.deepEqual(authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: scored,
    departmentId: "agency-a",
    permissions: ["score_range_days"],
  }), { ok: true, mode: "score" });

  const forged = { ...scored, rangeDayDrills: [] };
  const denied = authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: forged,
    departmentId: "agency-a",
    permissions: ["score_range_days"],
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);
});

test("cross-agency payloads and orphaned associations are denied", () => {
  for (const nextWorkspace of [
    { ...base(), rangeDays: [{ ...base().rangeDays[0], departmentId: "agency-b" }] },
    { ...base(), rangeDayDrills: [{ id: "drill-x", rangeDayId: "other-day" }] },
  ]) {
    const decision = authorizeRangeWorkspaceMutation({
      existingWorkspace: base(),
      nextWorkspace,
      departmentId: "agency-a",
      permissions: ["manage_range_days"],
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  }
});

test("completed history cannot be rewritten", () => {
  const existing = { ...base(), rangeDays: [{ ...base().rangeDays[0], status: "Completed" }], results: [{ id: "result-1", rangeDayId: "day-1", score: 90 }] };
  const next = { ...existing, results: [{ ...existing.results[0], score: 100 }] };
  const decision = authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: next,
    departmentId: "agency-a",
    permissions: ["manage_range_days", "score_range_days"],
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 409);
});

test("saved results and malfunction evidence cannot be removed from editable days", () => {
  const existing = {
    ...base(),
    results: [{ id: "result-1", rangeDayId: "day-1", drillId: "drill-1", score: 90 }],
    malfunctions: [{ id: "malfunction-1", rangeDayId: "day-1", drillRunResultId: "result-1" }],
  };
  for (const nextWorkspace of [
    { ...existing, results: [] },
    { ...existing, malfunctions: [] },
  ]) {
    const decision = authorizeRangeWorkspaceMutation({
      existingWorkspace: existing,
      nextWorkspace,
      departmentId: "agency-a",
      permissions: ["manage_range_days", "score_range_days"],
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 409);
  }
});

// Regression scenarios from the reconciliation harness (R3 evidence/verify-range.ts),
// asserting the corrected behaviour. `regeneratedSave` reproduces the payload the
// web page built before B3 (and that a native client may still send): new result
// IDs for every re-saved officer. `stableSave` is the corrected web payload.
const DEPT = "dept-1";
const INSTRUCTOR = ["score_range_days"];
const RANGE_MASTER = ["manage_range_days", "score_range_days"];
const ADMIN = ["administer_department", "manage_range_days", "score_range_days", "manage_qualifications"];
type Row = Record<string, unknown>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function rangeWorkspace(dayOverrides: Row = {}) {
  return {
    rangeDays: [{ id: "range-1", departmentId: DEPT, title: "Q4 Qual", date: "2026-10-20", status: "In Progress", packetStatus: "Not Started", attendanceMode: "scheduled_roster", ...dayOverrides } as Row],
    drillLibrary: [{ id: "tpl-1", departmentId: DEPT, name: "Annual Handgun Qualification", defaultRunCount: 2 } as Row],
    rangeDayDrills: [{ id: "drill-1", rangeDayId: "range-1", name: "Annual Handgun Qualification", runCount: 2 } as Row],
    rangeRoster: [
      { id: "roster-1", rangeDayId: "range-1", officerId: "officer-A", attended: true, assignedFirearmIds: ["fa-1"] },
      { id: "roster-2", rangeDayId: "range-1", officerId: "officer-B", attended: true, assignedFirearmIds: ["fa-2"] },
    ] as Row[],
    results: [] as Row[],
    malfunctions: [] as Row[],
  };
}
type RangeWorkspace = ReturnType<typeof rangeWorkspace>;
const sameKey = (result: Row, officerId: string) =>
  result.rangeDayId === "range-1" && result.drillId === "drill-1" && result.runNumber === 1 && result.officerId === officerId;

function saveRun(ws: RangeWorkspace, now: number, scores: Record<string, number>, stable: boolean, malfunction: { officerId?: string; type?: string } = {}) {
  const next = clone(ws);
  const replaced = new Set<unknown>();
  const malfunctions: Row[] = [];
  const saved = next.rangeRoster.filter((entry) => entry.attended).flatMap((entry, index) => {
    const officerId = String(entry.officerId);
    if (!(officerId in scores)) return [];
    const existing = next.results.find((result) => sameKey(result, officerId));
    if (existing) replaced.add(existing.id);
    const id = stable && existing ? existing.id : `result-${now}-${index}`;
    const existingMalfunction = next.malfunctions.find((item) => item.drillRunId === existing?.id);
    const malfunctionId = malfunction.officerId === officerId ? (stable && existingMalfunction ? existingMalfunction.id : `malfunction-${now}-${index}`) : undefined;
    if (malfunctionId) malfunctions.push({ ...(stable ? existingMalfunction : {}), id: malfunctionId, departmentId: DEPT, firearmId: "fa-1", officerId, rangeDayId: "range-1", drillRunId: id, type: malfunction.type ?? "Failure to Feed", removedFromService: malfunction.type === "Catastrophic Failure", inspectionRequired: true, notes: "" });
    return [{ id, rangeDayId: "range-1", drillId: "drill-1", officerId, firearmId: "fa-1", runNumber: 1, completed: true, score: scores[officerId], passed: scores[officerId] >= 200, instructorId: "instr-1", malfunctionIds: malfunctionId ? [malfunctionId] : [] }];
  });
  if (stable) {
    const byId = new Map(saved.map((result) => [result.id, result]));
    next.results = [...next.results.map((result) => byId.get(result.id) ?? result), ...saved.filter((result) => !next.results.some((item) => item.id === result.id))];
    const malfunctionsById = new Map(malfunctions.map((item) => [item.id, item]));
    next.malfunctions = [...next.malfunctions.map((item) => malfunctionsById.get(item.id) ?? item), ...malfunctions.filter((item) => !next.malfunctions.some((existing) => existing.id === item.id))];
  } else {
    next.results = [...next.results.filter((result) => !saved.some((item) => sameKey(result, String(item.officerId)))), ...saved];
    next.malfunctions = [...next.malfunctions.filter((item) => !replaced.has(item.drillRunId)), ...malfunctions];
  }
  return next;
}

function decide(existing: unknown, next: unknown, permissions: string[]) {
  const decision = authorizeRangeWorkspaceMutation({ existingWorkspace: existing, nextWorkspace: next, departmentId: DEPT, permissions });
  return decision.ok ? `ok:${decision.mode}` : `${decision.status} ${decision.error}`;
}

const revise = <T extends object>(existing: unknown, next: T) =>
  withRangeResultRevisions({ existingWorkspace: existing, nextWorkspace: next, revisedAt: "2026-10-20T12:00:00.000Z", revisedByUserId: "user-1" });

test("RNG-01: a score correction or same-day re-shoot is accepted for every scoring role and keeps the old result", () => {
  const empty = rangeWorkspace();
  const first = saveRun(empty, 1000, { "officer-A": 2240, "officer-B": 230 }, false);
  assert.equal(decide(empty, first, INSTRUCTOR), "ok:score"); // 1a
  const regenerated = saveRun(first, 2000, { "officer-A": 224, "officer-B": 230 }, false);
  assert.equal(decide(first, regenerated, INSTRUCTOR), "ok:score"); // 1b
  assert.equal(decide(first, regenerated, RANGE_MASTER), "ok:manage"); // 1c
  assert.equal(decide(first, regenerated, ADMIN), "ok:manage"); // 1d
  const stable = saveRun(first, 2000, { "officer-A": 224, "officer-B": 230 }, true);
  assert.deepEqual(stable.results.map((result) => result.id), first.results.map((result) => result.id));
  assert.equal(decide(first, stable, INSTRUCTOR), "ok:score"); // 1e
  const reshoot = saveRun(first, 3000, { "officer-A": 240 }, false);
  assert.equal(decide(first, reshoot, INSTRUCTOR), "ok:score"); // 1f

  const stored = revise(first, regenerated);
  assert.deepEqual(stored.resultRevisions.map((revision) => [revision.recordId, revision.replacedById, (revision.previous as Row).score]), [
    ["result-1000-0", "result-2000-0", 2240],
    ["result-1000-1", "result-2000-1", 230],
  ]);
  const storedInPlace = revise(first, stable);
  assert.deepEqual(storedInPlace.resultRevisions.map((revision) => [revision.recordId, revision.replacedById, (revision.previous as Row).score]), [
    ["result-1000-0", "result-1000-0", 2240],
  ]);
});

test("RNG-01: saved results still cannot be deleted without a replacement", () => {
  const scored = saveRun(rangeWorkspace(), 7000, { "officer-A": 230, "officer-B": 220 }, true);
  const deleted = { ...clone(scored), results: scored.results.filter((result) => result.officerId !== "officer-B") };
  assert.match(decide(scored, deleted, ADMIN), /^409 Saved scores/);
  const otherKey = clone(scored);
  otherKey.results[1] = { ...otherKey.results[1], id: "result-x", runNumber: 2 };
  assert.match(decide(scored, otherKey, ADMIN), /^409 Saved scores/);
  const malfunctionOnly = saveRun(rangeWorkspace(), 8000, { "officer-A": 150 }, true, { officerId: "officer-A" });
  assert.match(decide(malfunctionOnly, { ...clone(malfunctionOnly), malfunctions: [] }, ADMIN), /^409 Saved scores/);
});

test("RNG-01: the revision history is append-only and cannot be shrunk or forged by a client", () => {
  const first = saveRun(rangeWorkspace(), 1000, { "officer-A": 2240 }, true);
  const corrected = revise(first, saveRun(first, 2000, { "officer-A": 224 }, true));
  assert.equal(corrected.resultRevisions.length, 1);
  const forged = { ...clone(corrected), results: corrected.results, resultRevisions: [], result_revisions: [{ id: "fake" }] };
  const stored = revise(corrected, forged);
  assert.deepEqual(stored.resultRevisions, corrected.resultRevisions);
  assert.equal("result_revisions" in stored, false);
  const native = revise(corrected, { ...first, results: corrected.results }); // client that never sends the history
  assert.deepEqual(native.resultRevisions, corrected.resultRevisions);
});

test("RNG-03: packet Ready is a planning milestone and does not lock the day", () => {
  const planned = rangeWorkspace({ status: "Planned", packetStatus: "In Progress" });
  const ready = clone(planned); ready.rangeDays[0].packetStatus = "Ready";
  assert.equal(decide(planned, ready, RANGE_MASTER), "ok:manage"); // 3a
  const scored = saveRun(ready, 4000, { "officer-A": 230 }, true);
  assert.equal(decide(ready, scored, INSTRUCTOR), "ok:score"); // 3b
  assert.equal(decide(ready, scored, ADMIN), "ok:manage"); // 3c
  const started = clone(ready); started.rangeDays[0].status = "In Progress";
  assert.equal(decide(ready, started, ADMIN), "ok:manage"); // 3d
  const unready = clone(ready); unready.rangeDays[0].packetStatus = "In Progress";
  assert.equal(decide(ready, unready, ADMIN), "ok:manage"); // 3e
  const attendance = clone(ready); attendance.rangeRoster[0].attended = false;
  assert.equal(decide(ready, attendance, RANGE_MASTER), "ok:manage"); // 3f
});

test("RNG-04: Completed and Archived remain final (amendment is deferred)", () => {
  const scored = saveRun(rangeWorkspace(), 5000, { "officer-A": 230, "officer-B": 190 }, true);
  const completed = clone(scored); completed.rangeDays[0].status = "Completed";
  assert.equal(decide(scored, completed, RANGE_MASTER), "ok:manage"); // 4a
  const edit = clone(completed); edit.results[1].score = 210;
  const aar = clone(completed); aar.rangeDays[0].aar = { lessons: "x" };
  const reopen = clone(completed); reopen.rangeDays[0].status = "In Progress";
  const archived = clone(completed); archived.rangeDays[0].status = "Archived";
  for (const next of [edit, aar, reopen, archived]) assert.match(decide(completed, next, ADMIN), /^409 Completed/); // 4b-4e
  const archivedBase = clone(scored); archivedBase.rangeDays[0].status = "Archived";
  const restore = clone(archivedBase); restore.rangeDays[0].status = "Planned";
  assert.match(decide(archivedBase, restore, ADMIN), /^409 Completed/); // 4f
});

test("RNG-13: two devices — evidence is protected and a stale base version is detected", () => {
  const base = rangeWorkspace();
  const deviceA = saveRun(base, 6000, { "officer-A": 230 }, true);
  const deviceB = clone(base);
  deviceB.results.push({ id: "result-6001-1", rangeDayId: "range-1", drillId: "drill-1", officerId: "officer-B", runNumber: 1, completed: true, score: 220, passed: true, instructorId: "instr-2", malfunctionIds: [] });
  assert.equal(decide(base, deviceA, INSTRUCTOR), "ok:score"); // 13a
  assert.match(decide(deviceA, deviceB, INSTRUCTOR), /^409 Saved scores/); // 13b (A's result is not lost)
  const merged = clone(deviceA); merged.results.push(deviceB.results[0]);
  assert.equal(decide(deviceA, merged, INSTRUCTOR), "ok:score"); // 13c
  // 13d: a stale planning write passes the evidence rules, so the base version must stop it.
  const loadedAt = "2026-10-20T12:00:00.000Z";
  const afterA = "2026-10-20T12:00:05.123Z";
  assert.equal(rangeWorkspaceVersionConflict(loadedAt, afterA), true);
  assert.equal(rangeWorkspaceVersionConflict(loadedAt, new Date(loadedAt)), false);
  assert.equal(rangeWorkspaceVersionConflict(loadedAt, "2026-10-20 12:00:00+00"), false);
  assert.equal(rangeWorkspaceVersionConflict(null, null), false);
  assert.equal(rangeWorkspaceVersionConflict(null, afterA), true);
  assert.equal(rangeWorkspaceVersionConflict(loadedAt, null), true);
  assert.equal(rangeWorkspaceVersionConflict("not-a-date", afterA), true);
  assert.equal(rangeWorkspaceVersionConflict(undefined, afterA), false); // clients that send no base keep working
});

test("RNG-11: load normalization that the user did not change is not sent back", () => {
  const legacy = rangeWorkspace({ status: "Completed" }); delete legacy.rangeDays[0].attendanceMode;
  const normalizedDays: Row[] = legacy.rangeDays.map((day) => ({ ...day, attendanceMode: "scheduled_roster" }));
  const raw = { ...clone(legacy), rangeDays: normalizedDays };
  assert.match(decide(legacy, raw, RANGE_MASTER), /^409/); // what the page used to send
  const sent = { ...clone(legacy), rangeDays: withStoredCopiesOfUnchangedRecords(normalizedDays, normalizedDays, legacy.rangeDays) };
  assert.equal(decide(legacy, sent, RANGE_MASTER), "ok:manage"); // 11a
  const library = rangeWorkspace();
  const normalizedLibrary: Row[] = library.drillLibrary.map((item) => ({ ...item, defaultRunCount: 1 }));
  const scored = saveRun(library, 9000, { "officer-A": 230 }, true);
  assert.match(decide(library, { ...scored, drillLibrary: normalizedLibrary }, INSTRUCTOR), /^403/);
  const scorerSent = { ...scored, drillLibrary: withStoredCopiesOfUnchangedRecords(normalizedLibrary, normalizedLibrary, library.drillLibrary) };
  assert.equal(decide(library, scorerSent, INSTRUCTOR), "ok:score"); // 11b
});

test("RNG-22: roster removal keeps saved results", () => {
  const scored = saveRun(rangeWorkspace(), 7000, { "officer-A": 230, "officer-B": 220 }, true);
  const rosterOnly = clone(scored); rosterOnly.rangeRoster = rosterOnly.rangeRoster.filter((entry) => entry.officerId !== "officer-B");
  assert.equal(decide(scored, rosterOnly, RANGE_MASTER), "ok:manage"); // 22a (corrected client)
  const withResults = clone(rosterOnly); withResults.results = withResults.results.filter((result) => result.officerId !== "officer-B");
  assert.match(decide(scored, withResults, RANGE_MASTER), /^409 Saved scores/); // deleting them is still refused
});

test("RNG-23: re-saving a line keeps the malfunction record and its history", () => {
  const withMalfunction = saveRun(rangeWorkspace(), 8000, { "officer-A": 150 }, false, { officerId: "officer-A", type: "Catastrophic Failure" });
  const regenerated = saveRun(withMalfunction, 9000, { "officer-A": 150, "officer-B": 230 }, false, { officerId: "officer-A", type: "Failure to Feed" });
  assert.equal(decide(withMalfunction, regenerated, INSTRUCTOR), "ok:score"); // 23a (native-style payload)
  const stored = revise(withMalfunction, regenerated);
  assert.deepEqual(stored.resultRevisions.filter((revision) => revision.collection === "malfunctions").map((revision) => (revision.previous as Row).type), ["Catastrophic Failure"]);
  const stable = saveRun(withMalfunction, 9000, { "officer-A": 150, "officer-B": 230 }, true, { officerId: "officer-A", type: "Catastrophic Failure" });
  assert.equal(decide(withMalfunction, stable, INSTRUCTOR), "ok:score");
  assert.deepEqual(stable.malfunctions.map((item) => [item.id, item.type]), [["malfunction-8000-0", "Catastrophic Failure"]]);
  assert.equal(revise(withMalfunction, stable).resultRevisions.length, 0);
  const cleared = clone(stable); cleared.malfunctions = []; cleared.results[0].malfunctionIds = [];
  assert.equal(decide(withMalfunction, cleared, INSTRUCTOR), "ok:score"); // correcting a mis-recorded malfunction
  assert.equal(revise(withMalfunction, cleared).resultRevisions.length, 2);
});

test("both range workspace PUT routes check the client base version and store the revision history", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["src/app/api/pilot/range-workspace/route.ts", "src/app/api/mobile/range-workspace/route.ts"]) {
    const source = await readFile(file, "utf8");
    const put = source.slice(source.indexOf("export async function PUT"));
    assert.ok(put.indexOf("rangeWorkspaceVersionConflict(body.baseUpdatedAt") > 0, file);
    assert.ok(put.indexOf("rangeWorkspaceVersionConflict") < put.indexOf("authorizeRangeWorkspaceMutation("), file);
    assert.match(put, /code: "stale_workspace"/);
    assert.match(put, /const workspace = withRangeResultRevisions\(/);
    assert.match(put, /updatedAt[,}]/);
  }
});
