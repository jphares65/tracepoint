import assert from "node:assert/strict";
import test from "node:test";

import {
  migrateExceptionalUserToCognito,
  type ExceptionalIdentityDisposition,
} from "./cognito-exceptional-identity-migration-core.ts";

function fixture(disposition: ExceptionalIdentityDisposition, options: { existing?: boolean; mismatch?: boolean } = {}) {
  const calls: string[] = [];
  let enabled = true;
  const provider = () => ({
    username: "11111111-1111-4111-8111-111111111111",
    subject: "provider-subject",
    email: options.mismatch ? "wrong@example.test" : "synthetic@example.test",
    enabled,
    status: "FORCE_CHANGE_PASSWORD",
  });
  return {
    calls,
    dependencies: {
      issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_synthetic",
      directory: {
        async createPending() { calls.push("create"); if (options.existing) throw new Error("exists"); return provider(); },
        async get() { calls.push("get"); return provider(); },
        async disable() { calls.push("disable"); enabled = false; },
        async enable() {}, async setPermanentPassword() {}, async markEmailVerified() {}, async beginPasswordReset() {}, async completePasswordReset() {}, async globalSignOut() {}, async deleteCompensation() {},
      },
      store: {
        async prepare() { calls.push("prepare"); return { email: "synthetic@example.test", fullName: "Synthetic User" }; },
        async commit(input: { disposition: ExceptionalIdentityDisposition }) { calls.push(`commit:${input.disposition}`); },
      },
    },
    input: { targetUserId: "11111111-1111-4111-8111-111111111111", providerUsername: "11111111-1111-4111-8111-111111111111", disposition },
  };
}

test("inactive-only identity is disabled, linked revoked, and sends no email", async () => {
  const value = fixture("inactive-disabled");
  const result = await migrateExceptionalUserToCognito(value.input, value.dependencies);
  assert.deepEqual(value.calls, ["prepare", "create", "disable", "get", "commit:inactive-disabled"]);
  assert.deepEqual(result, { userId: value.input.targetUserId, disposition: "inactive-disabled", applicationLinkState: "revoked", providerEnabled: false, activationEmailSent: false });
});

test("membership-less platform administrator remains enabled with a pending link", async () => {
  const value = fixture("platform-administrator", { existing: true });
  const result = await migrateExceptionalUserToCognito(value.input, value.dependencies);
  assert.deepEqual(value.calls, ["prepare", "create", "get", "commit:platform-administrator"]);
  assert.deepEqual(result, { userId: value.input.targetUserId, disposition: "platform-administrator", applicationLinkState: "pending", providerEnabled: true, activationEmailSent: false });
});

test("provider mismatch fails before application mapping is committed", async () => {
  const value = fixture("inactive-disabled", { mismatch: true });
  await assert.rejects(() => migrateExceptionalUserToCognito(value.input, value.dependencies), /reconciliation failed/);
  assert.deepEqual(value.calls, ["prepare", "create"]);
});
