import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_MERGEABLE_WORKSPACE,
  applyConflictChoice,
  mergeRangeWorkspace,
  unsyncedIds,
  type MergeableWorkspace,
} from "./workspace-merge.ts";

const base = (): MergeableWorkspace => ({
  ...EMPTY_MERGEABLE_WORKSPACE,
  rangeDays: [{ id: "day-1", departmentId: "agency-a", status: "In Progress", title: "Quals" }],
  rangeRoster: [{ id: "roster-a", rangeDayId: "day-1", officerId: "officer-a" }, { id: "roster-b", rangeDayId: "day-1", officerId: "officer-b" }],
});
const result = (officer: string, score: number) => ({ id: `result-${officer}`, rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: officer, score });

test("UX-RB-5: two instructors scoring different officers keep both results", () => {
  const server = { ...base(), results: [result("officer-a", 46)] };
  const local = { ...base(), results: [result("officer-b", 49)] };
  const { merged, conflicts, localChangesApplied } = mergeRangeWorkspace(base(), local, server);
  assert.deepEqual(merged.results, [result("officer-a", 46), result("officer-b", 49)]);
  assert.deepEqual(conflicts, []);
  assert.equal(localChangesApplied, 1);
});

test("UX-RB-5: the same score edited on both devices is a conflict; neither value is lost", () => {
  const start = { ...base(), results: [result("officer-a", 40)] };
  const server = { ...base(), results: [result("officer-a", 46)] };
  const local = { ...base(), results: [result("officer-a", 44)] };
  const { merged, conflicts } = mergeRangeWorkspace(start, local, server);
  assert.deepEqual(merged.results, [result("officer-a", 46)]);
  assert.deepEqual(conflicts, [{ collection: "results", id: "result-officer-a", local: result("officer-a", 44), server: result("officer-a", 46) }]);
  // Choosing this device puts its value back; it is then saved like any edit.
  assert.deepEqual(applyConflictChoice(merged, conflicts[0]).results, [result("officer-a", 44)]);
});

test("UX-RB-5: identical edits on both devices are not a conflict", () => {
  const server = { ...base(), results: [result("officer-a", 46)] };
  const { merged, conflicts } = mergeRangeWorkspace(base(), server, server);
  assert.deepEqual(merged, server);
  assert.deepEqual(conflicts, []);
});

test("UX-RB-5: with no changes on this device the server copy is taken as is", () => {
  const server = { ...base(), rangeDays: [{ ...base().rangeDays[0], title: "Renamed elsewhere" }] };
  const { merged, conflicts, localChangesApplied } = mergeRangeWorkspace(base(), base(), server);
  assert.deepEqual(merged, server);
  assert.deepEqual(conflicts, []);
  assert.equal(localChangesApplied, 0);
});

test("UX-RB-5: a deletion is replayed only when the other device did not change the record", () => {
  const local = { ...base(), rangeRoster: base().rangeRoster.filter((entry) => entry.id !== "roster-b") };
  assert.deepEqual(mergeRangeWorkspace(base(), local, base()).merged.rangeRoster.map((entry) => entry.id), ["roster-a"]);
  const server = { ...base(), rangeRoster: base().rangeRoster.map((entry) => (entry.id === "roster-b" ? { ...entry, attended: true } : entry)) };
  const { merged, conflicts } = mergeRangeWorkspace(base(), local, server);
  assert.deepEqual(merged.rangeRoster.map((entry) => entry.id), ["roster-a", "roster-b"]);
  assert.deepEqual(conflicts.map((conflict) => [conflict.id, conflict.local]), [["roster-b", null]]);
});

test("UX-RB-5: an offline copy with no known base never silently overwrites differing server records", () => {
  const server = { ...base(), results: [result("officer-a", 46)] };
  const offline = { ...base(), results: [result("officer-a", 30), result("officer-b", 49)] };
  const { merged, conflicts } = mergeRangeWorkspace(EMPTY_MERGEABLE_WORKSPACE, offline, server);
  assert.deepEqual(merged.results, [result("officer-a", 46), result("officer-b", 49)]);
  assert.deepEqual(conflicts.map((conflict) => conflict.id), ["result-officer-a"]);
});

test("UX-RB-6: a result is Saved only when the server holds exactly that version", () => {
  const synced = [result("officer-a", 46)];
  assert.deepEqual([...unsyncedIds(synced, [result("officer-a", 46)])], []);
  assert.deepEqual([...unsyncedIds(synced, [result("officer-a", 47), result("officer-b", 49)])], ["result-officer-a", "result-officer-b"]);
});

test("review M2 / ba6bccf R4-H1: each distinct value this device held is kept; agreement drops it", async () => {
  const { reconcileConflicts } = await import("./workspace-merge.ts");
  const W = (score: number) => ({ ...base(), results: [result("officer-a", score)] });
  const first = mergeRangeWorkspace(W(40), W(44), W(46)).conflicts;
  const second = mergeRangeWorkspace(W(46), W(48), W(47)).conflicts;
  const conflicts = reconcileConflicts(first, second, W(47));
  assert.deepEqual(conflicts.map((conflict) => [conflict.local?.score, conflict.server?.score]), [[44, 47], [48, 47]], "neither of this device's values is lost");
  assert.deepEqual(reconcileConflicts(conflicts, first, W(47)).length, 2, "the same value is listed once");
  assert.deepEqual(reconcileConflicts(conflicts, [], W(48)).map((conflict) => conflict.local?.score), [44], "the value now in use drops its conflict");
});

test("review P8: records without a string id are never collapsed or duplicated", () => {
  const unkeyed = { note: "x" };
  const server = { ...EMPTY_MERGEABLE_WORKSPACE, malfunctions: [unkeyed, { ...unkeyed }] };
  assert.equal(mergeRangeWorkspace(server, server, server).merged.malfunctions.length, 2);
  const numeric = mergeRangeWorkspace(
    { ...EMPTY_MERGEABLE_WORKSPACE, results: [{ id: 7, score: 1 }] },
    { ...EMPTY_MERGEABLE_WORKSPACE, results: [{ id: 7, score: 2 }] },
    { ...EMPTY_MERGEABLE_WORKSPACE, results: [{ id: 7, score: 1 }] },
  );
  assert.deepEqual(numeric.merged.results, [{ id: 7, score: 2 }]);
});

test("review R2-M1 / 3177a83 P1 / ba6bccf R4-H2: neither choice writes a stale value; this device's entry is applied whole", () => {
  const conflict = { collection: "results" as const, id: "result-officer-a", local: { ...result("officer-a", 43), passed: true, deficiencyObserved: false }, server: { ...result("officer-a", 30), passed: false, deficiencyObserved: true } };
  // The record changed after the conflict (later edit, or a rebuilt row); the conflict stands.
  const now = { ...base(), results: [{ ...result("officer-a", 48), passed: true, instructorId: "instructor-a" }] };
  assert.equal(applyConflictChoice(now, conflict, "server"), now, "Keep the current value writes nothing");
  const chosen = applyConflictChoice(now, conflict, "local").results[0];
  assert.deepEqual([chosen.score, chosen.passed, chosen.deficiencyObserved], [43, true, false], "score and outcome come from the same entry");
});

test("review 2c073ae H1: Keep the current value writes nothing, even when this device's entry listed a malfunction", () => {
  const conflict = { collection: "results" as const, id: "result-officer-a", local: { ...result("officer-a", 31), malfunctionIds: ["m-local"] }, server: result("officer-a", 46) };
  const now = { ...base(), results: [result("officer-a", 46)] };
  assert.equal(applyConflictChoice(now, conflict, "server"), now);
  assert.deepEqual(applyConflictChoice(now, conflict, "local").results[0], conflict.local, "this device's whole entry");
});
