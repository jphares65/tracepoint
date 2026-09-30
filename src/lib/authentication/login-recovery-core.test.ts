import assert from "node:assert/strict";
import test from "node:test";
import { shouldRedirectAuthenticatedLogin } from "./login-recovery-core";

const cognito = { userId: "11111111-1111-4111-8111-111111111111", provider: "cognito" as const, issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Test", subject: "22222222-2222-4222-8222-222222222222", email: "", fullName: "" };

test("a valid but baseline-unauthorized opaque Cognito session leaves /login available", () => {
  assert.equal(shouldRedirectAuthenticatedLogin(cognito, "aws-native", { isPlatformAdmin: false, hasActiveDepartmentMembership: false }), false);
});

test("authorized Cognito platform administrators and tenant members leave /login", () => {
  assert.equal(shouldRedirectAuthenticatedLogin(cognito, "aws-native", { isPlatformAdmin: true, hasActiveDepartmentMembership: false }), true);
  assert.equal(shouldRedirectAuthenticatedLogin(cognito, "aws-native", { isPlatformAdmin: false, hasActiveDepartmentMembership: true }), true);
});
