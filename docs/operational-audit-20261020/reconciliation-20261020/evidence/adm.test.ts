// Isolated, read-only verification of ADM findings against the CURRENT worktree
// (origin/codex/staging-mobile-api-release-20261007 @ 555f061), imported through a
// symlink (./src -> scratchpad/current/src). No network, no database, no writes to the repo.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isCognitoCompliantPassword, COGNITO_PASSWORD_MIN_LENGTH } from "@/lib/authentication/password-policy";
import { applyCognitoMembershipLifecycle } from "@/lib/authentication/cognito-membership-lifecycle-core";
import { cognitoInviteAuthorizationContext } from "@/lib/authentication/cognito-invite-authorization-context";
import { withPostgresAuthorization, withPostgresSubjectAuthorization } from "@/lib/database/postgres-authorization-core";
import { shouldRouteToPlatformConsole } from "@/lib/authentication/post-auth-routing-core";

const CURRENT = "/tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/current";

// ---------------------------------------------------------------- ADM-01 (Cognito path)
test("ADM-01/Cognito: legacy issueActivationEmail throws in aws-native mode (called by cognito-personnel-writer for existing pending identities)", async () => {
  process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE = "aws-native";
  const { issueActivationEmail, validateActivationToken } = await import("@/lib/tracepoint/activation");
  await assert.rejects(
    issueActivationEmail({ departmentId: "d", userId: "u", email: "a@b.c", fullName: "A", siteUrl: "https://x", actorUserId: "x" }),
    /Legacy activation is unavailable in AWS-native mode\./,
  );
  // A well-formed legacy token is also refused outright in aws-native mode.
  const token = "6f1c2e4a-8b7d-4c3e-9a1b-2c3d4e5f6a7b." + "A".repeat(43);
  await assert.rejects(validateActivationToken(token), /Legacy activation is unavailable in AWS-native mode\./);
  // Malformed tokens are rejected before the provider check.
  await assert.rejects(validateActivationToken("garbage"), /This activation link is invalid\./);
  delete process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE;
});

test("ADM-01/Cognito: personnel writer still calls issueActivationEmail on the existing-pending and reactivation paths", () => {
  const src = readFileSync(`${CURRENT}/src/lib/ai-importer/server/cognito-personnel-writer.ts`, "utf8");
  const calls = src.split("\n").map((line, i) => [i + 1, line] as const).filter(([, l]) => /await issueActivationEmail\(/.test(l));
  assert.deepEqual(calls.map(([n]) => n), [57, 124]);
});

// ---------------------------------------------------------------- ADM-04 (Cognito path)
test("ADM-04/Cognito: membership lifecycle 'enable' re-enables a disabled Cognito user when no other active membership exists", async () => {
  const calls: string[] = [];
  const store = {
    async prepare() { return { providerUsername: "sub-123", shouldChangeProvider: true }; },
    async finish(id: string, ok: boolean) { calls.push(`finish:${ok}`); },
  };
  const directory = {
    async enable(u: string) { calls.push(`enable:${u}`); },
    async disable(u: string) { calls.push(`disable:${u}`); },
    async globalSignOut(u: string) { calls.push(`signout:${u}`); },
  };
  await applyCognitoMembershipLifecycle(store, directory, { operationId: "op", actorUserId: "a", departmentId: "d", targetUserId: "t", active: true });
  assert.deepEqual(calls, ["enable:sub-123", "finish:true"]);
  calls.length = 0;
  await applyCognitoMembershipLifecycle(store, directory, { operationId: "op2", actorUserId: "a", departmentId: "d", targetUserId: "t", active: false });
  assert.deepEqual(calls, ["signout:sub-123", "disable:sub-123", "finish:true"]);
});

test("ADM-04/Cognito: classic route maps a missing Active column to active=true (reactivation of separated officers on re-import)", () => {
  const src = readFileSync(`${CURRENT}/src/app/api/settings/onboarding/personnel/route.ts`, "utf8");
  assert.match(src, /if \(!normalized\) return true;/);
  const writer = readFileSync(`${CURRENT}/src/lib/ai-importer/server/cognito-personnel-writer.ts`, "utf8");
  assert.match(writer, /if \(value\.active !== false\) \{\s*await setCognitoMembershipActive\(\{[\s\S]*?active: true,/);
});

// ---------------------------------------------------------------- password policy mismatch (ADM-27 / new)
test("NEW-ADM-B: app password policy (min 10) is weaker than the Cognito pool policy (min 14)", () => {
  const infra = readFileSync(`${CURRENT}/infra/lib/cognito-foundation-stack.ts`, "utf8");
  const poolMin = Number(/passwordPolicy:\{minLength:(\d+)/.exec(infra)?.[1]);
  assert.equal(poolMin, 14);
  assert.equal(COGNITO_PASSWORD_MIN_LENGTH, 10);
  const tenChar = "Abcdefg1!x"; // 10 chars, all classes
  assert.equal(tenChar.length, 10);
  assert.equal(isCognitoCompliantPassword(tenChar), true, "app accepts a password the pool will reject");
  assert.equal(tenChar.length >= poolMin, false);
});

// ---------------------------------------------------------------- authorization context resolution
function fakePool() {
  const log: Array<[string, unknown[] | undefined]> = [];
  return {
    log,
    async connect() {
      return { async query(text: string, values?: readonly unknown[]) { log.push([text, values ? [...values] : undefined]); return { rows: [] }; }, release() { log.push(["release", undefined]); } };
    },
  };
}
const SUBJ = "11111111-1111-4111-8111-111111111111";
const DEPT = "22222222-2222-4222-8222-222222222222";

test("authz: support_department_id is only set when supportMode === true", async () => {
  const normal = fakePool();
  await withPostgresAuthorization(normal, cognitoInviteAuthorizationContext({ actorUserId: SUBJ, departmentId: DEPT }), async () => 1);
  assert.equal(normal.log.some(([t]) => /support_department_id/.test(t)), false);
  const support = fakePool();
  await withPostgresAuthorization(support, cognitoInviteAuthorizationContext({ actorUserId: SUBJ, departmentId: DEPT, supportMode: true }), async () => 1);
  assert.deepEqual(support.log.map(([t]) => t), [
    "begin", "set local role authenticated",
    "select set_config('tracepoint.subject_id', $1, true)",
    "select set_config('tracepoint.department_id', $1, true)",
    "select set_config('tracepoint.support_department_id', $1, true)",
    "commit", "release",
  ]);
});

test("authz: invalid subject/department ids are rejected before any connection", async () => {
  const pool = fakePool();
  await assert.rejects(withPostgresAuthorization(pool, { subjectId: "not-a-uuid", departmentId: DEPT }, async () => 1), /Valid authorization subject and department are required/);
  await assert.rejects(withPostgresAuthorization(pool, { subjectId: SUBJ, departmentId: "x" }, async () => 1), /Valid authorization subject and department are required/);
  assert.equal(pool.log.length, 0);
});

test("ADM-22/AWS: platform subject-only context never sets tracepoint.department_id (platform RPCs must not depend on it)", async () => {
  const pool = fakePool();
  await withPostgresSubjectAuthorization(pool, { subjectId: SUBJ }, async () => 1);
  assert.equal(pool.log.some(([t]) => /tracepoint\.department_id/.test(t)), false);
});

test("post-auth routing: platform admin with no active membership goes to /platform; deactivated non-admin does not", () => {
  assert.equal(shouldRouteToPlatformConsole({ isPlatformAdmin: true, hasActiveDepartmentMembership: false }), true);
  assert.equal(shouldRouteToPlatformConsole({ isPlatformAdmin: false, hasActiveDepartmentMembership: false }), false);
  assert.equal(shouldRouteToPlatformConsole({ isPlatformAdmin: true, hasActiveDepartmentMembership: true }), false);
});

// ---------------------------------------------------------------- NEW-ADM-A: pending Cognito identities cannot sign in
import { PostgresIdentityMappingStore, RehearsalInitialIdentityMappingStore } from "@/lib/authentication/postgres-mapping";

function linkPool(links: Array<{ issuer: string; subject: string; userId: string; state: string }>) {
  // Minimal evaluator for the two SELECTs in postgres-mapping.ts: honours the literal state filter in the SQL text.
  return {
    async query(text: string, values: unknown[]) {
      const state = /state='(\w+)'/.exec(text)?.[1];
      const rows = links.filter(l => l.issuer === values[0] && l.subject === values[1] && l.state === state && (values[2] === undefined || l.userId === values[2]))
        .map(l => ({ tracepoint_user_id: l.userId }));
      return { rowCount: rows.length, rows };
    },
  };
}

test("NEW-ADM-A: an invited/imported user with a 'pending' Cognito link is not mapped on first sign-in (production mapping requires state='active')", async () => {
  const prodIssuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_PRODPOOL1";
  const pool = linkPool([{ issuer: prodIssuer, subject: "sub-new-officer", userId: "33333333-3333-4333-8333-333333333333", state: "pending" }]);
  const store = new PostgresIdentityMappingStore(pool as never);
  assert.equal(await store.findActive(prodIssuer, "sub-new-officer"), null);
  // The only generic promotion path for non-rehearsal pools is finish_cognito_password_operation(assign_password)
  // or the legacy /activate finalize (unreachable in aws-native). The rehearsal wrapper promotes only two hard-coded subjects:
  const rehearsal = new RehearsalInitialIdentityMappingStore(store, pool as never);
  assert.equal(await rehearsal.findActive(prodIssuer, "sub-new-officer"), null);
  // control: once a link is 'active', mapping succeeds
  const active = new PostgresIdentityMappingStore(linkPool([{ issuer: prodIssuer, subject: "sub-new-officer", userId: "33333333-3333-4333-8333-333333333333", state: "active" }]) as never);
  assert.deepEqual(await active.findActive(prodIssuer, "sub-new-officer"), { userId: "33333333-3333-4333-8333-333333333333" });
});

test("NEW-ADM-A: invite commit writes state 'pending' and only assign_password / legacy finalize set 'active' (static)", () => {
  const sql = ["006_cognito_lifecycle_state.sql", "009_cognito_membership_lifecycle.sql", "010_cognito_inactive_invites.sql", "013_cognito_existing_user_migration.sql", "021_cognito_exceptional_identity_migration.sql", "025_cognito_provider_username_reconciliation.sql", "026_cognito_invite_profile_trigger_reconciliation.sql", "027_cognito_invite_retry_claim.sql"]
    .map(f => [f, readFileSync(`${CURRENT}/database/aws/${f}`, "utf8")] as const);
  const promotions = sql.flatMap(([f, s]) => s.split("\n").map((l, i) => [f, i + 1, l] as const)).filter(([, , l]) => /authentication_identity_links set state\s*=\s*'active'/.test(l)).map(([f, n]) => `${f}:${n}`);
  assert.deepEqual(promotions, ["006_cognito_lifecycle_state.sql:119", "006_cognito_lifecycle_state.sql:272"]);
  assert.match(sql[0][1], /values\('cognito',p_issuer,p_subject,v_op\.tracepoint_user_id,'pending',v_op\.provider_username\)/);
});
