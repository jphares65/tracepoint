import assert from "node:assert/strict";
import test from "node:test";

import {
  getTracePointEnvironmentIndicator,
  resolveTracePointEnvironment,
} from "./environment-indicator.ts";

test("configuration staging takes precedence over a Vercel preview", () => {
  assert.deepEqual(
    getTracePointEnvironmentIndicator({
      configurationEnvironment: "staging",
      vercelEnvironment: "preview",
      nodeEnvironment: "production",
    }),
    {
      environment: "staging",
      label: "STAGING",
      title: "Environment: Staging",
    },
  );
});

test("Vercel previews are labeled when no configuration environment overrides them", () => {
  assert.equal(
    resolveTracePointEnvironment({
      vercelEnvironment: "preview",
      nodeEnvironment: "production",
    }),
    "preview",
  );
});

test("production does not render an environment indicator", () => {
  assert.equal(
    getTracePointEnvironmentIndicator({
      configurationEnvironment: "production",
      vercelEnvironment: "production",
      nodeEnvironment: "production",
    }),
    null,
  );
});

test("unknown configuration is surfaced instead of being mistaken for production", () => {
  assert.equal(
    resolveTracePointEnvironment({
      configurationEnvironment: "qa",
      vercelEnvironment: "production",
      nodeEnvironment: "production",
    }),
    "unknown",
  );
  assert.equal(
    resolveTracePointEnvironment({ nodeEnvironment: "development" }),
    "development",
  );
});
