import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { parseCognitoRuntimeConfiguration, parseCognitoTargetConfiguration } from "./cognito-runtime-configuration-core.ts";

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
  NEXT_PUBLIC_SITE_URL: "https://staging.tracepointhq.com",
  TRACEPOINT_NOTIFICATION_MODE: "normal",
  TRACEPOINT_COGNITO_MOBILE_CLIENT_ID: "syntheticmobileclient",
  TRACEPOINT_AUTH_STATE_KEYS: JSON.stringify({ active: "current", keys: { current: key() } }),
  TRACEPOINT_AUTH_REFRESH_KEYS: JSON.stringify({ active: "current", keys: { current: key() } }),
};

test("parses a bounded AWS-native Cognito key configuration", () => {
  const configuration = parseCognitoRuntimeConfiguration(valid);
  assert.equal(configuration.verification.account, "559054714699");
  assert.equal(configuration.verification.clientId, "syntheticclient");
  assert.equal(configuration.verification.siteOrigin, "https://staging.tracepointhq.com");
  assert.deepEqual(configuration.verification.trustedClientIds, ["syntheticclient", "syntheticmobileclient"]);
  assert.equal(configuration.state.keys.get("current")?.byteLength, 32);
  assert.equal(configuration.refresh.keys.get("current")?.byteLength, 32);
});

test("rejects bridge, mixed-account and malformed key configurations", () => {
  for (const environment of [
    { ...valid, TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge" },
    { ...valid, TRACEPOINT_AUTH_PROVIDER: "supabase" },
    { ...valid, TRACEPOINT_AWS_ACCOUNT_ID: "265544358665" },
    { ...valid, TRACEPOINT_AUTH_STATE_KEYS: "not-json" },
    { ...valid, TRACEPOINT_COGNITO_MOBILE_CLIENT_ID: "syntheticclient" },
    { ...valid, TRACEPOINT_COGNITO_MOBILE_CLIENT_ID: "invalid client" },
    { ...valid, NEXT_PUBLIC_SITE_URL: "" },
    { ...valid, NEXT_PUBLIC_SITE_URL: "http://staging.tracepointhq.com" },
    { ...valid, TRACEPOINT_NOTIFICATION_MODE: "shadow" },
    { ...valid, TRACEPOINT_AUTH_STATE_KEYS: JSON.stringify({ active: "missing", keys: { current: key() } }) },
    { ...valid, TRACEPOINT_AUTH_REFRESH_KEYS: JSON.stringify({ active: "current", keys: { current: "short" } }) },
  ]) assert.throws(() => parseCognitoRuntimeConfiguration(environment));
});
test("production normal and shadow origins are exact and fail closed", () => {
  const production={...valid,CONFIGURATION_ENVIRONMENT:"production",TRACEPOINT_AWS_ACCOUNT_ID:"193644343389",TRACEPOINT_COGNITO_USER_POOL_ID:"us-east-1_diFmWDMe9",TRACEPOINT_COGNITO_CLIENT_ID:"9tfp383dgjuvanhnh94bstafr"};
  assert.equal(parseCognitoRuntimeConfiguration({...production,NEXT_PUBLIC_SITE_URL:"https://tracepointhq.com"}).verification.siteOrigin,"https://tracepointhq.com");
  assert.throws(() => parseCognitoRuntimeConfiguration({...production,TRACEPOINT_COGNITO_USER_POOL_ID:"us-east-1_Other",NEXT_PUBLIC_SITE_URL:"https://tracepointhq.com"}), /reviewed authority/);
  assert.throws(() => parseCognitoRuntimeConfiguration({...production,TRACEPOINT_COGNITO_CLIENT_ID:"otherclient",NEXT_PUBLIC_SITE_URL:"https://tracepointhq.com"}), /reviewed authority/);
  assert.equal(parseCognitoRuntimeConfiguration({...production,TRACEPOINT_NOTIFICATION_MODE:"shadow",NEXT_PUBLIC_SITE_URL:"https://shadow.tracepointhq.com"}).verification.siteOrigin,"https://shadow.tracepointhq.com");
  for(const siteOrigin of ["https://tracepointhq.com","http://shadow.tracepointhq.com","https://shadow.tracepointhq.com.evil.invalid","https://shadow.tracepointhq.com/"])
    assert.throws(()=>parseCognitoRuntimeConfiguration({...production,TRACEPOINT_NOTIFICATION_MODE:"shadow",NEXT_PUBLIC_SITE_URL:siteOrigin}),/redirect origin/);
});

test("dedicated rehearsal mode cannot use the shared pool or a different origin", () => {
  const rehearsal = { ...valid, CONFIGURATION_ENVIRONMENT: "production",
    TRACEPOINT_AWS_ACCOUNT_ID: "193644343389",
    TRACEPOINT_COGNITO_USER_POOL_ID: "us-east-1_Dedicated",
    TRACEPOINT_COGNITO_MOBILE_CLIENT_ID: undefined,
    TRACEPOINT_REHEARSAL_APP_MODE: "object-smoke",
    TRACEPOINT_NOTIFICATION_MODE: "shadow",
    NEXT_PUBLIC_SITE_URL: "https://shadow-rehearsal.tracepointhq.com" };
  assert.equal(parseCognitoRuntimeConfiguration(rehearsal).verification.rehearsalMode, "object-smoke");
  assert.throws(() => parseCognitoRuntimeConfiguration({ ...rehearsal, TRACEPOINT_COGNITO_USER_POOL_ID: "us-east-1_diFmWDMe9" }));
  assert.throws(() => parseCognitoRuntimeConfiguration({ ...rehearsal, NEXT_PUBLIC_SITE_URL: "https://shadow.tracepointhq.com" }));
  assert.throws(() => parseCognitoRuntimeConfiguration({ ...rehearsal, TRACEPOINT_NOTIFICATION_MODE: "normal" }));
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

test("accepts a production GovCloud target without exposing runtime keyrings", () => {
  const gov = {
    ...valid,
    CONFIGURATION_ENVIRONMENT: "production",
    TRACEPOINT_AWS_ACCOUNT_ID: "222222222222",
    AWS_REGION: "us-gov-west-1",
    TRACEPOINT_COGNITO_USER_POOL_ID: "us-gov-west-1_Synthetic",
  };
  assert.equal(parseCognitoTargetConfiguration(gov).verification.region, "us-gov-west-1");
  assert.throws(() => parseCognitoTargetConfiguration({ ...gov, TRACEPOINT_COGNITO_USER_POOL_ID: "us-east-1_Synthetic" }), /provider target/);
  assert.throws(() => parseCognitoTargetConfiguration({ ...valid, AWS_REGION: "us-gov-west-1", TRACEPOINT_COGNITO_USER_POOL_ID: "us-gov-west-1_Synthetic" }), /provider target/);
});
