import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

export const AWS_NATIVE_APPLICATION_SECRET_KEYS = Object.freeze([
  "CONFIGURATION_ENVIRONMENT", "NEXT_PUBLIC_SITE_URL", "NOTIFICATION_DISPATCH_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY", "TRACEPOINT_IMPORT_APPROVAL_SECRET",
  "TRACEPOINT_AUTH_STATE_KEYS", "TRACEPOINT_AUTH_REFRESH_KEYS",
]);
const forbidden = /SUPABASE|BREVO|VERCEL/i;
const keyring = () => JSON.stringify({ active: "v1", keys: { v1: randomBytes(32).toString("base64url") } });
const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/;
const encodedKeyPattern = /^[A-Za-z0-9_-]{43}$/;

function isCanonicalBase64Url32(value) {
  if (typeof value !== "string" || !encodedKeyPattern.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === 32 && decoded.toString("base64url") === value;
}

export function parseAwsNativeKeyring(raw, name) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${name} must be valid JSON.`); }
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed), `${name} must be a versioned keyring.`);
  assert.deepEqual(Object.keys(parsed).sort(), ["active", "keys"]);
  assert.match(parsed.active, keyIdPattern);
  assert.ok(parsed.keys && typeof parsed.keys === "object" && !Array.isArray(parsed.keys));
  const entries = Object.entries(parsed.keys);
  assert.ok(entries.length >= 1 && entries.length <= 3, `${name} must contain one to three keys.`);
  assert.ok(Object.hasOwn(parsed.keys, parsed.active), `${name} active key must exist.`);
  for (const [id, encoded] of entries) {
    assert.match(id, keyIdPattern);
    assert.ok(isCanonicalBase64Url32(encoded), `${name} contains invalid key material.`);
  }
  return parsed;
}

export function rotateAwsNativeKeyring(raw, name, now = new Date(), random = randomBytes) {
  const current = parseAwsNativeKeyring(raw, name);
  const id = `v${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  assert.ok(!Object.hasOwn(current.keys, id), `${name} already contains rotation id ${id}.`);
  return JSON.stringify({
    active: id,
    keys: { [id]: random(32).toString("base64url"), [current.active]: current.keys[current.active] },
  });
}

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
    parseAwsNativeKeyring(secret[name], name);
  }
  assert.notEqual(secret.TRACEPOINT_AUTH_STATE_KEYS, secret.TRACEPOINT_AUTH_REFRESH_KEYS);
  return true;
}
