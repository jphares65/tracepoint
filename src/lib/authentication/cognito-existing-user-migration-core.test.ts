import assert from "node:assert/strict";
import test from "node:test";

import { migrateExistingUserToCognito, type ExistingCognitoMigrationDependencies } from "./cognito-existing-user-migration-core.ts";

const input = {
  actorUserId: "actor",
  departmentId: "department",
  targetUserId: "target",
  siteUrl: "https://staging.example.test",
  operationId: "operation",
  providerUsername: "provider-user",
};

function dependencies(failAt?: "create" | "commit" | "send") {
  const calls: string[] = [];
  const value: ExistingCognitoMigrationDependencies = {
    issuer: "https://issuer.example.test/pool",
    directory: {
      async createPending() { calls.push("create"); if (failAt === "create") throw new Error("provider"); return { username: input.providerUsername, subject: "subject", email: "user@example.test", enabled: true, status: "FORCE_CHANGE_PASSWORD" }; },
      async deleteCompensation() { calls.push("delete"); },
      async get() { throw new Error("unused"); }, async setPermanentPassword() {}, async markEmailVerified() {}, async beginPasswordReset() {}, async completePasswordReset() {}, async disable() {}, async enable() {}, async globalSignOut() {},
    },
    store: {
      async prepare() { calls.push("prepare"); return { email: "user@example.test", fullName: "Synthetic User" }; },
      async commit() { calls.push("commit"); if (failAt === "commit") throw new Error("database"); },
      async finish(value) { calls.push(`finish:${value.sent}:${value.errorCode ?? "none"}`); },
    },
    async sendActivation() { calls.push("send"); if (failAt === "send") throw new Error("email"); return { tokenId: "token", expiresAt: "2026-09-24T00:00:00.000Z" }; },
  };
  return { value, calls };
}

test("migrates an existing user in fail-closed order", async () => {
  const fixture = dependencies();
  const result = await migrateExistingUserToCognito(input, fixture.value);
  assert.equal(result.userId, input.targetUserId);
  assert.deepEqual(fixture.calls, ["prepare", "create", "commit", "send", "finish:true:none"]);
});

test("records provider creation failure without attempting activation", async () => {
  const fixture = dependencies("create");
  await assert.rejects(() => migrateExistingUserToCognito(input, fixture.value));
  assert.deepEqual(fixture.calls, ["prepare", "create", "finish:false:provider_create_unconfirmed"]);
});

test("preserves an ambiguously committed Cognito identity for deterministic reconciliation", async () => {
  const fixture = dependencies("commit");
  await assert.rejects(() => migrateExistingUserToCognito(input, fixture.value));
  assert.deepEqual(fixture.calls, ["prepare", "create", "commit", "finish:false:identity_commit_unconfirmed"]);
});

test("preserves the pending identity and records an unconfirmed delivery", async () => {
  const fixture = dependencies("send");
  await assert.rejects(() => migrateExistingUserToCognito(input, fixture.value));
  assert.deepEqual(fixture.calls, ["prepare", "create", "commit", "send", "finish:false:activation_delivery_unconfirmed"]);
});
