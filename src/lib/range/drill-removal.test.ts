import assert from "node:assert/strict";
import test from "node:test";
import { removeRangeDayDrill } from "./drill-removal.ts";

const workspace = (overrides: Record<string, unknown> = {}) => ({
  rangeDays: [{ id: "day-1", departmentId: "agency-a", status: "Planned", packetStatus: "Needs Setup" }],
  rangeDayDrills: [{ id: "drill-1", rangeDayId: "day-1", name: "Failure Drill" }],
  results: [], malfunctions: [], ...overrides,
});

test("removes an unscored drill from an editable agency range day", () => {
  const result = removeRangeDayDrill(workspace(), { rangeDayId: "day-1", drillId: "drill-1", departmentId: "agency-a" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.workspace.rangeDayDrills, []);
});

test("blocks removal when results or dependent malfunctions exist", () => {
  const result = removeRangeDayDrill(workspace({ results: [{ id: "result-1", rangeDayId: "day-1", drillId: "drill-1" }] }), { rangeDayId: "day-1", drillId: "drill-1", departmentId: "agency-a" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /dependent records/i);
});

test("blocks finalized and ready-packet range days", () => {
  for (const day of [
    { id: "day-1", departmentId: "agency-a", status: "Locked", packetStatus: "In Progress" },
    { id: "day-1", departmentId: "agency-a", status: "Planned", packetStatus: "Ready" },
  ]) {
    const result = removeRangeDayDrill(workspace({ rangeDays: [day] }), { rangeDayId: "day-1", drillId: "drill-1", departmentId: "agency-a" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /finalized or locked/i);
  }
});

test("does not expose or mutate another agency's range day", () => {
  const result = removeRangeDayDrill(workspace({ rangeDays: [] }), { rangeDayId: "day-1", drillId: "drill-1", departmentId: "agency-b" });
  assert.deepEqual(result, { ok: false, status: 404, error: "Range day was not found in your agency." });
});

test("removes a legacy workspace assignment even when its embedded agency field is stale", () => {
  const result = removeRangeDayDrill(workspace({
    rangeDays: [{ id: "day-1", departmentId: "legacy-agency", status: "Planned", packetStatus: "Needs Setup" }],
  }), { rangeDayId: "day-1", drillId: "drill-1", departmentId: "agency-a" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.workspace.rangeDayDrills, []);
});

test("supports persisted snake-case workspace collections and association identifiers", () => {
  const result = removeRangeDayDrill({
    range_days: [{ id: "day-1", status: "Planned", packet_status: "Needs Setup" }],
    range_day_drills: [{ id: "assignment-1", range_day_id: "day-1", name: "Failure Drill" }],
    drill_run_results: [], firearm_malfunctions: [],
  }, { rangeDayId: "day-1", drillId: "assignment-1", departmentId: "agency-a" });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.workspace.range_day_drills, []);
});
