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
  TRACEPOINT_EMAIL_PROVIDER: "brevo",
  TRACEPOINT_STORAGE_PROVIDER: "supabase",
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
