import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUTHORIZATION_REFERENCE, MIGRATION_RELATIONS, RUN_ID, sha256 } from "./supabase-rest-ledger-core.mjs";
import { validateImmutableArtifact } from "./immutable-source-artifact-validator.mjs";

const expectations = { relationalRows: 0, identities: 0, memberships: 0, activeMemberships: 0, inactiveMemberships: 0, platformAdmins: 0, objects: 0, objectBytes: 0 };
function artifact(rows = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []]))) {
  const tables = MIGRATION_RELATIONS.map(name => ({ name, rows: rows[name].length, canonicalDataSha256: sha256(rows[name]) }));
  const body = { format: "tracepoint-immutable-source-artifact/v1", runId: RUN_ID, authorizationReference: AUTHORIZATION_REFERENCE, capturedAtUtc: "2026-09-21T00:00:00.000Z", source: { relationContract: [...MIGRATION_RELATIONS] }, tables, totalRelationalRows: tables.reduce((sum, table) => sum + table.rows, 0), identities: { count: 0, canonicalDataSha256: sha256([]), rows: [] }, memberships: { count: 0, canonicalDataSha256: sha256([]) }, objects: { count: 0, totalBytes: 0, manifestSha256: sha256([]), manifest: [] }, rows };
  return { ...body, masterSha256: sha256(body) };
}

test("validates a complete immutable relation contract without live clients", () => {
  const value = artifact();
  const result = validateImmutableArtifact(value, { expectedSha256: value.masterSha256, expectations });
  assert.equal(result.relationalRows, 0);
});

test("fails closed on a duplicate stable key", () => {
  const rows = Object.fromEntries(MIGRATION_RELATIONS.map(relation => [relation, []]));
  rows.roles = [{ code: "operator" }, { code: "operator" }];
  const value = artifact(rows);
  assert.throws(() => validateImmutableArtifact(value, { expectedSha256: value.masterSha256, expectations }), /PRIMARY_KEY_DUPLICATE:roles/);
});

test("validator has only read-only S3 artifact access and no source or target client", async () => {
  const source = await readFile(new URL("./immutable-source-artifact-validator.mjs", import.meta.url), "utf8");
  assert.match(source, /GetObjectCommand/);
  assert.doesNotMatch(source, /PutObjectCommand|DeleteObjectCommand|@supabase\/|\bpg\b|Cognito|CloudFormationClient/);
});
