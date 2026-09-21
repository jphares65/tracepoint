import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUTHORIZATION_REFERENCE, MIGRATION_RELATIONS, RUN_ID, sha256 } from "./supabase-rest-ledger-core.mjs";
import { validateImmutableArtifact } from "./immutable-source-artifact-validator.mjs";

const zeroExpectations = { relationalRows: 0, identities: 0, memberships: 0, activeMemberships: 0, inactiveMemberships: 0, platformAdmins: 0, objects: 0, objectBytes: 0 };
function artifact(rows = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []])), identities = []) {
  const tables = MIGRATION_RELATIONS.map(name => ({ name, rows: rows[name].length, canonicalDataSha256: sha256(rows[name]) }));
  const body = { format: "tracepoint-immutable-source-artifact/v1", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, capturedAtUtc: "2026-09-21T00:00:00.000Z", source: { relationContract: [...MIGRATION_RELATIONS] }, tables, totalRelationalRows: tables.reduce((sum, table) => sum + table.rows, 0), identities: { count: identities.length, canonicalDataSha256: sha256(identities), rows: identities }, memberships: { count: rows.department_memberships.length, canonicalDataSha256: sha256(rows.department_memberships) }, objects: { count: 0, totalBytes: 0, manifestSha256: sha256([]), manifest: [] }, rows };
  return { ...body, masterSha256: sha256(body) };
}
const expectationsFor = (value, overrides = {}) => ({ ...zeroExpectations, relationalRows: value.totalRelationalRows, identities: value.identities.count, memberships: value.memberships.count, ...overrides });

test("validates a complete immutable relation contract without live clients", () => {
  const value = artifact();
  const result = validateImmutableArtifact(value, { expectedSha256: value.masterSha256, expectations: zeroExpectations });
  assert.equal(result.relationalRows, 0);
});

test("fails closed on a duplicate stable key", () => {
  const rows = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []]));
  rows.roles = [{ code: "operator" }, { code: "operator" }];
  const value = artifact(rows);
  assert.throws(() => validateImmutableArtifact(value, { expectedSha256: value.masterSha256, expectations: expectationsFor(value) }), /PRIMARY_KEY_DUPLICATE:roles/);
});

test("accepts a base-table UUID mirrored by a derived view", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const rows = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []]));
  rows.firearm_assignments = [{ id }]; rows.v_active_firearm_assignments = [{ id }];
  const value = artifact(rows);
  assert.equal(validateImmutableArtifact(value, { expectedSha256: value.masterSha256, expectations: expectationsFor(value) }).relationalRows, 2);
});

test("fails closed on duplicate UUID within one base relation and duplicate view key", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const base = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []]));
  base.firearm_assignments = [{ id }, { id }]; const baseValue = artifact(base);
  assert.throws(() => validateImmutableArtifact(baseValue, { expectedSha256: baseValue.masterSha256, expectations: expectationsFor(baseValue) }), /PRIMARY_KEY_DUPLICATE:firearm_assignments/);
  const view = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []]));
  view.v_active_firearm_assignments = [{ id }, { id }]; const viewValue = artifact(view);
  assert.throws(() => validateImmutableArtifact(viewValue, { expectedSha256: viewValue.masterSha256, expectations: expectationsFor(viewValue) }), /PRIMARY_KEY_DUPLICATE:v_active_firearm_assignments/);
});

test("retains fail-closed FK and tenant ownership validation", () => {
  const departmentA = "10000000-0000-4000-8000-000000000001", departmentB = "10000000-0000-4000-8000-000000000002", asset = "10000000-0000-4000-8000-000000000003", assignment = "10000000-0000-4000-8000-000000000004";
  const rows = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []]));
  rows.departments = [{ id: departmentA }, { id: departmentB }]; rows.equipment_assets = [{ id: asset, department_id: departmentA }]; rows.equipment_asset_assignments = [{ id: assignment, department_id: departmentB, equipment_asset_id: asset }];
  const value = artifact(rows);
  assert.throws(() => validateImmutableArtifact(value, { expectedSha256: value.masterSha256, expectations: expectationsFor(value) }), /CROSS_TENANT_REFERENCE:equipment_asset_assignments.equipment_asset_id/);
});

test("validates polymorphic audit references without inventing a foreign key", () => {
  const rows = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []]));
  rows.audit_events = [{ id: 1, entity_type: "deleted_entity", entity_id: "10000000-0000-4000-8000-000000000001" }];
  const value = artifact(rows);
  assert.equal(validateImmutableArtifact(value, { expectedSha256: value.masterSha256, expectations: expectationsFor(value) }).relationalRows, 1);
  rows.audit_events = [{ id: 1, entity_id: "10000000-0000-4000-8000-000000000001" }];
  const invalid = artifact(rows);
  assert.throws(() => validateImmutableArtifact(invalid, { expectedSha256: invalid.masterSha256, expectations: expectationsFor(invalid) }), /POLYMORPHIC_REFERENCE_TYPE_MISSING:audit_events.entity_id/);
});

test("validator has only read-only S3 artifact access and no source or target client", async () => {
  const source = await readFile(new URL("./immutable-source-artifact-validator.mjs", import.meta.url), "utf8");
  assert.match(source, /GetObjectCommand/);
  assert.doesNotMatch(source, /PutObjectCommand|DeleteObjectCommand|@supabase\/|\bpg\b|Cognito|CloudFormationClient/);
});
