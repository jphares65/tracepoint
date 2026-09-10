import assert from "node:assert/strict";
import test from "node:test";
import { validateTracePointRuntimeConfig } from "./validate-tracepoint-runtime-config.mjs";

const valid = {
  SUPABASE_SECRET_KEY: "present",
  BREVO_API_KEY: "present",
  NOTIFICATION_DISPATCH_SECRET: "present",
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "present",
  CONFIGURATION_ENVIRONMENT: "staging",
  NEXT_PUBLIC_SUPABASE_URL: "https://wztqqqashilusoppddxi.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "present",
  NEXT_PUBLIC_SITE_URL: "https://staging.tracepointhq.com",
  TRACEPOINT_DATA_PROVIDER: "supabase",
  TRACEPOINT_AUTH_PROVIDER: "supabase",
  TRACEPOINT_EMAIL_PROVIDER: "brevo",
  TRACEPOINT_STORAGE_PROVIDER: "supabase",
  TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge",
};

test("accepts complete Supabase and Brevo staging configuration", () => {
  assert.doesNotThrow(() => validateTracePointRuntimeConfig(valid));
});

test("reports variable names without exposing values", () => {
  const environment = { ...valid, BREVO_API_KEY: "", SUPABASE_SECRET_KEY: "sensitive-value" };
  assert.throws(
    () => validateTracePointRuntimeConfig(environment),
    (error) =>
      error instanceof Error &&
      error.message.includes("BREVO_API_KEY") &&
      !error.message.includes("sensitive-value"),
  );
});

test("fails closed for unsupported provider switches", () => {
  assert.throws(
    () => validateTracePointRuntimeConfig({ ...valid, TRACEPOINT_DATA_PROVIDER: "aurora" }),
    /TRACEPOINT_DATA_PROVIDER/,
  );
});

test("fails closed for a non-staging public site URL", () => {
  assert.throws(
    () => validateTracePointRuntimeConfig({ ...valid, NEXT_PUBLIC_SITE_URL: "https://tracepointhq.com" }),
    /NEXT_PUBLIC_SITE_URL/,
  );
});

test("production hosting keeps production providers and rejects staging credentials", () => {
 const production = { ...valid, CONFIGURATION_ENVIRONMENT: "production", NEXT_PUBLIC_SITE_URL: "https://tracepointhq.com", NEXT_PUBLIC_SUPABASE_URL: "https://izlkwggluhlhzlumtzes.supabase.co" };
 assert.doesNotThrow(() => validateTracePointRuntimeConfig(production));
 assert.throws(() => validateTracePointRuntimeConfig({...production,NEXT_PUBLIC_SUPABASE_URL:valid.NEXT_PUBLIC_SUPABASE_URL}), /NEXT_PUBLIC_SUPABASE_URL/);
 assert.throws(() => validateTracePointRuntimeConfig({...valid,CONFIGURATION_ENVIRONMENT:undefined}), /CONFIGURATION_ENVIRONMENT/);
});

test('S3 startup requires exact private staging bucket, account and region',()=>{
 const storage={...valid,TRACEPOINT_STORAGE_PROVIDER:'s3',TRACEPOINT_S3_EXPECTED_OWNER:'559054714699',TRACEPOINT_S3_BUCKET:'tracepoint-staging-private-559054714699',AWS_REGION:'us-east-1'};
 assert.doesNotThrow(()=>validateTracePointRuntimeConfig(storage));
 for(const override of [{TRACEPOINT_S3_BUCKET:'other'},{TRACEPOINT_S3_EXPECTED_OWNER:'265544358665'},{AWS_REGION:'us-west-2'},{TRACEPOINT_S3_EXPECTED_OWNER:undefined}])assert.throws(()=>validateTracePointRuntimeConfig({...storage,...override}));
});

test("accepts only the complete provider-free AWS runtime tuple", () => {
  const awsNative = {
    CONFIGURATION_ENVIRONMENT: "staging",
    NEXT_PUBLIC_SITE_URL: "https://staging.tracepointhq.com",
    NOTIFICATION_DISPATCH_SECRET: "dispatch-secret",
    NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "actions-secret",
    TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native",
    TRACEPOINT_DATA_PROVIDER: "postgres",
    TRACEPOINT_AUTH_PROVIDER: "cognito",
    TRACEPOINT_EMAIL_PROVIDER: "ses",
    TRACEPOINT_STORAGE_PROVIDER: "s3",
    AWS_REGION: "us-east-1",
    TRACEPOINT_DATABASE_CA_PATH: "/app/rds-ca.pem",
    TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({
      host: "tracepoint.cluster-abc123.us-east-1.rds.amazonaws.com",
      port: 5432,
      username: "tracepoint_app",
      password: "synthetic-password-long-enough",
      dbname: "tracepoint",
    }),
    TRACEPOINT_IMPORT_APPROVAL_SECRET: "import-secret",
    TRACEPOINT_AUTH_STATE_KEYS: JSON.stringify({ active: "current", keys: { current: "A".repeat(43) } }),
    TRACEPOINT_AUTH_REFRESH_KEYS: JSON.stringify({ active: "current", keys: { current: "B".repeat(43) } }),
    TRACEPOINT_AWS_ACCOUNT_ID: "559054714699",
    TRACEPOINT_COGNITO_USER_POOL_ID: "us-east-1_AbCdEf123",
    TRACEPOINT_COGNITO_CLIENT_ID: "client123",
    TRACEPOINT_SES_CONFIGURATION_SET: "tracepoint-staging",
    TRACEPOINT_FROM_EMAIL: "contact@tracepointhq.com",
    TRACEPOINT_S3_EXPECTED_OWNER: "559054714699",
    TRACEPOINT_S3_BUCKET: "tracepoint-staging-private-559054714699",
  };

  assert.doesNotThrow(() => validateTracePointRuntimeConfig(awsNative));
  assert.throws(
    () => validateTracePointRuntimeConfig({ ...awsNative, SUPABASE_SECRET_KEY: "must-not-be-present" }),
    /SUPABASE_SECRET_KEY/,
  );
  assert.throws(
    () => validateTracePointRuntimeConfig({ ...awsNative, TRACEPOINT_AUTH_PROVIDER: "supabase" }),
    /TRACEPOINT_AUTH_PROVIDER/,
  );
  for (const legacy of [
    { VERCEL_URL: "tracepoint.vercel.app" },
    { BREVO_SMTP_PASSWORD: "must-not-be-present" },
    { LEGACY_SUPABASE_ANON_KEY: "must-not-be-present" },
    { UNRELATED_ENDPOINT: "https://api.brevo.com/v3" },
  ]) assert.throws(() => validateTracePointRuntimeConfig({ ...awsNative, ...legacy }));
});
