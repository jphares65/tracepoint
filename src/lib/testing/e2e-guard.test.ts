import assert from "node:assert/strict";
import test from "node:test";

import { baseUrl, credentials, syntheticAgency } from "../../../e2e/support/env.ts";

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => (value === undefined ? delete process.env[key] : (process.env[key] = value)));
  try { run(); } finally { Object.entries(saved).forEach(([key, value]) => (value === undefined ? delete process.env[key] : (process.env[key] = value))); }
}

test("the staging end-to-end suite refuses production hosts", () => {
  for (const host of ["https://tracepointhq.com", "https://www.tracepointhq.com/", "https://TRACEPOINTHQ.com"]) {
    withEnv({ TRACEPOINT_E2E_BASE_URL: host }, () => assert.throws(() => baseUrl(), /Refusing to run end-to-end tests against production/));
  }
  withEnv({ TRACEPOINT_E2E_BASE_URL: undefined }, () => assert.equal(baseUrl(), "https://staging.tracepointhq.com"));
});

test("the suite needs an explicit synthetic agency and complete credentials", () => {
  withEnv({ TRACEPOINT_E2E_DEPARTMENT_ID: undefined, TRACEPOINT_E2E_DEPARTMENT_NAME: undefined }, () => assert.throws(() => syntheticAgency(), /synthetic staging agency/));
  withEnv({ TRACEPOINT_E2E_OFFICER_EMAIL: "o@example.test", TRACEPOINT_E2E_OFFICER_PASSWORD: "x", TRACEPOINT_E2E_OFFICER_TOTP_SECRET: undefined }, () => assert.equal(credentials("officer"), null));
});
