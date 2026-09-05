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

const expectedMigrationCount = 65;
const migrationsDir = path.resolve("supabase/migrations");
const databaseDir = await mkdtemp(path.join(tmpdir(), "tracepoint-bootstrap-"));
const port = 56000 + Math.floor(Math.random() * 4000);
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: "postgres",
  password: "local-bootstrap-only",
  port,
  persistent: false,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
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

  for (const file of migrationFiles) {
    console.log(`Applying ${file}`);
    const sql = (await readFile(path.join(migrationsDir, file), "utf8"))
      .replace(/^\uFEFF/, "");
    try {
      await client.query("begin");
      await client.query(sql);
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
      const {rows:tables}=await connection.query("select tablename from pg_tables where schemaname='public' order by tablename");
      const result=[];
      for(const {tablename} of tables) {
        const quoted='"'+tablename.replaceAll('"','""')+'"';
        const {rows:[row]}=await connection.query('select count(*)::int as count, md5(coalesce(string_agg(to_jsonb(t)::text, chr(10) order by to_jsonb(t)::text),'+"''"+')) as checksum from public.'+quoted+' t');
        result.push({table:tablename,...row});
      }
      const {rows:policies}=await connection.query("select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname");
      return JSON.stringify({tables:result,policies});
    };
    if(await fingerprint(client)!==await fingerprint(restored)) throw new Error('Local restore row/checksum/RLS reconciliation failed');
    console.log(`Local dump/restore and all-table count/checksum/RLS reconciliation passed in ${Date.now()-startedAt} ms.`);
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
