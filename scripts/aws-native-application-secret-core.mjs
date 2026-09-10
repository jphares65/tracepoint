import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

export const AWS_NATIVE_APPLICATION_SECRET_KEYS = Object.freeze([
  "CONFIGURATION_ENVIRONMENT", "NEXT_PUBLIC_SITE_URL", "NOTIFICATION_DISPATCH_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "TRACEPOINT_IMPORT_APPROVAL_SECRET",
  "TRACEPOINT_AUTH_STATE_KEYS", "TRACEPOINT_AUTH_REFRESH_KEYS",
]);
const forbidden = /SUPABASE|BREVO|VERCEL/i;
const keyring = () => JSON.stringify({ active: "v1", keys: { v1: randomBytes(32).toString("base64url") } });

export function createAwsNativeApplicationSecret(environment) {
  assert.ok(["staging", "production"].includes(environment));
  return {
    CONFIGURATION_ENVIRONMENT: environment,
    NEXT_PUBLIC_SITE_URL: environment === "production" ? "https://tracepointhq.com" : "https://staging.tracepointhq.com",
    NOTIFICATION_DISPATCH_SECRET: randomBytes(32).toString("base64url"),
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TRACEPOINT_IMPORT_APPROVAL_SECRET: randomBytes(32).toString("base64url"),
    TRACEPOINT_AUTH_STATE_KEYS: keyring(),
    TRACEPOINT_AUTH_REFRESH_KEYS: keyring(),
  };
}

export function validateAwsNativeApplicationSecret(secret, environment) {
  assert.deepEqual(Object.keys(secret).sort(), [...AWS_NATIVE_APPLICATION_SECRET_KEYS].sort());
  assert.equal(Object.keys(secret).some(key => forbidden.test(key)), false);
  assert.equal(secret.CONFIGURATION_ENVIRONMENT, environment);
  assert.equal(secret.NEXT_PUBLIC_SITE_URL, environment === "production" ? "https://tracepointhq.com" : "https://staging.tracepointhq.com");
  assert.match(secret.NOTIFICATION_DISPATCH_SECRET, /^[A-Za-z0-9_-]{43}$/);
  assert.match(secret.TRACEPOINT_IMPORT_APPROVAL_SECRET, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(secret.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, "base64").length, 32);
  for (const name of ["TRACEPOINT_AUTH_STATE_KEYS", "TRACEPOINT_AUTH_REFRESH_KEYS"]) {
    const parsed = JSON.parse(secret[name]);
    assert.equal(parsed.active, "v1");
    assert.match(parsed.keys.v1, /^[A-Za-z0-9_-]{43}$/);
  }
  return true;
}
