import assert from "node:assert/strict";

export const TRANSIENT_TABLES = Object.freeze([
  "authentication_flow_transactions", "authentication_access_sessions", "authentication_refresh_sessions",
  "authentication_session_revocations", "authentication_lifecycle_operations", "user_activation_tokens",
  "notification_email_queue",
]);
export const TARGET_SEEDED_TABLES = Object.freeze(["roles", "permissions", "role_permissions", "feature_catalog"]);

const host = /^[a-z0-9][a-z0-9.-]+$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDatabaseMigrationPlan(plan) {
  assert.equal(plan.format, 1);
  assert.match(plan.runId, uuid);
  assert.match(plan.commit, /^[0-9a-f]{40}$/);
  assert.match(plan.expectedAwsAccount, /^\d{12}$/);
  assert.match(plan.source.host, host);
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
