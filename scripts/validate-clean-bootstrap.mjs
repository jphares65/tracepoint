import {localPostgresPort} from '../src/test-support/local-postgres-port.mjs';
import {catalogSql,manifestSql} from './staging-management-manifest.mjs';
import {supabasePrerequisites} from "./postgres-bootstrap-prerequisites.mjs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Some locked-down Windows runners deny uv_os_get_passwd. Embedded Postgres
// only needs the uid to avoid launching PostgreSQL as root (not applicable on
// Windows), so provide a non-root fallback when that OS lookup is unavailable.
try {
  os.userInfo();
} catch {
  os.userInfo = () => ({ uid: -1, gid: -1, username: "local", homedir: tmpdir(), shell: null });
  syncBuiltinESMExports();
}
const { default: EmbeddedPostgres } = await import("embedded-postgres");
const execFileAsync = promisify(execFile);

const expectedMigrationCount = 67;
const migrationsDir = path.resolve("supabase/migrations");
const databaseDir = await mkdtemp(path.join(tmpdir(), "tracepoint-bootstrap-"));
const port = await localPostgresPort();
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "local-bootstrap-only",
  port,
  persistent: false,
  postgresFlags:['-h','127.0.0.1'],initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (message) => console.error(message),
});



let client;
let started = false;
try {
  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  if (migrationFiles.length !== expectedMigrationCount) {
    throw new Error(
      `Expected ${expectedMigrationCount} migrations, found ${migrationFiles.length}. Update the validator when adding a migration.`,
    );
  }

  const versions = migrationFiles.map((file) => file.split("_", 1)[0]);
  if (new Set(versions).size !== versions.length) {
    throw new Error("Migration version prefixes must be unique.");
  }

  await postgres.initialise();
  await postgres.start();
  started = true;
  console.log(`Disposable PostgreSQL started; applying ${migrationFiles.length} migrations.`);
  client = postgres.getPgClient();
  await client.connect();
  await client.query("set statement_timeout = '20s'");
  await client.query(supabasePrerequisites);
  await client.query('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)');

  for (const file of migrationFiles) {
    console.log(`Applying ${file}`);
    const sql = (await readFile(path.join(migrationsDir, file), "utf8"))
      .replace(/^\uFEFF/, "");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query('insert into supabase_migrations.schema_migrations(version) values($1)',[file.split('_')[0]]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      console.error(`Migration execution error in ${file}: ${error.message}`);
      throw new Error(`Clean bootstrap failed in ${file}: ${error.message}`, {
        cause: error,
      });
    }
  }

  await client.query(await readFile('scripts/validate-local-armory-workflows.sql','utf8'));
  const requiredTables = [
    "profiles", "departments", "department_memberships", "feature_catalog", "department_features", "department_feature_events", "pilot_range_workspaces",
    "equipment_types", "equipment_assets", "equipment_asset_assignments",
    "range_days", "range_day_drills", "fleet_vehicles",
    "notification_events", "training_certifications", "agency_training_events",
  ];
  const { rows } = await client.query(
    `select tablename from pg_tables where schemaname = 'public' and tablename = any($1)`,
    [requiredTables],
  );
  const found = new Set(rows.map(({ tablename }) => tablename));
  const missing = requiredTables.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Required tables missing: ${missing.join(", ")}`);

  const checks = await client.query(`
    select
      to_regclass('public.equipment_asset_assignments') is not null as equipment_history,
      exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'equipment_types_department_normalized_name_unique'
      ) as equipment_type_uniqueness,
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'equipment_types'
          and column_name = 'is_active'
      ) as equipment_type_archive,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'range_day_drills'
          and policyname = 'range_day_drills_delete_managers'
      ) as range_drill_delete_policy,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'equipment_asset_assignments'
          and policyname = 'equipment_assignment_history_select_scoped'
      ) as equipment_assignment_policy,
      exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'certification_types'
          and policyname = 'department members can view certification types'
      ) as certification_type_policy
  `);
  const failedChecks = Object.entries(checks.rows[0])
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedChecks.length) {
    throw new Error(`Focused schema checks failed: ${failedChecks.join(", ")}`);
  }

  await client.query(await readFile('scripts/validate-local-tenant-isolation.sql', 'utf8'));
  console.log('Local tenant isolation passed: own-tenant read, foreign-tenant read denial, foreign-tenant write denial, non-manager write denial.');
  if (process.argv.includes("--rehearse-restore")) {
  // Rehearse export/restore using only this disposable database and synthetic seed data.
  const binaryDir = process.env.TRACEPOINT_PG_BIN || path.dirname(postgres.process.spawnfile);
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const dumpPath = path.join(databaseDir, 'rehearsal.dump');
  const localEnv = { ...process.env, PGPASSWORD: 'local-bootstrap-only' };
  const connectionArgs = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres'];
  await execFileAsync(path.join(binaryDir, 'pg_dump'+suffix), [...connectionArgs, '-Fc', '--no-owner', '-f', dumpPath, 'postgres'], { env:localEnv, timeout:60000 });
  await client.query('create database tracepoint_restore');
  const startedAt = Date.now();
  await execFileAsync(path.join(binaryDir, 'pg_restore'+suffix), [...connectionArgs, '--no-owner', '--exit-on-error', '-d', 'tracepoint_restore', dumpPath], { env:localEnv, timeout:60000 });
  const restored = new client.constructor({host:'127.0.0.1',port,user:'postgres',password:'local-bootstrap-only',database:'tracepoint_restore'});
  try {
    await restored.connect();
    const fingerprint = async connection => {
      const catalog=(await connection.query(catalogSql)).rows[0];
      const results=await connection.query(manifestSql(catalog,versions));
      return results.find(result=>result.rows?.[0]?.manifest)?.rows[0].manifest;
    };
    const before=await fingerprint(client),after=await fingerprint(restored);
    if(JSON.stringify(before)!==JSON.stringify(after)) {
      console.log(JSON.stringify({metadataDifferences:Object.keys(before.metadata).filter(k=>before.metadata[k]!==after.metadata[k])}));
      const sql="select t.relname,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid,true) as definition from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' order by t.relname,c.conname";
      const source=(await client.query(sql)).rows,target=(await restored.query(sql)).rows;
      const sourceSet=new Set(source.map(x=>JSON.stringify(x))),targetSet=new Set(target.map(x=>JSON.stringify(x)));
      console.log(JSON.stringify({sourceOnlyConstraints:source.filter(x=>!targetSet.has(JSON.stringify(x))),restoredOnlyConstraints:target.filter(x=>!sourceSet.has(JSON.stringify(x)))}));
      throw new Error('Local restore full manifest reconciliation failed');
    }
    console.log(`Local dump/restore and full table/relationship/metadata/RLS reconciliation passed in ${Date.now()-startedAt} ms.`);
  } finally { await restored.end(); }
  }
  console.log(`Clean bootstrap passed: ${migrationFiles.length} ordered migrations.`);
} finally {
  if (client) await client.end().catch(() => {});
  if (started && postgres.process?.spawnfile) {
    const pgCtl = path.join(path.dirname(postgres.process.spawnfile), process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
    await execFileAsync(pgCtl, ["stop", "-D", databaseDir, "-m", "fast", "-w"], { timeout: 20000 }).catch(() => {});
    postgres.process = undefined;
  }
  await rm(databaseDir, { recursive: true, force: true }).catch(() => {});
}
