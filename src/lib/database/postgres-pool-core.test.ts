import assert from "node:assert/strict";
import test from "node:test";
import { finalProductionDatabaseHost, parsePostgresPoolConfiguration, shadowDatabaseHost } from "./postgres-pool-core.ts";

const secret = { host: "tracepoint.cluster-abc123.us-east-1.rds.amazonaws.com", port: 5432, username: "tracepoint_app", password: "synthetic-password-at-least-twenty", dbname: "tracepoint" };
const valid = { TRACEPOINT_DATA_PROVIDER: "postgres", AWS_REGION: "us-east-1", TRACEPOINT_DATABASE_CA_PATH: "/app/rds-ca.pem", TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify(secret) };

test("accepts strict RDS TLS configuration for commercial and GovCloud regions", () => {
  assert.equal(parsePostgresPoolConfiguration(valid).maximumConnections, 10);
  const gov = parsePostgresPoolConfiguration({ ...valid, AWS_REGION: "us-gov-west-1", TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, host: "tracepoint.abc123.us-gov-west-1.rds.amazonaws.com" }) });
  assert.equal(gov.region, "us-gov-west-1");
});

test("rejects non-AWS hosts, weak or malformed secrets, and unbounded pools", () => {
  for (const environment of [
    { ...valid, TRACEPOINT_DATA_PROVIDER: "supabase" },
    { ...valid, AWS_REGION: "eu-central-1" },
    { ...valid, TRACEPOINT_DATABASE_CA_PATH: "" },
    { ...valid, TRACEPOINT_DATABASE_SECRET_JSON: "not-json" },
    { ...valid, TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, host: "db.example.com" }) },
    { ...valid, TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, password: "short" }) },
    { ...valid, TRACEPOINT_DATABASE_POOL_MAX: "21" },
  ]) assert.throws(() => parsePostgresPoolConfiguration(environment));
});

test("shadow mode pins the quarantined database host", () => {
  const shadowHost = "tracepoint-production-migration-clean-4272874f-final.c8r4sgs089tu.us-east-1.rds.amazonaws.com";
  assert.equal(parsePostgresPoolConfiguration({
    ...valid,
    TRACEPOINT_NOTIFICATION_MODE: "shadow",
    TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, host: shadowHost }),
  }).secret.host, shadowHost);
  assert.throws(() => parsePostgresPoolConfiguration({ ...valid, TRACEPOINT_NOTIFICATION_MODE: "shadow" }));
});

test("rehearsal object smoke pins its own origin and RDS host without relaxing Phase 3B", () => {
  const rehearsalHost = "tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com";
  const rehearsal = {
    ...valid,
    TRACEPOINT_NOTIFICATION_MODE: "shadow",
    TRACEPOINT_REHEARSAL_APP_MODE: "object-smoke",
    NEXT_PUBLIC_SITE_URL: "https://shadow-rehearsal.tracepointhq.com",
    TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, host: rehearsalHost }),
  };
  assert.equal(parsePostgresPoolConfiguration(rehearsal).secret.host, rehearsalHost);
  for (const change of [
    { NEXT_PUBLIC_SITE_URL: "https://shadow.tracepointhq.com" },
    { TRACEPOINT_NOTIFICATION_MODE: "normal" },
    { TRACEPOINT_REHEARSAL_APP_MODE: "off" },
    { TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, host: shadowDatabaseHost }) },
  ]) assert.throws(() => parsePostgresPoolConfiguration({ ...rehearsal, ...change }));
});

test("production AWS-native runtime pins only the attested final target", () => {
  const production = {
    ...valid,
    CONFIGURATION_ENVIRONMENT: "production",
    TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native",
    TRACEPOINT_NOTIFICATION_MODE: "normal",
    NEXT_PUBLIC_SITE_URL: "https://tracepointhq.com",
    TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, host: finalProductionDatabaseHost }),
  };
  assert.equal(parsePostgresPoolConfiguration(production).secret.host, finalProductionDatabaseHost);
  for (const change of [
    { TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, host: shadowDatabaseHost }) },
    { TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ ...secret, host: "tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com" }) },
    { TRACEPOINT_NOTIFICATION_MODE: "shadow" },
    { NEXT_PUBLIC_SITE_URL: "https://staging.tracepointhq.com" },
    { NEXT_PUBLIC_SITE_URL: undefined },
    { AWS_REGION: "us-east-2" },
  ]) assert.throws(() => parsePostgresPoolConfiguration({ ...production, ...change }));
  assert.equal(parsePostgresPoolConfiguration(valid).secret.host, secret.host);
});
