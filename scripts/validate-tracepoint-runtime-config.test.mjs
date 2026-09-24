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

test('AWS-native shadow requires isolated site, quarantined RDS, and no legacy credentials',()=>{
 const ring=JSON.stringify({active:'v1',keys:{v1:Buffer.alloc(32,1).toString('base64url')}});
 const native={
  CONFIGURATION_ENVIRONMENT:'production',NEXT_PUBLIC_SITE_URL:'https://shadow.tracepointhq.com',
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:'synthetic',TRACEPOINT_RUNTIME_PROVIDER_MODE:'aws-native',
  TRACEPOINT_DATA_PROVIDER:'postgres',TRACEPOINT_AUTH_PROVIDER:'cognito',TRACEPOINT_EMAIL_PROVIDER:'ses',
  TRACEPOINT_STORAGE_PROVIDER:'s3',TRACEPOINT_NOTIFICATION_MODE:'shadow',AWS_REGION:'us-east-1',
  TRACEPOINT_AWS_ACCOUNT_ID:'193644343389',TRACEPOINT_DATABASE_CA_PATH:'/app/rds-ca.pem',
  TRACEPOINT_DATABASE_SECRET_JSON:JSON.stringify({host:'tracepoint-production-migration-clean-4272874f-final.c8r4sgs089tu.us-east-1.rds.amazonaws.com',port:5432,dbname:'tracepoint',username:'tracepoint_app',password:'synthetic-password-at-least-twenty'}),
  TRACEPOINT_AUTH_STATE_KEYS:ring,TRACEPOINT_AUTH_REFRESH_KEYS:ring,
  TRACEPOINT_COGNITO_USER_POOL_ID:'us-east-1_synthetic',TRACEPOINT_COGNITO_CLIENT_ID:'synthetic',
  TRACEPOINT_S3_BUCKET:'tracepoint-production-private-193644343389',TRACEPOINT_S3_EXPECTED_OWNER:'193644343389',
 };
 assert.doesNotThrow(()=>validateTracePointRuntimeConfig(native));
 assert.throws(()=>validateTracePointRuntimeConfig({...native,NEXT_PUBLIC_SITE_URL:'https://tracepointhq.com'}),/NEXT_PUBLIC_SITE_URL/);
 assert.throws(()=>validateTracePointRuntimeConfig({...native,TRACEPOINT_DATABASE_SECRET_JSON:JSON.stringify({...JSON.parse(native.TRACEPOINT_DATABASE_SECRET_JSON),host:'other.c8r4sgs089tu.us-east-1.rds.amazonaws.com'})}),/TRACEPOINT_DATABASE_SECRET_JSON/);
 assert.throws(()=>validateTracePointRuntimeConfig({...native,NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co'}),/NEXT_PUBLIC_SUPABASE_URL/);
 const rehearsal={...native,TRACEPOINT_REHEARSAL_APP_MODE:'object-smoke',NEXT_PUBLIC_SITE_URL:'https://shadow-rehearsal.tracepointhq.com',TRACEPOINT_DATABASE_SECRET_JSON:JSON.stringify({...JSON.parse(native.TRACEPOINT_DATABASE_SECRET_JSON),host:'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com'})};
 assert.doesNotThrow(()=>validateTracePointRuntimeConfig(rehearsal));
 assert.throws(()=>validateTracePointRuntimeConfig({...rehearsal,TRACEPOINT_DATABASE_SECRET_JSON:native.TRACEPOINT_DATABASE_SECRET_JSON}),/TRACEPOINT_DATABASE_SECRET_JSON/);
 assert.throws(()=>validateTracePointRuntimeConfig({...rehearsal,NEXT_PUBLIC_SITE_URL:native.NEXT_PUBLIC_SITE_URL}),/TRACEPOINT_REHEARSAL_APP_MODE/);
 assert.throws(()=>validateTracePointRuntimeConfig({...native,TRACEPOINT_REHEARSAL_APP_MODE:'object-smoke'}),/TRACEPOINT_REHEARSAL_APP_MODE/);
 assert.throws(()=>validateTracePointRuntimeConfig({...rehearsal,TRACEPOINT_NOTIFICATION_MODE:'normal'}),/TRACEPOINT_REHEARSAL_APP_MODE/);
});
