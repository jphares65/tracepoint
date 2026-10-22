import assert from "node:assert/strict";
import test from "node:test";

import { measurementField } from "./scoring-rules.ts";
import { authorizeRangeWorkspaceMutation, resultMeasurementError } from "./workspace-mutation.ts";

const drill = { id: "drill-1", rangeDayId: "day-1", name: "Handgun Qualification", maxScore: 50 };

test("UX-RB-6: a typed measurement is checked with the server's own rule before saving", () => {
  assert.equal(measurementField("Points"), "score");
  assert.equal(measurementField("Qualification"), "score");
  assert.equal(measurementField("Time"), "timeSeconds");
  assert.equal(measurementField("Hit Count"), "hitCount");
  assert.equal(measurementField("Completion"), null);
  assert.equal(resultMeasurementError({ runNumber: 1, score: "55" }, drill), "Score 55 for Handgun Qualification is above the maximum of 50.");
  assert.equal(resultMeasurementError({ runNumber: 1, score: "8o" }, drill), "Score for Handgun Qualification must be a number of 0 or more.");
  assert.equal(resultMeasurementError({ runNumber: 1, timeSeconds: "0" }, drill), "Time for Handgun Qualification must be a number of seconds greater than 0.");
  assert.equal(resultMeasurementError({ runNumber: 1, hitCount: "4.5" }, drill), "Hit count for Handgun Qualification must be a whole number of 0 or more.");
  assert.equal(resultMeasurementError({ runNumber: 1, score: "48" }, drill), "");
});

test("UX-RB-6: what the row blocks is exactly what the server refuses (same function, unchanged server behaviour)", () => {
  const existing = { rangeDays: [{ id: "day-1", departmentId: "agency-a", status: "In Progress" }], drillLibrary: [], rangeDayDrills: [drill], rangeRoster: [], results: [], malfunctions: [] };
  const next = { ...existing, results: [{ id: "r1", rangeDayId: "day-1", drillId: "drill-1", runNumber: 1, officerId: "o1", score: 55 }] };
  const decision = authorizeRangeWorkspaceMutation({ existingWorkspace: existing, nextWorkspace: next, departmentId: "agency-a", permissions: ["score_range_days"] });
  assert.deepEqual(decision, { ok: false, status: 400, error: resultMeasurementError(next.results[0], drill) });
});
