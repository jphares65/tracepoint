import assert from "node:assert/strict";
import test from "node:test";
import { AWS_NATIVE_APPLICATION_SECRET_KEYS, createAwsNativeApplicationSecret, parseAwsNativeKeyring, rotateAwsNativeKeyring, validateAwsNativeApplicationSecret } from "./aws-native-application-secret-core.mjs";

test("creates an exact AWS-native secret without legacy-provider fields", () => {
  const secret = createAwsNativeApplicationSecret("staging");
  assert.equal(validateAwsNativeApplicationSecret(secret, "staging"), true);
  assert.deepEqual(Object.keys(secret).sort(), [...AWS_NATIVE_APPLICATION_SECRET_KEYS].sort());
  assert.equal(JSON.stringify(secret).match(/supabase|brevo|vercel/i), null);
});

test("rejects injected legacy and unknown fields", () => {
  const secret = createAwsNativeApplicationSecret("production");
  assert.throws(() => validateAwsNativeApplicationSecret({ ...secret, SUPABASE_SECRET_KEY: "forbidden" }, "production"));
});

test("validates and rotates bounded keyrings while retaining only the active predecessor", () => {
  const key = (byte) => Buffer.alloc(32, byte).toString("base64url");
  const prior = JSON.stringify({ active: "v2", keys: { v1: key(1), v2: key(2), retired: key(3) } });
  const rotated = parseAwsNativeKeyring(
    rotateAwsNativeKeyring(prior, "TRACEPOINT_AUTH_STATE_KEYS", new Date("2026-09-11T12:34:56Z"), () => Buffer.alloc(32, 4)),
    "TRACEPOINT_AUTH_STATE_KEYS",
  );
  assert.equal(rotated.active, "v20260911123456");
  assert.deepEqual(Object.keys(rotated.keys), ["v20260911123456", "v2"]);
  assert.equal(rotated.keys.v2, key(2));
  assert.equal(rotated.keys.v20260911123456, key(4));
});

test("rejects malformed, oversized, and non-canonical keyrings", () => {
  const key = Buffer.alloc(32, 1).toString("base64url");
  assert.throws(() => parseAwsNativeKeyring(JSON.stringify({ active: "missing", keys: { v1: key } }), "KEYRING"));
  assert.throws(() => parseAwsNativeKeyring(JSON.stringify({ active: "v1", keys: { v1: key }, extra: true }), "KEYRING"));
  assert.throws(() => parseAwsNativeKeyring(JSON.stringify({ active: "v1", keys: { v1: `${key}=` } }), "KEYRING"));
  assert.throws(() => parseAwsNativeKeyring(JSON.stringify({ active: "v1", keys: { v1: key, v2: key, v3: key, v4: key } }), "KEYRING"));
});
