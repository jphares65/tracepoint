import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_DEFINITIONS, reportCollection } from "./report-definitions.ts";

test("report registry covers every implemented reportable domain with unique keys", () => {
  const keys = REPORT_DEFINITIONS.map((definition) => definition.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const key of ["personnel","firearms","firearm-inspections","off-duty-firearms","ammunition","qualifications","range-days","training-records","agency-training","certifications","equipment","fleet","fleet-inspections","fleet-maintenance","fleet-equipment","readiness","certification-readiness","alerts","audit-history"]) assert.ok(keys.includes(key), key);
  assert.equal(REPORT_DEFINITIONS.find((definition) => definition.key === "fleet")?.featureCode, null);
});

test("report collection follows declared payload paths and fails empty", () => {
  assert.deepEqual(reportCollection({ workspace: { results: [{ id: "one" }] } }, ["workspace","results"]), [{ id: "one" }]);
  assert.deepEqual(reportCollection({}, ["missing"]), []);
});
