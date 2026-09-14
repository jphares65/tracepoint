import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveVerifiedMobileBearer } from "./cognito-mobile-session-core";

const identity = { userId: "10000000-0000-4000-8000-000000000001", provider: "cognito" as const, issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic", subject: "20000000-0000-4000-8000-000000000002" };
test("requires both cryptographic identity verification and live provider confirmation", async () => {
  assert.deepEqual(await resolveVerifiedMobileBearer("token", { verifySession: async () => identity }, async (token) => token === "token"), { ...identity, email: "", fullName: "" });
  assert.equal(await resolveVerifiedMobileBearer("token", { verifySession: async () => null }, async () => true), null);
  assert.equal(await resolveVerifiedMobileBearer("token", { verifySession: async () => identity }, async () => false), null);
  assert.equal(await resolveVerifiedMobileBearer("token", { verifySession: async () => identity }, async () => { throw new Error("private provider detail"); }), null);
});
