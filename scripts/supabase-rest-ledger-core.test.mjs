import assert from "node:assert/strict";
import test from "node:test";
import { MIGRATION_RELATIONS, PROJECT_URL, assertReadOnlyRequest, relationUrl, sanitizedManifest, sha256, validateSourceSecret } from "./supabase-rest-ledger-core.mjs";

test("accepts only the dedicated two-field source secret and exact project", () => {
  assert.deepEqual(validateSourceSecret({ projectUrl: PROJECT_URL, serviceRoleKey: "sb_secret_abcdefghijklmnopqrstuvwxyz" }).projectUrl, PROJECT_URL);
  assert.throws(() => validateSourceSecret({ projectUrl: "https://other.supabase.co", serviceRoleKey: "sb_secret_abcdefghijklmnopqrstuvwxyz" }));
  assert.throws(() => validateSourceSecret({ projectUrl: PROJECT_URL, serviceRoleKey: "sb_secret_abcdefghijklmnopqrstuvwxyz", extra: "no" }));
});

test("rejects mutating, non-project, and unapproved relation requests", () => {
  assertReadOnlyRequest("GET", relationUrl(MIGRATION_RELATIONS[0], 0));
  assert.throws(() => assertReadOnlyRequest("POST", relationUrl(MIGRATION_RELATIONS[0], 0)));
  assert.throws(() => assertReadOnlyRequest("GET", "https://evil.invalid/rest/v1/profiles"));
  assert.throws(() => relationUrl("arbitrary_relation", 0));
});

test("sanitized manifests reconcile only exact known inventory and never include record data", () => {
  const tables = MIGRATION_RELATIONS.map((name, index) => ({ name, rows: index === 0 ? 4723 : 0, canonicalDataSha256: sha256(name) }));
  const output = sanitizedManifest({ capturedAtUtc: "2026-09-20T16:30:00.000Z", tables, identities: { count: 96, canonicalDataSha256: sha256("identities") }, memberships: { count: 95, canonicalDataSha256: sha256("memberships") }, objectManifestSha256: "8cfcf70e4f9905de67d770a8af9714254e5f625ad3c3d219300aaafeaea4d780", objectCount: 2, objectBytes: 522978 });
  assert.equal(output.comparison.delta, 0);
  assert.equal(output.privacy.recordContentsEmitted, false);
  assert.equal(JSON.stringify(output).includes("serviceRoleKey"), false);
});
