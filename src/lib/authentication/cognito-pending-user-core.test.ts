import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingUserCreateInput } from "./cognito-pending-user-core";

const placeholder = "c40cbf03-a250-4a19-9e56-9cfbb4091e53";

test("email-sign-in pool receives one canonical email username, not the lifecycle placeholder", () => {
  const input = pendingUserCreateInput(placeholder, " Synthetic@Example.invalid ", " Synthetic Test ", "temporary-secret");
  assert.equal(input.Username, "synthetic@example.invalid");
  assert.notEqual(input.Username, placeholder);
  assert.equal(input.MessageAction, "SUPPRESS");
  assert.equal(input.ForceAliasCreation, false);
  assert.deepEqual(input.UserAttributes, [
    { Name: "email", Value: "synthetic@example.invalid" },
    { Name: "name", Value: "Synthetic Test" },
  ]);
});

test("malformed lifecycle placeholder, email, or name fails closed", () => {
  assert.throws(() => pendingUserCreateInput("not-a-uuid", "synthetic@example.invalid", "Synthetic Test", "secret"));
  assert.throws(() => pendingUserCreateInput(placeholder, "bad-email", "Synthetic Test", "secret"));
  assert.throws(() => pendingUserCreateInput(placeholder, "synthetic@example.invalid", " ", "secret"));
});
