import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const ledger = "public.tracepoint_aws_schema_migrations";
const lockName = "tracepoint:aws-native-schema-migrations:v1";
const action = process.argv[2] ?? "status";
const requestedEnvironment = process.argv[3];

if (!["status", "baseline", "apply"].includes(action)) throw new Error("Usage: run-aws-native-migrations.mjs <status|baseline|apply> <staging|production>");
if (!["staging", "production"].includes(requestedEnvironment)) throw new Error("A staging or production environment is required.");
if (process.env.CONFIGURATION_ENVIRONMENT !== requestedEnvironment) throw new Error("Migration environment does not match the runtime configuration.");
if (action === "baseline" && requestedEnvironment !== "staging") throw new Error("Baseline is intentionally staging-only.");

const migrationDirectory = path.resolve("database/aws");

function digest(contents) { return createHash("sha256").update(contents).digest("hex"); }
async function migrations() {
  const names = (await readdir(migrationDirectory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("No AWS-native migration files were found.");
  const result = await Promise.all(names.map(async (filename) => {
    const contents = await readFile(path.join(migrationDirectory, filename), "utf8");
    const version = Number(filename.slice(0, 3));
    if (!/^\s*begin;[\s\S]*commit;\s*$/i.test(contents)) throw new Error(`${filename} must own exactly one outer BEGIN/COMMIT transaction.`);
    return { version, filename, contents, sha256: digest(contents) };
  }));
  for (let index = 1; index < result.length; index += 1) if (result[index - 1].version >= result[index].version) throw new Error("AWS-native migrations are not uniquely ordered.");
  return result;
}

function migrationSqlWithLedgerEntry(migration, context) {
  const entry = `\ninsert into ${ledger}(version, filename, content_sha256, application_git_sha, environment, application_context, is_baseline) values (${migration.version}, ${quote(migration.filename)}, ${quote(migration.sha256)}, ${quote(process.env.DEPLOYMENT_VERSION ?? "unknown")}, ${quote(context.environment)}, ${quote(context.action)}, false);\ncommit;`;
  return migration.contents.replace(/commit;\s*$/i, entry);
}
function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function connect() {
  if (process.env.TRACEPOINT_DATA_PROVIDER !== "postgres" || process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native") throw new Error("AWS-native PostgreSQL runtime configuration is required.");
  let secret;
  try { secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? ""); } catch { throw new Error("AWS-native database secret is invalid."); }
  if (!secret || typeof secret.host !== "string" || secret.port !== 5432 || secret.dbname !== "tracepoint" || typeof secret.username !== "string" || typeof secret.password !== "string") throw new Error("AWS-native database secret is invalid.");
  const caPath = process.env.TRACEPOINT_DATABASE_CA_PATH;
  if (!caPath?.startsWith("/app/") || !caPath.endsWith(".pem")) throw new Error("AWS-native database CA path is invalid.");
  const ca = await readFile(caPath, "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error("AWS-native database CA is invalid.");
  const client = new Client({ host: secret.host, port: secret.port, user: secret.username, password: secret.password, database: secret.dbname, ssl: { ca, rejectUnauthorized: true, servername: secret.host }, connectionTimeoutMillis: 10_000, statement_timeout: 60_000, application_name: "tracepoint-aws-native-migrations" });
  await client.connect();
  return client;
}

async function ledgerRows(client) {
  const exists = (await client.query("select to_regclass($1) as name", [ledger])).rows[0].name;
  if (!exists) return null;
  return (await client.query(`select version, filename, content_sha256, applied_at, application_git_sha, environment, application_context, is_baseline from ${ledger} order by version`)).rows;
}
function verifyLedger(files, rows) {
  const byVersion = new Map(files.map((file) => [file.version, file]));
  for (const row of rows) {
    const file = byVersion.get(Number(row.version));
    if (!file || file.filename !== row.filename || file.sha256 !== row.content_sha256) throw new Error(`MIGRATION_DRIFT: recorded migration ${row.version} does not exactly match the repository.`);
  }
}
async function report(client, files) {
  const rows = await ledgerRows(client);
  if (!rows) return { ledger: "absent", applied: [], pending: files.map(publicMigration), latestAppliedVersion: null };
  verifyLedger(files, rows);
  const applied = new Set(rows.map((row) => Number(row.version)));
  return { ledger: "present", applied: rows.map((row) => ({ ...row, content_sha256: String(row.content_sha256) })), pending: files.filter((file) => !applied.has(file.version)).map(publicMigration), latestAppliedVersion: rows.at(-1)?.version ?? null };
}
function publicMigration(file) { return { version: file.version, filename: file.filename, content_sha256: file.sha256 }; }
async function verifyBaselineAnchor(client) {
  const checks = await client.query(`select
    to_regnamespace('tracepoint_auth') is not null as auth_schema,
    to_regclass('public.firearm_storage_locations') is not null as storage_locations,
    to_regclass('public.firearm_current_custody') is not null as current_custody,
    to_regclass('public.firearm_possession_restrictions') is not null as restrictions,
    to_regclass('public.firearm_custody_events') is not null as custody_events,
    to_regprocedure('public.transfer_firearm_custody(uuid,text,uuid,uuid,text,text,uuid,boolean)') is not null as custody_transfer,
    to_regprocedure('public.create_firearm_storage_location(text,text)') is not null as storage_creation,
    to_regprocedure('public.create_firearm_possession_restriction(uuid,text,boolean,boolean,boolean,boolean,text,timestamp with time zone)') is not null as restriction_creation,
    to_regclass('public.available_firearms_for_assignment') is not null as assignment_view`);
  const failed = Object.entries(checks.rows[0]).filter(([, value]) => value !== true).map(([key]) => key);
  if (failed.length) throw new Error(`AWS_NATIVE_BASELINE_UNVERIFIED: ${failed.join(", ")}`);
}
async function ensureLedger(client) {
  await client.query(`create table if not exists ${ledger} (
    version integer primary key check (version > 0), filename text not null unique,
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz not null default now(), application_git_sha text not null,
    environment text not null check (environment in ('staging','production')),
    application_context text not null check (application_context in ('baseline','apply')),
    is_baseline boolean not null default false
  )`);
}
async function withLock(client, fn) {
  await client.query("select pg_advisory_lock(hashtext($1))", [lockName]);
  try { return await fn(); } finally { await client.query("select pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => undefined); }
}

const files = await migrations();
const client = await connect();
try {
  if (action === "status") {
    console.log(JSON.stringify(await report(client, files)));
  } else await withLock(client, async () => {
    const before = await ledgerRows(client);
    if (before) verifyLedger(files, before);
    if (action === "baseline") {
      if (before?.length) throw new Error("AWS-native migration ledger already contains entries; refusing to re-baseline.");
      await verifyBaselineAnchor(client);
      const target = files.filter((file) => file.version <= 28);
      if (target.at(-1)?.version !== 28) throw new Error("Baseline requires the verified Phase A migration 028.");
      await client.query("begin");
      try {
        await ensureLedger(client);
        for (const file of target) await client.query(`insert into ${ledger}(version, filename, content_sha256, application_git_sha, environment, application_context, is_baseline) values ($1,$2,$3,$4,$5,'baseline',true)`, [file.version, file.filename, file.sha256, process.env.DEPLOYMENT_VERSION ?? "unknown", requestedEnvironment]);
        await client.query("commit");
      } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    } else {
      if (!before) throw new Error("AWS-native migration ledger is absent; run the verified staging baseline first.");
      const applied = new Set(before.map((row) => Number(row.version)));
      for (const file of files.filter((entry) => !applied.has(entry.version))) {
        console.log(JSON.stringify({ applying: publicMigration(file) }));
        await client.query(migrationSqlWithLedgerEntry(file, { environment: requestedEnvironment, action: "apply" }));
      }
    }
    console.log(JSON.stringify(await report(client, files)));
  });
} finally { await client.end(); }
