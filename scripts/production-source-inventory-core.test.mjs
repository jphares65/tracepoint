import test from "node:test";
import assert from "node:assert/strict";
import { createProductionSourceInventory, exactCountFromHeaders, exposedRelations, parseMigrationList, reconcileMigrationVersions, summarizeIdentityTransition, summarizeIdentityUsers, validateProductionSourceEnvironment } from "./production-source-inventory-core.mjs";

test("production source gate accepts only the exact production project", () => {
  assert.equal(validateProductionSourceEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://izlkwggluhlhzlumtzes.supabase.co", SUPABASE_SECRET_KEY: "s".repeat(32) }).projectRef, "izlkwggluhlhzlumtzes");
  assert.throws(() => validateProductionSourceEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://wztqqqashilusoppddxi.supabase.co", SUPABASE_SECRET_KEY: "s".repeat(32) }), /production/);
});

test("OpenAPI and count parsing emit only structural aggregate data", () => {
  assert.deepEqual(exposedRelations({ paths: { "/profiles": { get: {} }, "/rpc/a": { post: {} }, "/departments": { get: {} } } }), ["departments", "profiles"]);
  assert.equal(exactCountFromHeaders(new Headers({ "content-range": "0-0/42" }), "profiles"), 42);
  assert.throws(() => exactCountFromHeaders(new Headers(), "profiles"), /unavailable/);
});

test("migration lineage exposes exact drift without SQL or credentials", () => {
  const result = parseMigrationList("  202601010001 | 202601010001 | now\n  202601010002 |                | now", ["202601010001", "202601010002"]);
  assert.equal(result.remoteCount, 1);
  assert.deepEqual(result.missingFromProduction, ["202601010002"]);
  assert.equal(reconcileMigrationVersions(["202601010001"], ["202601010001", "202601010002"]).remoteCount, 1);
});

test("identity summary contains no identity values", () => {
  const result = summarizeIdentityUsers([{ id: "secret", email: "hidden@example.com", email_confirmed_at: "2026-01-01", app_metadata: { provider: "email", providers: ["email"] } }, { id: "other", is_anonymous: true, app_metadata: {} }]);
  assert.deepEqual(result, { total: 2, confirmed: 1, unconfirmed: 1, banned: 0, anonymous: 1, providerCounts: { email: 1 } });
  assert.equal(JSON.stringify(result).includes("hidden"), false);
});

test("identity transition summary preserves cohort and membership evidence without identity values", () => {
  const users = [
    { id: "10000000-0000-4000-8000-000000000001", email: "same@example.test" },
    { id: "10000000-0000-4000-8000-000000000002", email: "SAME@example.test" },
    { id: "10000000-0000-4000-8000-000000000003", email: "third@example.test" },
  ];
  const memberships = [
    { user_id: users[0].id, department_id: "20000000-0000-4000-8000-000000000001", is_active: true },
    { user_id: users[0].id, department_id: "20000000-0000-4000-8000-000000000002", is_active: true },
    { user_id: users[1].id, department_id: "20000000-0000-4000-8000-000000000001", is_active: false },
  ];
  const result = summarizeIdentityTransition(users, memberships, [{ user_id: users[2].id, is_active: true }]);
  assert.deepEqual({ ...result, cohortUserSetSha256: "redacted", membershipLinkSetSha256: "redacted" }, {
    cohortUsers: 3, cohortUserSetSha256: "redacted", membershipLinks: 3, membershipLinkSetSha256: "redacted",
    usersWithNoMembership: 1, usersWithActiveMembership: 1, usersWithOnlyInactiveMembership: 1,
    multiDepartmentUsers: 1, inactiveMemberships: 1,
    membershipUsersMissingFromAuth: 0, activePlatformAdministrators: 1,
    platformAdministratorsMissingFromAuth: 0, platformAdministratorsWithNoMembership: 1,
    platformAdministratorsWithOnlyInactiveMembership: 0, duplicateEmailGroups: 1, duplicateEmailUsers: 2,
  });
  assert.equal(JSON.stringify(result).includes("example.test"), false);
  assert.throws(() => summarizeIdentityTransition(users, [...memberships, memberships[0]], []), /Duplicate/);
});

test("immutable inventory validates totals and privacy declaration", () => {
  const migrationLineage = { localCount: 76, remoteCount: 60, localLedgerSha256: "a".repeat(64), remoteLedgerSha256: "b".repeat(64), missingFromProduction: [], unexpectedInProduction: [] };
  const result = createProductionSourceInventory({ projectRef: "izlkwggluhlhzlumtzes", database: { exposedRelations: [{ name: "profiles", rowCount: 2, countStatus: "exact" }], totalRows: 2, exactCountComplete: true, membershipBreakdown: {} }, migrationLineage, identity: { total: 2, confirmed: 2, unconfirmed: 0, banned: 0, anonymous: 0, providerCounts: { email: 2 } }, identityTransition: { cohortUsers: 2, cohortUserSetSha256: "c".repeat(64), membershipLinks: 0, membershipLinkSetSha256: "d".repeat(64), usersWithNoMembership: 2, usersWithActiveMembership: 0, usersWithOnlyInactiveMembership: 0, multiDepartmentUsers: 0, inactiveMemberships: 0, membershipUsersMissingFromAuth: 0, activePlatformAdministrators: 0, platformAdministratorsMissingFromAuth: 0, platformAdministratorsWithNoMembership: 0, platformAdministratorsWithOnlyInactiveMembership: 0, duplicateEmailGroups: 0, duplicateEmailUsers: 0 }, storage: { buckets: [{ name: "attachments", public: false, objectCount: 1, totalBytes: 3 }], totalObjects: 1, totalBytes: 3 } }, "2026-09-12T00:00:00.000Z");
  assert.equal(result.privacy.recordContentsEmitted, false);
  assert.match(result.contentSha256, /^[0-9a-f]{64}$/);
});
