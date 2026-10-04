import assert from "node:assert/strict";
import test from "node:test";

import { resolveLoginSession } from "./login-session-core.ts";
import { InvalidApplicationSessionCookieError } from "./request-session-core.ts";

test("/login without an application session remains unauthenticated and is cleaned", async () => {
  const result = await resolveLoginSession(async () => null);
  assert.deepEqual(result, { principal: null, requiresCleanup: true });
});

test("/login with a malformed application session remains unauthenticated and is cleaned", async () => {
  const result = await resolveLoginSession(async () => {
    throw new InvalidApplicationSessionCookieError();
  });
  assert.deepEqual(result, { principal: null, requiresCleanup: true });
});

test("/login with an expired application session remains unauthenticated and is cleaned", async () => {
  const result = await resolveLoginSession(async () => null);
  assert.deepEqual(result, { principal: null, requiresCleanup: true });
});

test("/login with a valid authenticated session keeps the authenticated principal", async () => {
  const principal = { userId: "user-1" };
  const result = await resolveLoginSession(async () => principal);
  assert.deepEqual(result, { principal, requiresCleanup: false });
});

test("/login treats a session verification failure as anonymous local state", async () => {
  const result = await resolveLoginSession(async () => {
    throw new Error("Application session could not be verified.");
  });
  assert.deepEqual(result, { principal: null, requiresCleanup: true });
});
