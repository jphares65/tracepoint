import assert from "node:assert/strict";
import { test } from "node:test";
import { applyMobileRangeMutation, mobileRangeDaySummary } from "./mobile-range-workspace";

const workspace = { rangeDays: [{ id: "day", status: "In Progress" }], rangeRoster: [{ id: "roster", rangeDayId: "day", officerId: "officer", attended: false }], rangeDayDrills: [{ id: "drill", rangeDayId: "day" }], results: [], malfunctions: [] };
test("attendance is idempotent and requires management authority", () => {
  const denied = applyMobileRangeMutation({ workspace, rangeDayId: "day", permissions: ["score_range_days"], action: { type: "attendance", operationId: "one", rosterEntryId: "roster", attended: true } });
  assert.equal(denied.ok, false);
  const first = applyMobileRangeMutation({ workspace, rangeDayId: "day", permissions: ["manage_range_days"], action: { type: "attendance", operationId: "one", rosterEntryId: "roster", attended: true } });
  assert.ok(first.ok);
  assert.equal((first.workspace.rangeRoster as Record<string, unknown>[])[0].attended, true);
  const replay = applyMobileRangeMutation({ workspace: first.workspace, rangeDayId: "day", permissions: ["manage_range_days"], action: { type: "attendance", operationId: "one", rosterEntryId: "roster", attended: true } });
  assert.ok(replay.ok);
  assert.equal(replay.alreadyApplied, true);
});
test("scoring rejects foreign officers and preserves retry identity", () => {
  const denied = applyMobileRangeMutation({ workspace, rangeDayId: "day", permissions: ["score_range_days"], action: { type: "save-score", operationId: "two", result: { id: "result", drillId: "drill", officerId: "foreign" } } });
  assert.deepEqual(denied, { ok: false, status: 403, error: "The score references a drill or officer outside this range day." });
  const saved = applyMobileRangeMutation({ workspace, rangeDayId: "day", permissions: ["score_range_days"], action: { type: "save-score", operationId: "two", result: { id: "result", drillId: "drill", officerId: "officer", score: 95 } } });
  assert.ok(saved.ok);
  assert.equal((saved.workspace.results as Record<string, unknown>[])[0].mobileMutationId, "two");
});
test("finalized days and history removal fail closed", () => {
  assert.equal(applyMobileRangeMutation({ workspace: { ...workspace, rangeDays: [{ id: "day", status: "Completed" }] }, rangeDayId: "day", permissions: ["manage_range_days"], action: { type: "attendance", operationId: "x", rosterEntryId: "roster", attended: true } }).ok, false);
  const withScore = { ...workspace, results: [{ id: "result", rangeDayId: "day", drillId: "drill", officerId: "officer" }] };
  assert.equal(applyMobileRangeMutation({ workspace: withScore, rangeDayId: "day", permissions: ["manage_range_days"], action: { type: "remove-roster", operationId: "x", rosterEntryId: "roster" } }).ok, false);
  assert.equal(mobileRangeDaySummary(workspace, "day").roster.length, 1);
});
