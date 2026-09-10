import assert from "node:assert/strict";
import test from "node:test";
import { databaseMigrationPlan, pgDumpArguments, reconcileMigrationLedgers, requireDatabaseMigrationExecution, SOURCE_MIGRATION_COUNT, TARGET_MIGRATION_COUNT, TARGET_SEEDED_TABLES, TRANSIENT_TABLES } from "./database-migration-core.mjs";

const env = {
  TRACEPOINT_MIGRATION_RUN_ID: "10000000-0000-4000-8000-000000000001", TRACEPOINT_SOURCE_COMMIT: "a".repeat(40),
  TRACEPOINT_EXPECTED_AWS_ACCOUNT: "559054714699", TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE: "owner-approval:synthetic",
  TRACEPOINT_SOURCE_PROJECT_REF: "abcdefghijklmnopqrst", SOURCE_PGHOST: "db.abcdefghijklmnopqrst.supabase.co", SOURCE_PGDATABASE: "postgres", SOURCE_DATABASE_CA_PATH: "/app/source-ca.pem",
  TARGET_PGHOST: "tracepoint-staging.abc.us-east-1.rds.amazonaws.com", TARGET_PGDATABASE: "tracepoint", TARGET_DATABASE_CA_PATH: "/app/rds-ca.pem",
};

test("pins a passwordless read-only-to-fresh-target migration plan", () => {
  const plan = databaseMigrationPlan(env);
  assert.equal(plan.passwordsMigrated, false);
  assert.deepEqual(plan.excludedTables, [...TRANSIENT_TABLES]);
  const args = pgDumpArguments(plan, "/tmp/data.dump", "snapshot-1");
  assert.ok(args.includes("--data-only"));
  assert.ok(TRANSIENT_TABLES.every(table => args.includes(`--exclude-table=public.${table}`)));
  assert.ok(TARGET_SEEDED_TABLES.every(table => args.includes(`--exclude-table=public.${table}`)));
});

test("requires all execution acknowledgements and a run-specific approval", () => {
  assert.throws(() => requireDatabaseMigrationExecution(["--execute"], { ...env, TRACEPOINT_DATABASE_MIGRATION_APPROVAL: env.TRACEPOINT_MIGRATION_RUN_ID }));
  assert.throws(() => requireDatabaseMigrationExecution(["--execute", "--acknowledge-source-read", "--acknowledge-target-write"], env));
  requireDatabaseMigrationExecution(["--execute", "--acknowledge-source-read", "--acknowledge-target-write"], { ...env, TRACEPOINT_DATABASE_MIGRATION_APPROVAL: env.TRACEPOINT_MIGRATION_RUN_ID });
});

test("rejects a non-RDS target", () => {
  assert.throws(() => databaseMigrationPlan({ ...env, TARGET_PGHOST: "db.example.test" }));
  assert.throws(() => databaseMigrationPlan({ ...env, TRACEPOINT_SOURCE_PROJECT_REF: "wrongwrongwrongwrongwr" }));
});

test("binds the exact source and target migration ledgers", () => {
  const source = Array.from({ length: SOURCE_MIGRATION_COUNT }, (_, index) => ({ version: `202609${String(index + 1).padStart(8, "0")}` }));
  const target = [
    ...source.map((row, index) => ({ kind: "source", name: `${row.version}_source_${index}.sql`, sha256: "a".repeat(64) })),
    ...Array.from({ length: TARGET_MIGRATION_COUNT - SOURCE_MIGRATION_COUNT }, (_, index) => ({ kind: "aws", name: `202610${String(index + 1).padStart(8, "0")}_aws_${index}.sql`, sha256: "b".repeat(64) })),
  ].sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : right.kind.localeCompare(left.kind));
  const evidence = reconcileMigrationLedgers(source, target);
  assert.match(evidence.sourceMigrationLedgerSha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.migrationLedgerSha256, /^[0-9a-f]{64}$/);
  assert.throws(() => reconcileMigrationLedgers(source, target.map((row, index) => index === 0 ? { ...row, sha256: "c" } : row)));
  assert.throws(() => reconcileMigrationLedgers(source.slice().reverse(), target));
});
