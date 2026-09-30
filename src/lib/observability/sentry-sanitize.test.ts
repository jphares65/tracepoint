import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeSentryEvent } from "./sentry-sanitize.ts";

test("Sentry sanitization removes authentication, credentials, bodies, and sensitive query data", () => {
  const event = sanitizeSentryEvent({ request: { method: "POST", url: "https://tracepointhq.com/api/armory/firearms/serial-123?access_token=secret&code_verifier=verifier", headers: { Authorization: "Bearer token", Cookie: "session=secret" }, data: { password: "password", temporaryPassword: "temporary", access_token: "access-token", refresh_token: "refresh-token", id_token: "identity-token", code_verifier: "verifier", mfaCode: "123456", totp: "123456", firearmSerial: "serial-123" } }, user: { email: "officer@example.com", ip_address: "192.0.2.1" }, breadcrumbs: [{ category: "console", message: "refresh_token=secret" }], extra: { refresh_token: "secret", database_url: "postgres://user:secret@example.com/db", aws_secret_access_key: "aws-secret" }, exception: { values: [{ type: "Error", value: "Authorization: Bearer eyJ.a.b", stacktrace: { frames: [{ filename: "app.js", function: "handler", lineno: 8, vars: { password: "x" } }] } }] } });
  assert.deepEqual(event.request, { method: "POST", url: "/api/armory/firearms" });
  assert.equal(event.user, undefined); assert.equal(event.breadcrumbs, undefined); assert.equal(event.extra, undefined);
  assert.doesNotMatch(JSON.stringify(event), /access_token|refresh_token|id_token|code_verifier|mfaCode|totp|Bearer eyJ|firearmSerial|officer@example|database_url|aws_secret_access_key/i);
});

test("Sentry sanitization retains ordinary exception and safe technical route context", () => {
  const event = sanitizeSentryEvent({ transaction: "/api/health", tags: { service: "tracepoint-api", runtime: "nodejs", "http.status_code": 500, ignored: "no" }, exception: { values: [{ type: "TypeError", value: "Connection failed", stacktrace: { frames: [{ filename: "server.js", function: "loadConfig", lineno: 42, colno: 3, in_app: true }] } }] } });
  assert.equal(event.transaction, "/api/health");
  assert.deepEqual(event.tags, { service: "tracepoint-api", runtime: "nodejs", "http.status_code": "500", route: "/api/health" });
  assert.deepEqual(event.exception?.values?.[0], { type: "TypeError", value: "Connection failed", stacktrace: { frames: [{ filename: "server.js", function: "loadConfig", lineno: 42, colno: 3, in_app: true }] } });
});
