// Scratch verification of RNG-01/03/04/13 (+11, 22, 23) against the CURRENT worktree
// (origin/codex/staging-mobile-api-release-20261007 @ 555f061). Read-only: imports the module, writes nothing.
import { authorizeRangeWorkspaceMutation } from "/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current/src/lib/range/workspace-mutation.ts";

const DEPT = "dept-1";
const INSTRUCTOR = ["score_range_days"]; // role `instructor`
const RANGE_MASTER = ["manage_range_days", "score_range_days"];
const ADMIN = ["administer_department", "manage_range_days", "score_range_days", "manage_qualifications"];

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function baseWorkspace(dayOverrides: Record<string, unknown> = {}) {
  return {
    rangeDays: [{ id: "range-1", departmentId: DEPT, title: "Q4 Qual", date: "2026-10-20", status: "In Progress", packetStatus: "Not Started", attendanceMode: "scheduled_roster", ...dayOverrides }],
    drillLibrary: [{ id: "tpl-1", departmentId: DEPT, name: "Annual Handgun Qualification", defaultRunCount: 2 }],
    rangeDayDrills: [{ id: "drill-1", rangeDayId: "range-1", name: "Annual Handgun Qualification", runCount: 2 }],
    rangeRoster: [
      { id: "roster-1", rangeDayId: "range-1", officerId: "officer-A", attended: true, assignedFirearmIds: ["fa-1"] },
      { id: "roster-2", rangeDayId: "range-1", officerId: "officer-B", attended: true, assignedFirearmIds: ["fa-2"] },
    ],
    results: [] as Record<string, unknown>[],
    malfunctions: [] as Record<string, unknown>[],
  };
}

// Mirrors page.tsx:3339 `result-${now}-${index}` and the filter-and-append at page.tsx:3450-3463.
function batchSave(ws: ReturnType<typeof baseWorkspace>, now: number, scores: Record<string, number>, opts: { malfunctionFor?: string; malfunctionType?: string } = {}) {
  const next = clone(ws);
  const roster = next.rangeRoster.filter((e) => e.attended);
  const replaced = new Set(next.results.filter((r) => r.rangeDayId === "range-1" && r.drillId === "drill-1" && r.runNumber === 1 && roster.some((e) => e.officerId === r.officerId)).map((r) => r.id));
  const newMal: Record<string, unknown>[] = [];
  const saved = roster.flatMap((entry, index) => {
    if (!(entry.officerId in scores)) return [];
    const id = `result-${now}-${index}`;
    const malId = opts.malfunctionFor === entry.officerId ? `malfunction-${now}-${index}` : undefined;
    if (malId) newMal.push({ id: malId, departmentId: DEPT, firearmId: entry.assignedFirearmIds[0], officerId: entry.officerId, rangeDayId: "range-1", drillRunId: id, type: opts.malfunctionType ?? "Failure to Feed", removedFromService: opts.malfunctionType === "Catastrophic Failure", inspectionRequired: true, notes: "" });
    return [{ id, rangeDayId: "range-1", drillId: "drill-1", officerId: entry.officerId, firearmId: entry.assignedFirearmIds[0], runNumber: 1, completed: true, score: scores[entry.officerId], passed: scores[entry.officerId] >= 200, instructorId: "instr-1", malfunctionIds: malId ? [malId] : [] }];
  });
  next.results = [...next.results.filter((r) => !(r.rangeDayId === "range-1" && r.drillId === "drill-1" && r.runNumber === 1 && roster.some((e) => e.officerId === r.officerId))), ...saved];
  next.malfunctions = [...next.malfunctions.filter((m) => !m.drillRunId || !replaced.has(m.drillRunId as string)), ...newMal];
  return next;
}

function decide(label: string, existing: unknown, next: unknown, permissions: string[], expected: string) {
  const decision = authorizeRangeWorkspaceMutation({ existingWorkspace: existing, nextWorkspace: next, departmentId: DEPT, permissions });
  const actual = decision.ok ? `ok:${decision.mode}` : `${decision.status} ${decision.error}`;
  const verdict = actual.startsWith(expected) ? "MATCH" : "MISMATCH";
  console.log(`[${verdict}] ${label}\n    perms=${JSON.stringify(permissions)}\n    expected(defect behaviour)=${expected}\n    actual=${actual}`);
}

console.log("=== RNG-01: score correction / same-day re-shoot re-save ===");
{
  const empty = baseWorkspace();
  const first = batchSave(empty, 1000, { "officer-A": 2240, "officer-B": 230 }); // typo 2240
  decide("1a first save of 2 results (control)", empty, first, INSTRUCTOR, "ok");
  console.log("    saved ids:", first.results.map((r) => r.id).join(", "));
  const corrected = batchSave(first, 2000, { "officer-A": 224, "officer-B": 230 }); // fix typo -> new IDs
  console.log("    corrected ids:", corrected.results.map((r) => r.id).join(", "));
  decide("1b corrected re-save (new IDs, old filtered) as instructor", first, corrected, INSTRUCTOR, "409");
  decide("1c corrected re-save as Range Master", first, corrected, RANGE_MASTER, "409");
  decide("1d corrected re-save as administrator", first, corrected, ADMIN, "409");
  const inPlace = clone(first); (inPlace.results[0] as Record<string, unknown>).score = 224;
  decide("1e control: in-place correction keeping stable ID", first, inPlace, INSTRUCTOR, "ok");
  const reshoot = batchSave(first, 3000, { "officer-A": 240 });
  decide("1f same-day re-shoot of officer-A only (new ID replaces failed attempt)", first, reshoot, INSTRUCTOR, "409");
}

console.log("\n=== RNG-03: packetStatus 'Ready' locks the day ===");
{
  const planned = baseWorkspace({ status: "Planned", packetStatus: "In Progress" });
  const ready = clone(planned); ready.rangeDays[0].packetStatus = "Ready";
  decide("3a Range Master sets packetStatus Ready the night before (allowed)", planned, ready, RANGE_MASTER, "ok");
  const scored = batchSave(ready, 4000, { "officer-A": 230 });
  decide("3b first score add on the 'Ready' (not completed) day, instructor", ready, scored, INSTRUCTOR, "409");
  decide("3c first score add on the 'Ready' day, administrator", ready, scored, ADMIN, "409");
  const startDay = clone(ready); startDay.rangeDays[0].status = "In Progress";
  decide("3d status Planned->In Progress on the Ready day", ready, startDay, ADMIN, "409");
  const unready = clone(ready); unready.rangeDays[0].packetStatus = "In Progress";
  decide("3e revert packetStatus Ready->In Progress (unlock attempt), administrator", ready, unready, ADMIN, "409");
  const attend = clone(ready); attend.rangeRoster[0].attended = false;
  decide("3f roster attendance change on the Ready day", ready, attend, RANGE_MASTER, "409");
}

console.log("\n=== RNG-04: Completed is irreversible ===");
{
  const scored = batchSave(baseWorkspace(), 5000, { "officer-A": 230, "officer-B": 190 });
  const completed = clone(scored); completed.rangeDays[0].status = "Completed";
  decide("4a set status Completed (one write, no extra checks)", scored, completed, RANGE_MASTER, "ok");
  const edit = clone(completed); (edit.results[1] as Record<string, unknown>).score = 210;
  decide("4b edit a score on the Completed day (stable ID), administrator", completed, edit, ADMIN, "409");
  const note = clone(completed); (note.rangeDays[0] as Record<string, unknown>).aar = { lessons: "x" };
  decide("4c add AAR text after close-out (RNG-21)", completed, note, ADMIN, "409");
  const reopen = clone(completed); reopen.rangeDays[0].status = "In Progress";
  decide("4d reopen Completed->In Progress, administrator", completed, reopen, ADMIN, "409");
  const archived = clone(completed); archived.rangeDays[0].status = "Archived";
  decide("4e Completed->Archived", completed, archived, ADMIN, "409");
  const archivedBase = clone(scored); archivedBase.rangeDays[0].status = "Archived";
  const restore = clone(archivedBase); restore.rangeDays[0].status = "Planned";
  decide("4f restore Archived->Planned, administrator", archivedBase, restore, ADMIN, "409");
}

console.log("\n=== RNG-13: two devices, full-document PUTs ===");
{
  const base = baseWorkspace();
  // Device A scores officer-A, device B scores officer-B, both starting from `base`.
  const deviceA = batchSave(base, 6000, { "officer-A": 230 });
  const deviceB = clone(base);
  deviceB.results.push({ id: "result-6001-1", rangeDayId: "range-1", drillId: "drill-1", officerId: "officer-B", runNumber: 1, completed: true, score: 220, passed: true, instructorId: "instr-2", malfunctionIds: [] });
  decide("13a device A PUT (server state = base)", base, deviceA, INSTRUCTOR, "ok");
  decide("13b device B PUT after A landed (server state = A), B lacks A's result", deviceA, deviceB, INSTRUCTOR, "409");
  // Opposite case: B's doc is a superset (B reloaded first) -> accepted. Not a lock-out if B re-pulls.
  const merged = clone(deviceA); merged.results.push(deviceB.results[0]);
  decide("13c control: B merges A's results then PUTs", deviceA, merged, INSTRUCTOR, "ok");
  // Silent overwrite of non-evidence fields: manager B edits planning on a stale copy -> accepted, wipes A's planning edit.
  const plannerA = clone(base); plannerA.rangeDays[0].title = "Q4 Qual - Relay plan v2";
  const plannerBStale = clone(base); plannerBStale.rangeDays[0].location = "Range 2";
  decide("13d stale planning write by B after A's title edit (lost update, accepted)", plannerA, plannerBStale, RANGE_MASTER, "ok");
}

console.log("\n=== Related: RNG-11 / RNG-22 / RNG-23 ===");
{
  const legacy = baseWorkspace({ status: "Completed" }); delete (legacy.rangeDays[0] as Record<string, unknown>).attendanceMode;
  const normalized = clone(legacy); (normalized.rangeDays[0] as Record<string, unknown>).attendanceMode = "scheduled_roster";
  decide("11a load-time normalization adds attendanceMode to a legacy Completed day", legacy, normalized, RANGE_MASTER, "409");
  const libNorm = clone(baseWorkspace()); (libNorm.drillLibrary[0] as Record<string, unknown>).defaultRunCount = 1;
  decide("11b library normalization (defaultRunCount) sent by scorer-only user", baseWorkspace(), libNorm, INSTRUCTOR, "403");
  const scored = batchSave(baseWorkspace(), 7000, { "officer-A": 230, "officer-B": 220 });
  const removed = clone(scored); removed.rangeRoster = removed.rangeRoster.filter((e) => e.officerId !== "officer-B"); removed.results = removed.results.filter((r) => r.officerId !== "officer-B");
  decide("22a roster removal that also deletes the officer's results", scored, removed, RANGE_MASTER, "409");
  const withMal = batchSave(baseWorkspace(), 8000, { "officer-A": 150 }, { malfunctionFor: "officer-A", malfunctionType: "Catastrophic Failure" });
  const resaveMal = batchSave(withMal, 9000, { "officer-A": 150, "officer-B": 230 }, { malfunctionFor: "officer-A", malfunctionType: "Failure to Feed" });
  decide("23a re-save line recreating the malfunction with new ID/type", withMal, resaveMal, INSTRUCTOR, "409");
}
