import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { AWS_MIGRATION_LEDGER, loadVerifiedAwsMigrations } from "./aws-migration-ledger.mjs";
import { normalizeTransactionalSql } from "./bootstrap-aws-postgres-target-core.mjs";
import { databaseMigrationPlan, pgDumpArguments, pgRestoreArguments, reconcileMigrationLedgers, requireDatabaseMigrationExecution, TARGET_MIGRATION_COUNT, TARGET_SEEDED_TABLES, TRANSIENT_TABLES } from "./database-migration-core.mjs";
import { normalizeMigrationSql } from "./migration-sql-core.mjs";
import { supabasePrerequisites } from "./postgres-bootstrap-prerequisites.mjs";

const run = promisify(execFile);
const startedAt = Date.now();
const timings = {};
let phase = "configuration";
const timed = async (name, operation) => { const start = Date.now(); try { return await operation(); } finally { timings[name] = Date.now() - start; } };
const plan = databaseMigrationPlan(process.env);
requireDatabaseMigrationExecution(process.argv.slice(2), process.env);
const metadataOrigin = process.env.ECS_CONTAINER_METADATA_URI_V4;
assert.match(metadataOrigin ?? "", /^http:\/\/169\.254\.170\.2\/v4\/[A-Za-z0-9_-]+$/);
const taskMetadata = await fetch(`${metadataOrigin}/task`, { redirect: "error", signal: AbortSignal.timeout(5000) }).then(response => { assert.equal(response.status, 200); return response.json(); });
assert.match(taskMetadata.TaskARN ?? "", new RegExp(`^arn:aws:ecs:us-east-1:${plan.expectedAwsAccount}:task/`));
const sourceSecret = JSON.parse(process.env.SOURCE_DATABASE_SECRET_JSON || "null");
const targetSecret = JSON.parse(process.env.TARGET_DATABASE_SECRET_JSON || "null");
delete process.env.SOURCE_DATABASE_SECRET_JSON;
delete process.env.TARGET_DATABASE_SECRET_JSON;
assert.ok(sourceSecret?.username && sourceSecret?.password && targetSecret?.username && targetSecret?.password);

const sourceCa = await readFile(plan.sourceCaPath, "utf8");
const targetCa = await readFile(plan.targetCaPath, "utf8");
const source = new pg.Client({ ...plan.source, user: sourceSecret.username, password: sourceSecret.password, ssl: { ca: sourceCa, rejectUnauthorized: true }, connectionTimeoutMillis: 15000 });
const target = new pg.Client({ ...plan.target, user: targetSecret.username, password: targetSecret.password, ssl: { ca: targetCa, rejectUnauthorized: true }, connectionTimeoutMillis: 15000 });
const directory = await mkdtemp(path.join(tmpdir(), "tracepoint-data-migration-"));
const dumpPath = path.join(directory, "public-data.dump");
const digest = value => createHash("sha256").update(value).digest("hex");
const manifestHash = value => digest(JSON.stringify(value));

async function sourceMigrations() {
  const files = (await readdir("supabase/migrations")).filter(file => /^\d+_.+\.sql$/.test(file)).sort();
  assert.equal(files.length, 76);
  return Promise.all(files.map(async name => { const sql = normalizeMigrationSql(await readFile(path.join("supabase/migrations", name), "utf8")); return { kind: "source", name, version: name.split("_")[0], sql, sha256: digest(sql) }; }));
}

async function applyMigration(client, migration) {
  const existing = await client.query("select sha256 from tracepoint_migrations.applied_migrations where kind=$1 and name=$2", [migration.kind, migration.name]);
  if (existing.rowCount) { assert.equal(existing.rows[0].sha256, migration.sha256, `Applied migration changed: ${migration.name}`); return false; }
  await client.query("begin");
  try {
    await client.query(normalizeTransactionalSql(migration.sql, migration.name));
    await client.query("insert into tracepoint_migrations.applied_migrations(kind,name,sha256) values($1,$2,$3)", [migration.kind, migration.name, migration.sha256]);
    await client.query("commit"); return true;
  } catch (error) { await client.query("rollback"); throw error; }
}

async function ensureSourceParity(client, versions, migrations) {
  const ledgerExists = (await client.query("select to_regclass('tracepoint_migrations.applied_migrations') is not null as present")).rows[0].present;
  if (!ledgerExists) {
    assert.equal(Number((await client.query("select count(*)::int as count from pg_tables where schemaname='public'")).rows[0].count), 0, "Fresh RDS target required before source-parity bootstrap");
    await client.query(supabasePrerequisites);
    await client.query("create schema tracepoint_migrations; create table tracepoint_migrations.applied_migrations(kind text not null check(kind in ('source','aws')),name text not null,sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),applied_at timestamptz not null default clock_timestamp(),primary key(kind,name))");
  }
  const byVersion = new Map(migrations.map(migration => [migration.version, migration]));
  for (const version of versions) { const migration = byVersion.get(version); assert.ok(migration, `Source migration ${version} is absent from reviewed code`); await applyMigration(client, migration); }
}

async function completeLineage(client, migrations) {
  let applied = 0;
  for (const migration of migrations) if (await applyMigration(client, migration)) applied += 1;
  for (const migration of await loadVerifiedAwsMigrations()) if (await applyMigration(client, { kind: "aws", ...migration })) applied += 1;
  return applied;
}

async function sourceContract(client) {
  const tables = (await client.query("select tablename from pg_tables where schemaname='public' and tablename <> all($1::text[]) and tablename <> all($2::text[]) order by tablename", [[...TRANSIENT_TABLES], [...TARGET_SEEDED_TABLES]])).rows.map(row => row.tablename);
  return Promise.all(tables.map(async table => {
    assert.match(table, /^[a-z][a-z0-9_]*$/);
    const columns = (await client.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [table])).rows.map(row => row.column_name);
    assert.ok(columns.length && columns.every(column => /^[a-z][a-z0-9_]*$/.test(column)));
    return { table, columns };
  }));
}

async function fingerprints(client, specification) {
  const result = [];
  for (const { table, columns } of specification) {
    const projected = `jsonb_build_object(${columns.flatMap(column => [`'${column}'`, `t."${column}"`]).join(",")})`;
    const row = (await client.query(`select count(*)::bigint as rows,encode(digest(convert_to(coalesce(string_agg(row_hash,E'\\n' order by row_hash),''),'UTF8'),'sha256'),'hex') as sha256 from (select encode(digest(convert_to(${projected}::text,'UTF8'),'sha256'),'hex') as row_hash from public."${table}" t) rows`)).rows[0];
    result.push({ table, rows: String(row.rows), sha256: String(row.sha256) });
  }
  return result;
}

try {
  phase = "verified TLS connections";
  await source.connect(); await target.connect();
  await source.query("begin isolation level repeatable read read only");
  phase = "read-only source snapshot";
  const sourcePosition = (await source.query("select pg_current_wal_lsn()::text as lsn,clock_timestamp()::text as captured_at")).rows[0];
  const snapshot = (await source.query("select pg_export_snapshot() as id")).rows[0].id;
  const pendingEmailCount = Number((await source.query("select count(*)::int as count from public.notification_email_queue where status='Pending'")).rows[0].count);
  assert.equal(pendingEmailCount, 0, "Source notification queue must be drained before migration");
  const sourceMigrationRows = (await source.query("select version::text from supabase_migrations.schema_migrations order by version::text")).rows;
  assert.equal(sourceMigrationRows.length, plan.expectedSourceMigrationCount);
  const anchors = (await source.query("select id,email,full_name from public.profiles order by id")).rows;
  const specification = await sourceContract(source);
  const before = await timed("sourceFingerprintMs", () => fingerprints(source, specification));
  const localMigrations = await sourceMigrations();
  const authoritative = [...localMigrations.map(({ kind, name, sha256 }) => ({ kind, name, sha256 })), ...AWS_MIGRATION_LEDGER.map(([name, sha256]) => ({ kind: "aws", name, sha256 }))].sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : right.kind.localeCompare(left.kind));
  reconcileMigrationLedgers(sourceMigrationRows, authoritative, { sourceMigrationCount: plan.expectedSourceMigrationCount, sourceMigrationLedgerSha256: plan.expectedSourceMigrationLedgerSha256 });
  phase = "source-parity target bootstrap";
  await timed("sourceParityBootstrapMs", () => ensureSourceParity(target, sourceMigrationRows.map(row => String(row.version)), localMigrations));

  const targetBefore = await fingerprints(target, specification);
  const targetContainsData = targetBefore.some(item => item.rows !== "0");
  if (targetContainsData) assert.deepEqual(targetBefore, before, "Target contains partial or conflicting migrated data");
  const existingAnchors = (await target.query("select id::text,coalesce(raw_user_meta_data->>'identity_provider','') as provider from auth.users order by id")).rows;
  if (existingAnchors.length) {
    assert.equal(existingAnchors.length, anchors.length, "Target contains a partial identity-anchor cohort");
    assert.deepEqual(existingAnchors.map(row => row.id), anchors.map(row => String(row.id)), "Target identity anchors differ from source");
    assert.ok(existingAnchors.every(row => row.provider === "migration_anchor"));
  }

  if (!targetContainsData) {
    phase = "source data export";
    await timed("sourceDumpMs", () => run("pg_dump", pgDumpArguments(plan, dumpPath, snapshot), { env: { ...process.env, PGHOST: plan.source.host, PGPORT: "5432", PGUSER: sourceSecret.username, PGPASSWORD: sourceSecret.password, PGSSLMODE: "verify-full", PGSSLROOTCERT: plan.sourceCaPath }, timeout: 30 * 60_000 }));
    if (!existingAnchors.length) {
      phase = "passwordless identity anchors";
      await target.query("begin");
      try { await target.query("alter table auth.users disable trigger on_auth_user_created"); for (const anchor of anchors) await target.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('full_name',$3,'identity_provider','migration_anchor'))", [anchor.id, anchor.email, anchor.full_name]); await target.query("alter table auth.users enable trigger on_auth_user_created"); await target.query("commit"); } catch (error) { await target.query("rollback"); throw error; }
    }
    phase = "target data restore";
    await target.query("do $disable$ declare item record; begin for item in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('alter table %I.%I disable trigger user',item.schemaname,item.tablename); end loop; end $disable$");
    await timed("targetRestoreMs", () => run("pg_restore", pgRestoreArguments(plan, dumpPath), { env: { ...process.env, PGHOST: plan.target.host, PGPORT: "5432", PGUSER: targetSecret.username, PGPASSWORD: targetSecret.password, PGSSLMODE: "verify-full", PGSSLROOTCERT: plan.targetCaPath }, timeout: 30 * 60_000 }));
    await target.query("do $enable$ declare item record; begin for item in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('alter table %I.%I enable trigger user',item.schemaname,item.tablename); end loop; end $enable$");
  }
  phase = "source-schema reconciliation";
  assert.deepEqual(await timed("sourceParityReconciliationMs", () => fingerprints(target, specification)), before);
  phase = "target lineage upgrade";
  const newlyApplied = await timed("targetUpgradeMs", () => completeLineage(target, localMigrations));
  phase = "sequence repair";
  await target.query("do $repair$ declare item record; begin for item in select n.nspname as schemaname,c.relname as tablename,a.attname as columnname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) is not null loop execute format('select setval(pg_get_serial_sequence(%L,%L),coalesce((select max(%I) from %I.%I),1),true)',item.schemaname||'.'||item.tablename,item.columnname,item.columnname,item.schemaname,item.tablename); end loop; end $repair$");
  await target.query("analyze");
  phase = "post-upgrade projected reconciliation";
  const after = await timed("postUpgradeReconciliationMs", () => fingerprints(target, specification));
  assert.deepEqual(after, before);
  const invalidForeignKeys = Number((await target.query("select count(*)::int as count from pg_constraint where contype='f' and not convalidated")).rows[0].count);
  assert.equal(invalidForeignKeys, 0, "Target contains unvalidated foreign keys");
  const targetRows = (await target.query("select kind,name,sha256 from tracepoint_migrations.applied_migrations order by kind desc,name")).rows;
  assert.equal(targetRows.length, TARGET_MIGRATION_COUNT);
  const migrationLedgers = reconcileMigrationLedgers(sourceMigrationRows, targetRows, { sourceMigrationCount: plan.expectedSourceMigrationCount, sourceMigrationLedgerSha256: plan.expectedSourceMigrationLedgerSha256 });
  await source.query("commit");
  console.log(JSON.stringify({ status: "PASSED", runId: plan.runId, commit: plan.commit, sourceProjectRef: plan.sourceProjectRef, sourceSnapshotLsn: sourcePosition.lsn, sourceSnapshotAt: sourcePosition.captured_at, sourceMigrationCount: sourceMigrationRows.length, targetMigrationCount: targetRows.length, ...migrationLedgers, sourceManifestSha256: manifestHash(before), targetManifestSha256: manifestHash(after), tables: before.length, identityAnchors: anchors.length, passwordsMigrated: false, pendingEmailCount, transientTablesExcluded: TRANSIENT_TABLES.length, targetSeededTablesExcluded: TARGET_SEEDED_TABLES.length, sourceParityBootstrap: true, sourceSchemaDeltasAppliedAfterCopy: 76 - sourceMigrationRows.length, awsOverlaysAppliedAfterCopy: 20, newlyApplied, invalidForeignKeys, retryMode: targetContainsData ? "verified-resume" : existingAnchors.length ? "anchor-resume" : "fresh-copy", timings: { ...timings, totalMs: Date.now() - startedAt }, tlsVerified: true, reconciled: true }));
} catch (error) {
  await source.query("rollback").catch(() => undefined); await target.query("rollback").catch(() => undefined);
  await target.query("do $enable$ declare item record; begin for item in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('alter table %I.%I enable trigger user',item.schemaname,item.tablename); end loop; end $enable$").catch(() => undefined);
  console.error(JSON.stringify({ status: "FAILED", phase, errorName: error instanceof Error ? error.name : "Error", sqlState: typeof error === "object" && error && "code" in error ? String(error.code) : undefined })); process.exitCode = 1;
} finally {
  await source.end().catch(() => undefined); await target.end().catch(() => undefined); await rm(directory, { recursive: true, force: true });
}
