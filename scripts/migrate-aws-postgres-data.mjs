import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { databaseMigrationPlan, pgDumpArguments, pgRestoreArguments, reconcileMigrationLedgers, requireDatabaseMigrationExecution, SOURCE_MIGRATION_COUNT, TARGET_MIGRATION_COUNT, TARGET_SEEDED_TABLES, TRANSIENT_TABLES } from "./database-migration-core.mjs";

const run = promisify(execFile);
let phase = "configuration";
const plan = databaseMigrationPlan(process.env);
requireDatabaseMigrationExecution(process.argv.slice(2), process.env);
const metadataOrigin = process.env.ECS_CONTAINER_METADATA_URI_V4;
assert.match(metadataOrigin ?? "", /^http:\/\/169\.254\.170\.2\/v4\/[A-Za-z0-9_-]+$/);
const taskMetadata = await fetch(`${metadataOrigin}/task`, { redirect: "error", signal: AbortSignal.timeout(5000) }).then(response => {
  assert.equal(response.status, 200); return response.json();
});
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

async function fingerprints(client) {
  const tables = (await client.query("select tablename from pg_tables where schemaname='public' and tablename <> all($1::text[]) order by tablename", [[...TRANSIENT_TABLES]])).rows.map(row => row.tablename);
  const result = [];
  for (const table of tables) {
    assert.match(table, /^[a-z][a-z0-9_]*$/);
    const value = (await client.query(`select count(*)::bigint as rows,encode(digest(convert_to(coalesce(string_agg(row_hash,E'\\n' order by row_hash),''),'UTF8'),'sha256'),'hex') as sha256 from (select encode(digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') as row_hash from public."${table}" t) rows`)).rows[0];
    result.push({ table, rows: String(value.rows), sha256: String(value.sha256) });
  }
  return result;
}
const manifestHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

try {
  phase = "verified TLS connections";
  await source.connect(); await target.connect();
  const sourceMigrationCount = Number((await source.query("select count(*)::int as count from supabase_migrations.schema_migrations")).rows[0]?.count);
  const targetMigrationCount = Number((await target.query("select count(*)::int as count from tracepoint_migrations.applied_migrations")).rows[0]?.count);
  assert.equal(sourceMigrationCount, SOURCE_MIGRATION_COUNT);
  assert.equal(targetMigrationCount, TARGET_MIGRATION_COUNT);
  const migrationLedgers = reconcileMigrationLedgers(
    (await source.query("select version::text from supabase_migrations.schema_migrations order by version::text")).rows,
    (await target.query("select kind,name,sha256 from tracepoint_migrations.applied_migrations order by kind desc,name")).rows,
  );
  phase = "fresh target gate";
  const targetTables = (await target.query("select tablename from pg_tables where schemaname='public' and tablename <> all($1::text[]) and tablename <> all($2::text[]) order by tablename", [[...TRANSIENT_TABLES], [...TARGET_SEEDED_TABLES]])).rows.map(row => row.tablename);
  for (const table of targetTables) {
    assert.match(table, /^[a-z][a-z0-9_]*$/);
    assert.equal(Number((await target.query(`select count(*)::int as count from public."${table}"`)).rows[0]?.count), 0, `Target table ${table} is not empty`);
  }
  assert.equal(Number((await target.query("select count(*)::int as count from auth.users")).rows[0]?.count), 0);
  phase = "read-only source snapshot";
  await source.query("begin isolation level repeatable read read only");
  const sourcePosition = (await source.query("select pg_current_wal_lsn()::text as lsn,clock_timestamp()::text as captured_at")).rows[0];
  const pendingEmailCount = Number((await source.query("select count(*)::int as count from public.notification_email_queue where status='Pending'")).rows[0]?.count);
  assert.equal(pendingEmailCount, 0, "Source notification queue must be drained before migration");
  const snapshot = (await source.query("select pg_export_snapshot() as id")).rows[0].id;
  const anchors = (await source.query("select id,email,full_name from public.profiles order by id")).rows;
  const before = await fingerprints(source);
  phase = "source data export";
  await run("pg_dump", pgDumpArguments(plan, dumpPath, snapshot), { env: { ...process.env, PGHOST: plan.source.host, PGPORT: "5432", PGUSER: sourceSecret.username, PGPASSWORD: sourceSecret.password, PGSSLMODE: "verify-full", PGSSLROOTCERT: plan.sourceCaPath }, timeout: 30 * 60_000 });
  phase = "passwordless identity anchors";
  await target.query("begin");
  await target.query("alter table auth.users disable trigger on_auth_user_created");
  for (const anchor of anchors) {
    await target.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('full_name',$3,'identity_provider','migration_anchor'))", [anchor.id, anchor.email, anchor.full_name]);
  }
  await target.query("alter table auth.users enable trigger on_auth_user_created");
  await target.query("commit");
  phase = "target data restore";
  await target.query("do $disable$ declare item record; begin for item in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('alter table %I.%I disable trigger user',item.schemaname,item.tablename); end loop; end $disable$");
  await run("pg_restore", pgRestoreArguments(plan, dumpPath), { env: { ...process.env, PGHOST: plan.target.host, PGPORT: "5432", PGUSER: targetSecret.username, PGPASSWORD: targetSecret.password, PGSSLMODE: "verify-full", PGSSLROOTCERT: plan.targetCaPath }, timeout: 30 * 60_000 });
  await target.query("do $enable$ declare item record; begin for item in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('alter table %I.%I enable trigger user',item.schemaname,item.tablename); end loop; end $enable$");
  phase = "sequence repair";
  await target.query(`do $repair$ declare item record; begin for item in select n.nspname as schemaname,c.relname as tablename,a.attname as columnname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname) is not null loop execute format('select setval(pg_get_serial_sequence(%L,%L),coalesce((select max(%I) from %I.%I),1),true)',item.schemaname||'.'||item.tablename,item.columnname,item.columnname,item.schemaname,item.tablename); end loop; end $repair$`);
  await target.query("analyze");
  phase = "content reconciliation";
  const after = await fingerprints(target);
  assert.deepEqual(after, before);
  await source.query("commit");
  console.log(JSON.stringify({ status: "PASSED", runId: plan.runId, commit: plan.commit, sourceProjectRef: plan.sourceProjectRef, sourceSnapshotLsn: sourcePosition.lsn, sourceSnapshotAt: sourcePosition.captured_at, sourceMigrationCount, targetMigrationCount, ...migrationLedgers, sourceManifestSha256: manifestHash(before), targetManifestSha256: manifestHash(after), tables: before.length, identityAnchors: anchors.length, passwordsMigrated: false, pendingEmailCount, transientTablesExcluded: TRANSIENT_TABLES.length, tlsVerified: true, reconciled: true }));
} catch (error) {
  await source.query("rollback").catch(() => undefined);
  await target.query("rollback").catch(() => undefined);
  await target.query("do $enable$ declare item record; begin for item in select schemaname,tablename from pg_tables where schemaname='public' loop execute format('alter table %I.%I enable trigger user',item.schemaname,item.tablename); end loop; end $enable$").catch(() => undefined);
  console.error(JSON.stringify({ status: "FAILED", phase, errorName: error instanceof Error ? error.name : "Error", sqlState: typeof error === "object" && error && "code" in error ? String(error.code) : undefined }));
  process.exitCode = 1;
} finally {
  await source.end().catch(() => undefined); await target.end().catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}
