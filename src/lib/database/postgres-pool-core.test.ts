import assert from "node:assert/strict";
import test from "node:test";
import { parsePostgresPoolConfiguration } from "./postgres-pool-core.ts";

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
