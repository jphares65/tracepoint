import assert from "node:assert/strict";
import test from "node:test";
import { buildSyntheticTables, productionScale, reconcileContracts, runSyntheticRehearsal, tableContracts } from "./production-shaped-rehearsal-core.mjs";

const inventory = {
  format: "tracepoint-production-source-inventory/v1",
  database: { totalRows: 4358, exposedRelations: [
    { name: "audit_events", rowCount: 4105 },
    ...Array.from({ length: 86 }, (_, index) => ({ name: `empty_relation_${String(index).padStart(2, "0")}`, rowCount: 0 })),
    { name: "v_active_firearm_assignments", rowCount: 155 },
    { name: "v_latest_qualification_results", rowCount: 93 },
    { name: "v_range_day_summary", rowCount: 5 },
  ] },
  identityTransition: { cohortUsers: 96, membershipLinks: 95 },
  storage: { totalObjects: 2 },
};
test("production-shaped scale distinguishes physical rows from derived views", () => {
  assert.deepEqual(productionScale(inventory), { exposedRows: 4358, viewRows: 253, physicalRows: 4105, copiedPublicRows: 4007, relations: 87, derivedViews: 3 });
});
test("table contracts fail closed on row, key, tenant and timestamp drift", () => {
  const tables = buildSyntheticTables(inventory), source = tableContracts(tables);
  const cases = ["id", "departmentId", "createdAt", "payload"];
  for (const field of cases) { const changed = structuredClone(tables); const table = Object.keys(changed).find(name => changed[name].length); changed[table][0][field] = field === "departmentId" ? "90000000-0000-4000-8000-000000000001" : `${changed[table][0][field]}-changed`; assert.throws(() => reconcileContracts(source, tableContracts(changed))); }
});
test("identity and object retries are create-only and exactly resumable", async () => {
  const result = await runSyntheticRehearsal(inventory);
  assert.equal(result.database.clean, true); assert.equal(result.database.rows, 4105);
  assert.deepEqual({ users: result.identity.users, memberships: result.identity.memberships, roles: result.identity.membershipRoles, creates: result.identity.targetCreates, resumed: result.identity.repeatResumed }, { users: 96, memberships: 95, roles: 86, creates: 96, resumed: 96 });
  assert.deepEqual({ objects: result.storage.objects, creates: result.storage.targetCreates, resumed: result.storage.repeatResumed }, { objects: 2, creates: 2, resumed: 2 });
});
