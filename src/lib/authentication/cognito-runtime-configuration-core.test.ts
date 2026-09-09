import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { parseCognitoRuntimeConfiguration } from "./cognito-runtime-configuration-core.ts";

const key = () => randomBytes(32).toString("base64url");
const valid = {
  TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native",
  TRACEPOINT_DATA_PROVIDER: "postgres",
  TRACEPOINT_AUTH_PROVIDER: "cognito",
  CONFIGURATION_ENVIRONMENT: "staging",
  TRACEPOINT_AWS_ACCOUNT_ID: "559054714699",
  AWS_REGION: "us-east-1",
  TRACEPOINT_COGNITO_USER_POOL_ID: "us-east-1_Synthetic",
  TRACEPOINT_COGNITO_CLIENT_ID: "syntheticclient",
  TRACEPOINT_AUTH_STATE_KEYS: JSON.stringify({ active: "current", keys: { current: key() } }),
  TRACEPOINT_AUTH_REFRESH_KEYS: JSON.stringify({ active: "current", keys: { current: key() } }),
};

test("parses a bounded AWS-native Cognito key configuration", () => {
  const configuration = parseCognitoRuntimeConfiguration(valid);
  assert.equal(configuration.verification.account, "559054714699");
  assert.equal(configuration.state.keys.get("current")?.byteLength, 32);
  assert.equal(configuration.refresh.keys.get("current")?.byteLength, 32);
});

test("rejects bridge, mixed-account and malformed key configurations", () => {
  for (const environment of [
    { ...valid, TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge" },
    { ...valid, TRACEPOINT_AUTH_PROVIDER: "supabase" },
    { ...valid, TRACEPOINT_AWS_ACCOUNT_ID: "265544358665" },
    { ...valid, TRACEPOINT_AUTH_STATE_KEYS: "not-json" },
    { ...valid, TRACEPOINT_AUTH_STATE_KEYS: JSON.stringify({ active: "missing", keys: { current: key() } }) },
    { ...valid, TRACEPOINT_AUTH_REFRESH_KEYS: JSON.stringify({ active: "current", keys: { current: "short" } }) },
  ]) assert.throws(() => parseCognitoRuntimeConfiguration(environment));
});

test("accepts a bounded rotation window and rejects more than three keys", () => {
  const rotated = { current: key(), previous: key(), oldest: key() };
  assert.doesNotThrow(() => parseCognitoRuntimeConfiguration({
    ...valid,
    TRACEPOINT_AUTH_STATE_KEYS: JSON.stringify({ active: "current", keys: rotated }),
  }));
  assert.throws(() => parseCognitoRuntimeConfiguration({
    ...valid,
    TRACEPOINT_AUTH_STATE_KEYS: JSON.stringify({ active: "current", keys: { ...rotated, extra: key() } }),
  }));
});
