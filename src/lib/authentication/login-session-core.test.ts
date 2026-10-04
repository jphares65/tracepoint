import assert from "node:assert/strict";
import test from "node:test";

import { resolveLoginSession } from "./login-session-core.ts";
import { uniqueCookieValue } from "./request-session-core.ts";

const sessionCookie = "__Host-tracepoint-cognito-session";
const validHandle = "a".repeat(43);

test("/login without an application session remains unauthenticated and is cleaned", async () => {
  const result = await resolveLoginSession(async () => null);
  assert.deepEqual(result, { principal: null, requiresCleanup: true });
});

test("/login with a malformed application session remains unauthenticated and is cleaned", async () => {
  const result = await resolveLoginSession(async () =>
    uniqueCookieValue(`${sessionCookie}=malformed`, sessionCookie),
  );
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

test("/login with a duplicated application-session cookie remains unauthenticated and is cleaned", async () => {
  const result = await resolveLoginSession(async () =>
    uniqueCookieValue(`${sessionCookie}=${validHandle}; ${sessionCookie}=${validHandle}`, sessionCookie),
  );
  assert.deepEqual(result, { principal: null, requiresCleanup: true });
});

test("/login does not silently swallow unrelated resolver failures", async () => {
  const failure = new Error("database unavailable");
  await assert.rejects(resolveLoginSession(async () => {
    throw failure;
  }), failure);
});
