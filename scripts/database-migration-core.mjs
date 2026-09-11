import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const TRANSIENT_TABLES = Object.freeze([
  "authentication_flow_transactions", "authentication_access_sessions", "authentication_refresh_sessions",
  "authentication_session_revocations", "authentication_lifecycle_operations", "user_activation_tokens",
]);
export const TARGET_SEEDED_TABLES = Object.freeze(["roles", "permissions", "role_permissions", "feature_catalog"]);
export const SOURCE_MIGRATION_COUNT = 76;
export const TARGET_MIGRATION_COUNT = 94;

const host = /^[a-z0-9][a-z0-9.-]+$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function reconcileMigrationLedgers(sourceRows, targetRows) {
  const source = sourceRows.map(row => String(row.version));
  assert.equal(source.length, SOURCE_MIGRATION_COUNT);
  assert.equal(new Set(source).size, source.length);
  assert.ok(source.every(version => /^\d{14}$/.test(version)));
  const target = targetRows.map(row => ({ kind: String(row.kind), name: String(row.name), sha256: String(row.sha256) }));
  assert.equal(target.length, TARGET_MIGRATION_COUNT);
  assert.ok(target.every(row => ["source", "aws"].includes(row.kind) && /^\d{14}_.+\.sql$/.test(row.name) && /^[0-9a-f]{64}$/.test(row.sha256)));
  const targetSource = target.filter(row => row.kind === "source").map(row => row.name.slice(0, 14));
  assert.deepEqual(targetSource, source);
  assert.equal(target.filter(row => row.kind === "aws").length, TARGET_MIGRATION_COUNT - SOURCE_MIGRATION_COUNT);
  return { sourceMigrationLedgerSha256: sha256(source), migrationLedgerSha256: sha256(target) };
}

export function validateDatabaseMigrationPlan(plan) {
  assert.equal(plan.format, 1);
  assert.match(plan.runId, uuid);
  assert.match(plan.commit, /^[0-9a-f]{40}$/);
  assert.match(plan.expectedAwsAccount, /^\d{12}$/);
  assert.match(plan.source.host, host);
  assert.match(plan.sourceProjectRef, /^[a-z]{20}$/);
  assert.equal(plan.source.host, `db.${plan.sourceProjectRef}.supabase.co`);
  assert.match(plan.target.host, /^[a-z0-9-]+\.[a-z0-9.-]+\.rds\.amazonaws\.com$/);
  assert.equal(plan.source.port, 5432);
  assert.equal(plan.target.port, 5432);
  assert.notEqual(plan.source.host, plan.target.host);
  assert.equal(plan.source.readOnly, true);
  assert.equal(plan.target.mustBeFresh, true);
  assert.match(plan.source.database, /^[a-zA-Z0-9_-]{1,63}$/);
  assert.match(plan.target.database, /^[a-zA-Z0-9_-]{1,63}$/);
  assert.equal(plan.passwordsMigrated, false);
  assert.deepEqual(plan.excludedTables, [...TRANSIENT_TABLES]);
  assert.deepEqual(plan.targetSeededTables, [...TARGET_SEEDED_TABLES]);
  assert.equal(plan.sourceCaPath.startsWith("/"), true);
  assert.equal(plan.targetCaPath.startsWith("/"), true);
  assert.match(plan.authorizationReference, /^[A-Za-z0-9._:/-]{8,200}$/);
  return plan;
}

export function databaseMigrationPlan(environment) {
  const plan = {
    format: 1,
    runId: environment.TRACEPOINT_MIGRATION_RUN_ID,
    commit: environment.TRACEPOINT_SOURCE_COMMIT,
    expectedAwsAccount: environment.TRACEPOINT_EXPECTED_AWS_ACCOUNT,
    authorizationReference: environment.TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE,
    sourceProjectRef: environment.TRACEPOINT_SOURCE_PROJECT_REF,
    source: { host: environment.SOURCE_PGHOST, port: Number(environment.SOURCE_PGPORT || 5432), database: environment.SOURCE_PGDATABASE, readOnly: true },
    target: { host: environment.TARGET_PGHOST, port: Number(environment.TARGET_PGPORT || 5432), database: environment.TARGET_PGDATABASE, mustBeFresh: true },
    sourceCaPath: environment.SOURCE_DATABASE_CA_PATH,
    targetCaPath: environment.TARGET_DATABASE_CA_PATH,
    passwordsMigrated: false,
    excludedTables: [...TRANSIENT_TABLES],
    targetSeededTables: [...TARGET_SEEDED_TABLES],
  };
  return validateDatabaseMigrationPlan(plan);
}

export function requireDatabaseMigrationExecution(args, environment) {
  assert.deepEqual(args, ["--execute", "--acknowledge-source-read", "--acknowledge-target-write"]);
  assert.equal(environment.TRACEPOINT_DATABASE_MIGRATION_APPROVAL, environment.TRACEPOINT_MIGRATION_RUN_ID);
}

export function pgDumpArguments(plan, dumpPath, snapshot) {
  return ["--format=custom", "--data-only", "--no-owner", "--schema=public", `--snapshot=${snapshot}`,
    ...[...plan.excludedTables, ...plan.targetSeededTables].map(table => `--exclude-table=public.${table}`), "--file", dumpPath, plan.source.database];
}

export function pgRestoreArguments(plan, dumpPath) {
  return ["--data-only", "--no-owner", "--exit-on-error", "--dbname", plan.target.database, dumpPath];
}
