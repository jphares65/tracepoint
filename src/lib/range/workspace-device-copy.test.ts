import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_COPY_REASON,
  LEGACY_RANGE_DAY_KEYS,
  deviceCopyKey,
  readDeviceCopy,
  takeLegacyCopy,
  takeUnknownAgencyCopy,
  unattributedCopyConflicts,
  recoverWorkspace,
  usableDeviceCopy,
  writeDeviceCopy,
  type RangeDayDeviceCopy,
} from "./workspace-device-copy.ts";
import { EMPTY_MERGEABLE_WORKSPACE, UNKNOWN_BASE_REASON, type MergeableWorkspace } from "./workspace-merge.ts";

const accept = () => ({ ok: true as const });
const day = { id: "day-1", status: "In Progress" };
const roster = (id: string, officerId: string) => ({ id, rangeDayId: "day-1", officerId });
const score = (value: number) => ({ id: "result-1", rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: "officer-a", score: value });
const ws = (over: Partial<MergeableWorkspace>): MergeableWorkspace => ({ ...EMPTY_MERGEABLE_WORKSPACE, rangeDays: [day], ...over });
const memory = () => {
  const items = new Map<string, string>();
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) };
};
const copy = (over: Partial<RangeDayDeviceCopy> = {}): RangeDayDeviceCopy => ({
  version: 2, userId: "user-a", departmentId: "agency-a", tabId: "tab-1", workspace: ws({}), base: ws({}), baseUpdatedAt: "v1", conflicts: [], ...over,
});

test("review H2: the copy and its sync point are one record; a second tab's write replaces both, so a reload keeps saved work", () => {
  const storage = memory();
  const v1 = ws({ results: [score(40)], rangeRoster: [roster("roster-a", "officer-a")] });
  const v2 = ws({ results: [score(46)], rangeRoster: [roster("roster-a", "officer-a"), roster("roster-new", "officer-b")] });
  // Tab 1 saved v2; tab 2 (still on v1) then edited a title and wrote its own record.
  assert.equal(writeDeviceCopy(storage, copy({ tabId: "tab-1", workspace: v2, base: v2, baseUpdatedAt: "v2" })), true);
  const tab2 = ws({ ...v1, rangeDays: [{ ...day, title: "edited in tab 2" }] });
  writeDeviceCopy(storage, copy({ tabId: "tab-2", workspace: tab2, base: v1, baseUpdatedAt: "v1" }));
  const stored = readDeviceCopy(storage, "user-a", "agency-a")!;
  const recovered = recoverWorkspace({ base: stored.base, local: stored.workspace as MergeableWorkspace, server: v2, conflicts: stored.conflicts, accept });
  assert.equal(recovered.workspace.results[0].score, 46, "the saved correction is not reverted");
  assert.deepEqual(recovered.workspace.rangeRoster.map((entry) => entry.id), ["roster-a", "roster-new"], "the saved entry is not deleted");
  assert.equal(recovered.workspace.rangeDays[0].title, "edited in tab 2", "tab 2's own change is replayed");
});

test("review H2: a copy is used only by the same user, and never for another agency", () => {
  assert.equal(usableDeviceCopy(copy(), { userId: "user-b", departmentId: "agency-a" }), null);
  assert.equal(usableDeviceCopy(copy(), { userId: "user-a", departmentId: "agency-b" }), null);
  assert.ok(usableDeviceCopy(copy(), { userId: "user-a", departmentId: "agency-a" }));
  assert.ok(usableDeviceCopy(copy(), { userId: "user-a", departmentId: null }), "shown (not saved) while the agency is unknown");
  assert.equal(usableDeviceCopy(copy({ departmentId: null }), { userId: "user-a", departmentId: "agency-a" }), null, "review L6: a copy with no agency is not this agency's");
  assert.equal(usableDeviceCopy(copy(), { userId: "", departmentId: null }), null);
});

test("review H2: a copy that cannot be written is reported, never assumed kept", () => {
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(writeDeviceCopy(full, copy()), false);
  assert.equal(writeDeviceCopy(null, copy()), false);
  assert.equal(readDeviceCopy({ getItem: (key: string) => (key === deviceCopyKey("user-a", "agency-a") ? "{not json" : null), setItem: () => {} }, "user-a", "agency-a"), null);
});

test("review M1: with an unknown sync point nothing is replayed; a record the other device deleted is not resurrected", () => {
  const local = ws({ rangeRoster: [roster("roster-a", "officer-a"), roster("roster-x", "officer-x")], results: [score(44)] });
  const server = ws({ rangeRoster: [roster("roster-a", "officer-a")], results: [score(46)] });
  const recovered = recoverWorkspace({ base: null, local, server, conflicts: [], accept });
  assert.deepEqual(recovered.workspace, server);
  assert.deepEqual(recovered.conflicts.map((conflict) => [conflict.collection, conflict.id, conflict.reason]), [
    ["rangeRoster", "roster-x", UNKNOWN_BASE_REASON],
    ["results", "result-1", UNKNOWN_BASE_REASON],
  ]);
});

test("review M1: with no workspace on the server yet, this device's work is replayed as new", () => {
  const local = ws({ results: [score(44)] });
  const recovered = recoverWorkspace({ base: null, local, server: EMPTY_MERGEABLE_WORKSPACE, serverEmpty: true, conflicts: [], accept });
  assert.deepEqual(recovered.workspace, local);
  assert.deepEqual(recovered.conflicts, []);
});

test("review M2: an earlier conflict on a record this device edited again is superseded by the new value", () => {
  const earlier = [{ collection: "results" as const, id: "result-1", local: score(44), server: score(46) }];
  const recovered = recoverWorkspace({ base: ws({ results: [score(46)] }), local: ws({ results: [score(48)] }), server: ws({ results: [score(46)] }), conflicts: earlier, accept });
  assert.equal(recovered.workspace.results[0].score, 48);
  assert.deepEqual(recovered.conflicts, []);
});

test("review R2-H2: each user and agency has its own record; another sign-in never overwrites it", () => {
  const storage = memory();
  writeDeviceCopy(storage, copy({ userId: "user-a", workspace: ws({ results: [score(44)] }) }));
  writeDeviceCopy(storage, copy({ userId: "user-b", workspace: ws({}) }));
  writeDeviceCopy(storage, copy({ userId: "user-a", departmentId: "agency-b", workspace: ws({}) }));
  const a = readDeviceCopy(storage, "user-a", "agency-a")!;
  assert.equal((a.workspace as MergeableWorkspace).results[0].score, 44, "user A's unsynced score survives user B and another agency");
  assert.equal(readDeviceCopy(storage, "user-b", "agency-a")!.userId, "user-b");
  assert.equal(readDeviceCopy(storage, "user-a", null)!.departmentId, "agency-b", "with the agency unknown, the agency used last");
});

test("review L6: a copy written before the agency was known is taken once and only listed", () => {
  const storage = memory();
  writeDeviceCopy(storage, copy({ departmentId: null, base: null, workspace: ws({ results: [score(44)] }) }));
  const taken = takeUnknownAgencyCopy(storage, "user-a")!;
  const conflicts = unattributedCopyConflicts(taken.copy.workspace as MergeableWorkspace, ws({ results: [score(46)] }), "reason", "agency-a");
  assert.deepEqual(conflicts.map((conflict) => [conflict.local?.score, conflict.server?.score, conflict.reason]), [[44, 46, "reason"]]);
  taken.discard();
  assert.equal(takeUnknownAgencyCopy(storage, "user-a"), null);
});

test("review R2-M4: a copy under the pre-UX-RB key is listed once per user, never applied, and left in place", () => {
  const storage = memory();
  storage.setItem(LEGACY_RANGE_DAY_KEYS[0], JSON.stringify(ws({ rangeDays: [{ ...day, departmentId: "agency-a" }], results: [score(39)] })));
  const legacy = takeLegacyCopy(storage, "user-a")!;
  const conflicts = unattributedCopyConflicts(legacy.workspace as MergeableWorkspace, ws({ rangeDays: [{ ...day, departmentId: "agency-a" }] }), LEGACY_COPY_REASON, "agency-a");
  assert.deepEqual(conflicts.map((conflict) => [conflict.collection, conflict.local?.score, conflict.server]), [["results", 39, null]]);
  legacy.markListed();
  assert.equal(takeLegacyCopy(storage, "user-a"), null);
  assert.ok(takeLegacyCopy(storage, "user-b"), "another user is offered it too");
  assert.ok(storage.getItem(LEGACY_RANGE_DAY_KEYS[0]), "the old copy is not deleted");
  const foreign = ws({ rangeDays: [{ id: "day-9", departmentId: "agency-z" }], results: [{ ...score(30), rangeDayId: "day-9", id: "r-9" }] });
  assert.deepEqual(unattributedCopyConflicts(foreign, ws({}), LEGACY_COPY_REASON, "agency-a"), [], "another agency's records are not listed");
});
