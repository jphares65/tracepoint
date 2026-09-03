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
  const result = removeRangeDayDrill(workspace(), { rangeDayId: "day-1", drillId: "drill-1", departmentId: "agency-b" });
  assert.deepEqual(result, { ok: false, status: 404, error: "Range day was not found in your agency." });
});
