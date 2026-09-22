import assert from "node:assert/strict";
import test from "node:test";

import { isCognitoCompliantPassword } from "./password-policy.ts";

test("Cognito password policy matches the deployed pool", () => {
  assert.equal(isCognitoCompliantPassword("Valid-Password1!"), true);
  for (const invalid of [
    "Short1!",
    "missing-uppercase1!",
    "MISSING-LOWERCASE1!",
    "MissingNumber!!",
    "MissingSymbol123",
    "Whitespace Only1 ",
    `Control1!Valid${String.fromCharCode(7)}`,
    `${"A".repeat(254)}a1!`,
  ]) assert.equal(isCognitoCompliantPassword(invalid), false, invalid);
});
