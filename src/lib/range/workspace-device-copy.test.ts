import assert from "node:assert/strict";
import test from "node:test";

import {
  RANGE_DAY_DEVICE_COPY_KEY,
  readDeviceCopy,
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
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
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
  const stored = readDeviceCopy(storage)!;
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
  assert.equal(usableDeviceCopy(copy(), { userId: "", departmentId: null }), null);
});

test("review H2: a copy that cannot be written is reported, never assumed kept", () => {
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(writeDeviceCopy(full, copy()), false);
  assert.equal(writeDeviceCopy(null, copy()), false);
  assert.equal(readDeviceCopy({ getItem: (key: string) => (key === RANGE_DAY_DEVICE_COPY_KEY ? "{not json" : null), setItem: () => {} }), null);
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
