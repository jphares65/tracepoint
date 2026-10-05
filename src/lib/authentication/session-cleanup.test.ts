import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

import { clearLocalSessionState, withoutLocalSessionCookies } from "./session-cleanup.ts";

test("expired application sessions clear Cognito, department, and support-mode state", () => {
  const response = clearLocalSessionState(NextResponse.redirect("https://tracepoint.test/login"));
  const cookies = response.cookies.getAll();

  for (const name of [
    "__Host-tracepoint-cognito-session",
    "__Host-tracepoint-cognito-flow",
    "tracepoint_department_id",
    "tracepoint_support_department_id",
  ]) {
    const cookie = cookies.find((value) => value.name === name);
    assert.equal(cookie?.value, "");
    assert.equal(cookie?.maxAge, 0);
    assert.equal(cookie?.path, "/");
    assert.equal(cookie?.httpOnly, true);
  }
});

test("login cleanup removes every local session cookie from the continued request", () => {
  const header = [
    "other=value",
    "__Host-tracepoint-cognito-session=malformed",
    "tracepoint_department_id=department",
    "tracepoint_support_department_id=support",
    "__Host-tracepoint-cognito-flow=flow",
  ].join("; ");
  assert.equal(withoutLocalSessionCookies(header), "other=value");
});
