import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { COGNITO_PASSWORD_MIN_LENGTH, COGNITO_PASSWORD_REQUIREMENTS, isCognitoCompliantPassword } from "./password-policy.ts";

test("Cognito password validator matches the 14-character pool policy", () => {
  assert.equal(COGNITO_PASSWORD_MIN_LENGTH, 14);
  assert.equal(isCognitoCompliantPassword("Aa1!aaaaaaaaa"), false); // 13 characters
  assert.equal(isCognitoCompliantPassword("Aa1!aaaaaaaaaa"), true); // 14 characters
  assert.equal(isCognitoCompliantPassword("Aa1 aaaaaaaaaa"), true); // interior space is Cognito-supported
  assert.equal(isCognitoCompliantPassword("Aa1éaaaaaaaaaa"), false); // unrelated Unicode is not a required symbol
  assert.match(COGNITO_PASSWORD_REQUIREMENTS, /at least 14 characters/);
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

// infra/ is not in the application image build context (.dockerignore): checked wherever the repository is complete.
test("The application minimum is the one the Cognito pools in infra declare", { skip: !existsSync(new URL("../../../infra/lib/cognito-foundation-stack.ts", import.meta.url)) && "infra/ is not in the image build context" }, () => {
  const foundation = readFileSync(new URL("../../../infra/lib/cognito-foundation-stack.ts", import.meta.url), "utf8");
  const rehearsal = readFileSync(new URL("../../../infra/lib/phase3c-rehearsal-app-stack.ts", import.meta.url), "utf8");
  assert.deepEqual([...foundation.matchAll(/passwordPolicy:\{minLength:(\d+)/g)].map((match) => Number(match[1])), [COGNITO_PASSWORD_MIN_LENGTH]);
  assert.deepEqual([...rehearsal.matchAll(/passwordPolicy: \{ minimumLength: (\d+)/g)].map((match) => Number(match[1])), [COGNITO_PASSWORD_MIN_LENGTH]);
});

test("Password pages that set a new password use the shared minimum, never a separate number", () => {
  for (const page of ["../../app/activate/page.tsx", "../../app/auth/setup/page.tsx", "../../app/api/settings/users/assign-password/route.ts"]) {
    const source = readFileSync(new URL(page, import.meta.url), "utf8");
    assert.doesNotMatch(source, /password\.length < \d|minLength=\{\d|at least \d+ characters/, page);
    assert.match(source, /password\.length < COGNITO_PASSWORD_MIN_LENGTH/, page);
  }
});
