import test from "node:test";
import assert from "node:assert/strict";
import { createProductionReconciliationContract } from "./production-reconciliation-contract-core.mjs";

const names = Array.from({ length: 77 }, (_, index) => `table_${String(index).padStart(2, "0")}`);
const relations = [
  ...names.map((name, index) => ({ name, rowCount: index === 0 ? 4007 : 0, countStatus: "exact" })),
  { name: "roles", rowCount: 10, countStatus: "exact" }, { name: "permissions", rowCount: 21, countStatus: "exact" },
  { name: "role_permissions", rowCount: 52, countStatus: "exact" }, { name: "feature_catalog", rowCount: 9, countStatus: "exact" },
  { name: "user_activation_tokens", rowCount: 6, countStatus: "exact" },
  { name: "v_one", rowCount: 253, countStatus: "exact" },
];
const inventory = {
  format: "tracepoint-production-source-inventory/v1", contentSha256: "a".repeat(64), database: { totalRows: 4358, exposedRelations: relations },
  identityTransition: { cohortUsers: 96, cohortUserSetSha256: "b".repeat(64), membershipLinks: 95, membershipLinkSetSha256: "c".repeat(64), usersWithActiveMembership: 94, usersWithOnlyInactiveMembership: 1, usersWithNoMembership: 1, platformAdministratorsWithNoMembership: 1, duplicateEmailGroups: 0 },
  storage: { totalObjects: 2, totalBytes: 522978, buckets: [{ name: "department-assets", objectCount: 2, totalBytes: 522978, public: true }] },
};

test("creates a privacy-safe fail-closed production reconciliation contract", () => {
  const result = createProductionReconciliationContract(inventory, "2026-09-12T00:00:00.000Z");
  assert.equal(result.database.physicalRows, 4105);
  assert.equal(result.database.copiedRows, 4007);
  assert.equal(result.database.relations.find(item => item.relation === "roles").copyMode, "exclude-target-seeded");
  assert.equal(result.database.relations.find(item => item.relation === "user_activation_tokens").copyMode, "exclude-transient");
  assert.equal(result.database.relations.find(item => item.relation === "v_one").copyMode, "recompute-view");
  assert.match(result.contentSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes("@"), false);
});

test("refuses source-scale drift", () => {
  assert.throws(() => createProductionReconciliationContract({ ...inventory, database: { ...inventory.database, totalRows: 4357 } }), /4358/);
});
