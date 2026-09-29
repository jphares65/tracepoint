import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COGNITO_PASSWORD_MIN_LENGTH, COGNITO_PASSWORD_REQUIREMENTS, isCognitoCompliantPassword } from "./password-policy.ts";

test("Cognito password validator matches the proposed production pool policy", () => {
  assert.equal(COGNITO_PASSWORD_MIN_LENGTH, 10);
  assert.equal(isCognitoCompliantPassword("Aa1!aaaaa"), false); // 9 characters
  assert.equal(isCognitoCompliantPassword("Aa1!aaaaaa"), true); // 10 characters
  assert.equal(isCognitoCompliantPassword("Aa1 aaaaaa"), true); // interior space is Cognito-supported
  assert.equal(isCognitoCompliantPassword("Aa1éaaaaaa"), false); // unrelated Unicode is not a required symbol
  assert.match(COGNITO_PASSWORD_REQUIREMENTS, /at least 10 characters/);
  for (const item of ["uppercase", "lowercase", "number", "symbol"]) assert.match(COGNITO_PASSWORD_REQUIREMENTS, new RegExp(item));
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

test("Administrator password form uses the same Cognito validator and help text", () => {
  const form = readFileSync(new URL("../../app/settings/AssignPasswordModal.tsx", import.meta.url), "utf8");
  assert.match(form, /if \(!isCognitoCompliantPassword\(password\)\)/);
  assert.match(form, /setLocalError\(COGNITO_PASSWORD_REQUIREMENTS\)/);
  assert.match(form, /minLength=\{COGNITO_PASSWORD_MIN_LENGTH\}/);
  assert.match(form, /\{COGNITO_PASSWORD_REQUIREMENTS\}<\/p>/);
});

test("Administrator assignment and recovery submit through the shared validator", () => {
  const directory = readFileSync(new URL("cognito-admin.ts", import.meta.url), "utf8");
  assert.match(directory, /async setPermanentPassword\([^\n]+!isCognitoCompliantPassword\(password\)/);
  assert.match(directory, /async completePasswordReset\([^\n]+!isCognitoCompliantPassword\(password\)/);
});
