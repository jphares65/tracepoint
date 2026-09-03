import assert from "node:assert/strict";
import test from "node:test";
import { validateTracePointRuntimeConfig } from "./validate-tracepoint-runtime-config.mjs";

const valid = {
  SUPABASE_SECRET_KEY: "present",
  BREVO_API_KEY: "present",
  NOTIFICATION_DISPATCH_SECRET: "present",
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: "present",
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
