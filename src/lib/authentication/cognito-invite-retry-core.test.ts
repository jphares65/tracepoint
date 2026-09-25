import assert from "node:assert/strict";
import { test } from "node:test";
import { CognitoDirectoryError } from "./cognito-admin-core";
import { assertPendingInviteAbsentInCognito, parsePendingInviteRetry } from "./cognito-invite-retry-core";

const pending = {
  user_id: "ae3ea4a1-2c84-4abb-b254-cfc57cc229e5",
  operation_id: "9b724a5a-294e-4bcb-bbdd-a71b478d0a85",
  provider_username: "c40cbf03-a250-4a19-9e56-9cfbb4091e53",
};

test("only one complete pending identity is recoverable", () => {
  assert.equal(parsePendingInviteRetry([]), null);
  assert.deepEqual(parsePendingInviteRetry([pending]), pending);
  assert.throws(() => parsePendingInviteRetry([pending, pending]), /ambiguous/);
  assert.throws(() => parsePendingInviteRetry([{ ...pending, provider_username: "bad" }]), /invalid/);
});

test("both email alias and original provider username must be absent", async () => {
  const seen: string[] = [];
  await assertPendingInviteAbsentInCognito({ get: async name => {
    seen.push(name);
    throw new CognitoDirectoryError("not_found");
  } }, "synthetic@example.invalid", pending);
  assert.deepEqual(seen, ["synthetic@example.invalid", pending.provider_username]);
});

test("existing provider user or uncertain lookup rejects before claim", async () => {
  for (const error of [undefined, new CognitoDirectoryError("unavailable"), new CognitoDirectoryError("conflict")]) {
    await assert.rejects(assertPendingInviteAbsentInCognito({ get: async name => {
      if (name === "synthetic@example.invalid") throw new CognitoDirectoryError("not_found");
      if (error) throw error;
      return { username: pending.provider_username, subject: pending.provider_username, email: "synthetic@example.invalid", enabled: true, status: "FORCE_CHANGE_PASSWORD" };
    } }, "synthetic@example.invalid", pending));
  }
  await assert.rejects(assertPendingInviteAbsentInCognito({ get: async () => ({
    username: pending.provider_username, subject: pending.provider_username,
    email: "synthetic@example.invalid", enabled: true, status: "FORCE_CHANGE_PASSWORD",
  }) }, "synthetic@example.invalid", pending), /already has a provider identity/);
});
