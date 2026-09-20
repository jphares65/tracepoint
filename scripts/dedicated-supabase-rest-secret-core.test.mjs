import assert from "node:assert/strict";
import test from "node:test";
import { createDedicatedSupabaseRestSecret, extractDedicatedSupabaseRestSecret, PRODUCTION_SUPABASE_URL } from "./dedicated-supabase-rest-secret-core.mjs";

const applicationSecret = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_SUPABASE_URL,
  SUPABASE_SECRET_KEY: "sb_secret_synthetic_test_only_value",
  unrelated: "must-not-copy",
});

test("copies only the approved Supabase REST fields", () => {
  assert.deepEqual(extractDedicatedSupabaseRestSecret(applicationSecret), {
    projectUrl: PRODUCTION_SUPABASE_URL,
    serviceRoleKey: "sb_secret_synthetic_test_only_value",
  });
});

test("rejects a different project or a non-service credential", () => {
  assert.throws(() => extractDedicatedSupabaseRestSecret({ ...applicationSecret, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }));
  assert.throws(() => extractDedicatedSupabaseRestSecret({ ...applicationSecret, SUPABASE_SECRET_KEY: "sb_publishable_synthetic_test_only_value" }));
});

test("uses the source secret only in memory and returns sanitized creation metadata", async () => {
  const calls = [];
  const client = {
    async getSecretValue(SecretId) {
      calls.push({ operation: "get", SecretId });
      return { SecretString: JSON.stringify(applicationSecret) };
    },
    async createSecret(Name, SecretString) {
      calls.push({ operation: "create", Name, parsed: JSON.parse(SecretString) });
      return { ARN: "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-supabase-rest-AbCdEf", Name, VersionId: "synthetic-version" };
    },
  };
  const result = await createDedicatedSupabaseRestSecret({
    client,
    applicationSecretArn: "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/application-mkGidl",
    destinationSecretName: "tracepoint/production/migration/source-supabase-rest",
  });
  assert.deepEqual(result, { ARN: "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-supabase-rest-AbCdEf", Name: "tracepoint/production/migration/source-supabase-rest", VersionId: "synthetic-version" });
  assert.deepEqual(calls, [
    { operation: "get", SecretId: "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/application-mkGidl" },
    { operation: "create", Name: "tracepoint/production/migration/source-supabase-rest", parsed: { projectUrl: PRODUCTION_SUPABASE_URL, serviceRoleKey: "sb_secret_synthetic_test_only_value" } },
  ]);
});
