import assert from "node:assert/strict";
import test from "node:test";
import { AWS_NATIVE_APPLICATION_SECRET_KEYS, createAwsNativeApplicationSecret, validateAwsNativeApplicationSecret } from "./aws-native-application-secret-core.mjs";

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
