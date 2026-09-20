import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const RUN_ID = "4272874f-bae4-49f4-a0b4-67a39cec2874";
export const AUTHORIZATION_REFERENCE = "TP-FINAL-DB-20260920-4272874FBAE4";
export const SOURCE_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-postgres-KOMJRk";
export const SOURCE_PROJECT_REF = "izlkwggluhlhzlumtzes";
export const DIRECT_SOURCE_HOST = `db.${SOURCE_PROJECT_REF}.supabase.co`;
export const SESSION_POOLER_SOURCE_HOST = "aws-1-us-east-1.pooler.supabase.com";
export const SOURCE_PORT = 5432;
export const SOURCE_DATABASE = "postgres";
export const AWS_ACCOUNT = "193644343389";
export const AWS_REGION = "us-east-1";
export const AWS_PROFILE = "tracepoint-production";
export const PRIOR_EXPOSED_RELATION_ROWS = 4723;
export const PRIOR_IDENTITIES = 96;
export const PRIOR_MEMBERSHIPS = 95;

export const APPROVED_SOURCE_CONNECTIONS = Object.freeze([
  Object.freeze({ kind: "direct", host: DIRECT_SOURCE_HOST, port: SOURCE_PORT, database: SOURCE_DATABASE, username: "postgres" }),
  Object.freeze({ kind: "session-pooler", host: SESSION_POOLER_SOURCE_HOST, port: SOURCE_PORT, database: SOURCE_DATABASE, username: `postgres.${SOURCE_PROJECT_REF}` }),
]);

const prohibitedSql = /\b(?:alter|analyze|call|copy|create|delete|drop|grant|insert|listen|lock|merge|notify|reassign|refresh|reindex|revoke|security|truncate|unlisten|update|vacuum)\b/i;
const allowedTransactionSql = /^(?:begin\s+transaction\s+isolation\s+level\s+repeatable\s+read\s+read\s+only|commit|rollback|set\s+local\s+statement_timeout\s*=\s*'\d+s'|select\b)/i;

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export const sha256 = value => createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");

export function assertSourceOnlySql(sql) {
  const normalized = String(sql).trim().replace(/;\s*$/, "");
  assert.match(normalized, allowedTransactionSql, "Source-only runner rejected a non-read-only SQL statement");
  assert.doesNotMatch(normalized, prohibitedSql, "Source-only runner rejected write or DDL SQL");
  return normalized;
}

export function validateInvocation({ runId, authorizationReference, secretArn, profile }) {
  assert.equal(runId, RUN_ID, "The approved migration run ID is required");
  assert.equal(authorizationReference, AUTHORIZATION_REFERENCE, "The approved database authorization reference is required");
  assert.equal(secretArn, SOURCE_SECRET_ARN, "Only the approved production source secret ARN is allowed");
  assert.equal(profile, AWS_PROFILE, "Only the production AWS profile is allowed");
  return { runId, authorizationReference, secretArn, profile };
}

export function validateSourceSecret(value) {
  const fail = code => { const error = new Error(code); error.code = code; throw error; };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("SOURCE_SECRET_NOT_AN_OBJECT");
  const keys = Object.keys(value).sort();
  const required = ["dbname", "host", "password", "port", "username"];
  if (required.some(key => !keys.includes(key))) fail("SOURCE_SECRET_MISSING_REQUIRED_KEY");
  if (keys.some(key => !required.includes(key))) fail("SOURCE_SECRET_UNEXPECTED_KEY");
  const approved = APPROVED_SOURCE_CONNECTIONS.find(candidate => candidate.host === value.host);
  if (!approved) fail("SOURCE_SECRET_HOST_UNEXPECTED");
  if (Number(value.port) !== approved.port) fail("SOURCE_SECRET_PORT_INVALID");
  if (value.dbname !== approved.database) fail("SOURCE_SECRET_DATABASE_INVALID");
  if (value.username !== approved.username) fail("SOURCE_SECRET_USERNAME_PROJECT_MISMATCH");
  if (typeof value.password !== "string" || value.password.length === 0) fail("SOURCE_SECRET_PASSWORD_INVALID");
  return { host: value.host, port: approved.port, database: value.dbname, user: value.username, password: value.password, endpointKind: approved.kind };
}

export function quoteIdentifier(identifier) {
  assert.match(identifier, /^[a-z][a-z0-9_]*$/, "Unexpected migration relation name");
  return `"${identifier}"`;
}

export function createSanitizedEvidence(input) {
  const tables = [...input.tables].map(row => ({ name: row.name, kind: row.kind, rows: String(row.rows) })).sort((left, right) => left.name.localeCompare(right.name));
  const baseTableRowCount = tables.filter(row => row.kind === "table").reduce((total, row) => total + Number(row.rows), 0);
  const exposedRelationRowCount = tables.reduce((total, row) => total + Number(row.rows), 0);
  const payload = {
    format: "tracepoint-source-only-ledger/v1",
    runId: RUN_ID,
    authorizationReference: AUTHORIZATION_REFERENCE,
    capturedAtUtc: input.capturedAtUtc,
    source: { host: input.source.host, port: input.source.port, database: input.source.database, endpointKind: input.source.endpointKind, projectRef: SOURCE_PROJECT_REF, tlsVerified: true },
    transaction: { readOnly: true, isolation: "repeatable read", snapshotId: input.snapshotId ?? null, lsn: input.lsn ?? null },
    postgresVersion: input.postgresVersion,
    tables,
    totalRelationalRowCount: baseTableRowCount,
    exposedRelationRowCount,
    migrationLedger: { count: input.migrationVersions.length, sha256: sha256([...input.migrationVersions].map(String)) },
    identities: input.identities,
    sourcePrivileges: input.sourcePrivileges,
    comparison: {
      priorExposedRelationRows: PRIOR_EXPOSED_RELATION_ROWS,
      freshExposedRelationRows: exposedRelationRowCount,
      delta: exposedRelationRowCount - PRIOR_EXPOSED_RELATION_ROWS,
      priorIdentities: PRIOR_IDENTITIES,
      freshIdentities: input.identities.identityCount,
      identityDelta: input.identities.identityCount - PRIOR_IDENTITIES,
      priorMemberships: PRIOR_MEMBERSHIPS,
      freshMemberships: input.identities.membershipCount,
      membershipDelta: input.identities.membershipCount - PRIOR_MEMBERSHIPS,
    },
    privacy: { credentialsEmitted: false, recordContentsEmitted: false, emailsEmitted: false, userIdsEmitted: false, targetClientsInitialized: false },
  };
  return { ...payload, contentSha256: sha256(payload) };
}
