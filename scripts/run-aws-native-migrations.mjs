import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { assertDatabaseTargetIdentity, assertExpectedDatabaseHost, assertInspectionSql, classifyMigrationInspection, inspectionCatalogQueries } from "./aws-native-migration-inspection.mjs";
import {
  assertProductionLedgerAdoptionPostconditions,
  productionLedgerAdoptionPostconditionsSql,
  productionLedgerAdoptionVersions,
} from "./aws-native-production-ledger-adoption.mjs";

const ledger = "public.tracepoint_aws_schema_migrations";
const lockName = "tracepoint:aws-native-schema-migrations:v1";
const action = process.argv[2] ?? "status";
const requestedEnvironment = process.argv[3];

if (!["status", "inspect", "mobile-preflight", "range-workspace-hotfix", "baseline", "reconcile", "apply"].includes(action)) throw new Error("Usage: run-aws-native-migrations.mjs <status|inspect|mobile-preflight|range-workspace-hotfix|baseline|reconcile|apply> <staging|production>");
if (!["staging", "production"].includes(requestedEnvironment)) throw new Error("A staging or production environment is required.");
if (action === "mobile-preflight" && requestedEnvironment !== "production") throw new Error("Mobile production preflight is production-only.");
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
    return { version, filename, contents, sha256: digest(contents), ownsTransaction: /^\s*begin;[\s\S]*commit;\s*$/i.test(contents) };
  }));
  for (let index = 1; index < result.length; index += 1) if (result[index - 1].version >= result[index].version) throw new Error("AWS-native migrations are not uniquely ordered.");
  return result;
}

function migrationSqlWithLedgerEntry(migration, context) {
  if (!migration.ownsTransaction) throw new Error(`${migration.filename} cannot be executed: AWS-native migrations must own an explicit outer BEGIN/COMMIT transaction.`);
  const entry = `\ninsert into ${ledger}(version, filename, content_sha256, application_git_sha, environment, application_context, is_baseline) values (${migration.version}, ${quote(migration.filename)}, ${quote(migration.sha256)}, ${quote(process.env.DEPLOYMENT_VERSION ?? "unknown")}, ${quote(context.environment)}, ${quote(context.action)}, false);\ncommit;`;
  return migration.contents.replace(/commit;\s*$/i, entry);
}
function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function connect() {
  if (process.env.TRACEPOINT_DATA_PROVIDER !== "postgres" || process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native") throw new Error("AWS-native PostgreSQL runtime configuration is required.");
  let secret;
  try { secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? ""); } catch { throw new Error("AWS-native database secret is invalid."); }
  if (!secret || typeof secret.host !== "string" || secret.port !== 5432 || secret.dbname !== "tracepoint" || typeof secret.username !== "string" || typeof secret.password !== "string") throw new Error("AWS-native database secret is invalid.");
  const expectedRdsHostMatched = action === "mobile-preflight"
    ? assertExpectedDatabaseHost(secret.host, process.env.TRACEPOINT_EXPECTED_DATABASE_HOST)
    : false;
  const caPath = process.env.TRACEPOINT_DATABASE_CA_PATH;
  if (!caPath?.startsWith("/app/") || !caPath.endsWith(".pem")) throw new Error("AWS-native database CA path is invalid.");
  const ca = await readFile(caPath, "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error("AWS-native database CA is invalid.");
  const client = new Client({ host: secret.host, port: secret.port, user: secret.username, password: secret.password, database: secret.dbname, ssl: { ca, rejectUnauthorized: true, servername: secret.host }, connectionTimeoutMillis: 10_000, statement_timeout: 60_000, application_name: "tracepoint-aws-native-migrations" });
  await client.connect();
  client.expectedRdsHostMatched = expectedRdsHostMatched;
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
async function verifyProductionLedgerAdoptionAnchor(client) {
  // 001–029 retain the audited Phase A anchor used by reconciliation.  The
  // later changes are verified individually below before any ledger row is
  // recorded; this path never executes historical migration SQL.
  await verifyBaselineAnchor(client);
  const checks = await client.query(productionLedgerAdoptionPostconditionsSql);
  assertProductionLedgerAdoptionPostconditions(checks.rows[0]);
}
async function ensureLedger(client) {
  await client.query(`create table if not exists ${ledger} (
    version integer primary key check (version > 0), filename text not null unique,
    content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz not null default now(), application_git_sha text not null,
    environment text not null check (environment in ('staging','production')),
    application_context text not null check (application_context in ('baseline','reconcile','apply')),
    is_baseline boolean not null default false
  )`);
}
async function withLock(client, fn) {
  await client.query("select pg_advisory_lock(hashtext($1))", [lockName]);
  try { return await fn(); } finally { await client.query("select pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => undefined); }
}
async function inspect(client, { transactionAlreadyOpen = false } = {}) {
  const snapshot = {};
  if (!transactionAlreadyOpen) {
    for (const sql of ["BEGIN TRANSACTION READ ONLY", "SET TRANSACTION READ ONLY"]) { assertInspectionSql(sql); await client.query(sql); }
  }
  for (const [section, sql] of inspectionCatalogQueries) { assertInspectionSql(sql); snapshot[section] = (await client.query(sql)).rows; }
  const mobileApiDependenciesSql = `with required(relation_name, required_columns, require_rls) as (values
    ('fleet_vehicles', array['id','department_id','unit_number','vin','status']::text[], false),
    ('fleet_rules', array['department_id','inspection_role_codes']::text[], false),
    ('equipment_assets', array['id','department_id','manufacturer','model','serial_number','asset_number','lifecycle_status']::text[], false),
    ('firearms', array['id','department_id','make','model','serial_number','asset_number','condition_status','is_active']::text[], false),
    ('inventory_items', array['id','department_id','name','category','sku','tracking_mode','unit_of_measure','is_active']::text[], false),
    ('inventory_balances', array['id','department_id','inventory_item_id','inventory_location_id','on_hand_quantity']::text[], false),
    ('inventory_locations', array['id','department_id','name']::text[], false),
    ('notification_events', array['id','department_id','user_id','notification_key','title','detail','href','priority','source','kind','source_created_at','acknowledged_at','snoozed_until','last_seen_at','resolved_at']::text[], false),
    ('drill_documents', array['id','department_id','drill_template_id','storage_path','original_filename']::text[], false),
    ('pilot_range_workspaces', array['department_id','workspace','updated_by_user_id','updated_at']::text[], true),
    ('department_memberships', array['department_id','user_id','is_active','badge_number']::text[], false),
    ('profiles', array['id','full_name','email']::text[], false),
    ('range_days', array['id','department_id','title','range_date','status','range_type','packet_status']::text[], false),
    ('range_day_drills', array['id','department_id','range_day_id','name','category','scoring_format','passing_score','max_score','passing_time_seconds']::text[], false),
    ('drill_run_results', array['id','department_id','range_day_id','range_day_drill_id','officer_user_id','run_number','completed','score','time_seconds','hit_count','passed','notes']::text[], false),
    ('range_day_roster', array['id','department_id','range_day_id','officer_user_id','attendance_status']::text[], false),
    ('department_qualification_standards', array['id','department_id','name','firearm_type','is_active']::text[], false),
    ('department_qualification_standard_components', array['department_id','qualification_standard_id','name','scoring_basis','passing_score','passing_time_seconds','minimum_hits','is_required','is_active','sort_order']::text[], false),
    ('department_membership_roles', array['department_id','user_id','role_code']::text[], false)
  )
  select required.relation_name,
    to_regclass(format('public.%I', required.relation_name)) is not null as relation_present,
    not exists (
      select 1 from unnest(required.required_columns) as expected(column_name)
      where not exists (
        select 1 from pg_attribute actual
        join pg_class relation on relation.oid=actual.attrelid
        join pg_namespace relation_schema on relation_schema.oid=relation.relnamespace
        where relation_schema.nspname='public' and relation.relname=required.relation_name
          and actual.attname=expected.column_name and actual.attnum>0 and not actual.attisdropped
      )
    ) as required_columns_present,
    not required.require_rls or coalesce((select relrowsecurity from pg_class where oid=to_regclass(format('public.%I', required.relation_name))), false) as rls_enabled,
    case when to_regclass(format('public.%I', required.relation_name)) is not null then has_table_privilege('tracepoint_runtime', to_regclass(format('public.%I', required.relation_name)), 'select') else false end as runtime_select_privilege_present,
    case when to_regclass(format('public.%I', required.relation_name)) is not null then has_table_privilege('authenticated', to_regclass(format('public.%I', required.relation_name)), 'select') else false end as authenticated_select_privilege_present,
    case when required.relation_name='pilot_range_workspaces' then has_table_privilege('authenticated', to_regclass('public.pilot_range_workspaces'), 'select') else true end as read_privilege_present,
    case when required.relation_name='pilot_range_workspaces' then
      has_table_privilege('authenticated', to_regclass('public.pilot_range_workspaces'), 'insert')
      and has_table_privilege('authenticated', to_regclass('public.pilot_range_workspaces'), 'update')
      else true end as write_privileges_present,
    case when required.relation_name='pilot_range_workspaces' then
      exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and cmd in ('SELECT','ALL') and 'authenticated'=any(roles))
      and exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and cmd in ('INSERT','ALL') and 'authenticated'=any(roles))
      and exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and cmd in ('UPDATE','ALL') and 'authenticated'=any(roles))
      else true end as policies_present,
    case when required.relation_name='pilot_range_workspaces' then
      exists(select 1 from pg_trigger where tgrelid=to_regclass('public.pilot_range_workspaces') and tgname='pilot_range_workspaces_accountability_audit' and not tgisinternal)
      else true end as accountability_trigger_present
  from required order by required.relation_name`;
  assertInspectionSql(mobileApiDependenciesSql);
  const mobileApiDependencies = (await client.query(mobileApiDependenciesSql)).rows;
  if (!transactionAlreadyOpen) {
    assertInspectionSql("COMMIT");
    await client.query("COMMIT");
  }
  return { ...classifyMigrationInspection(snapshot), mobileApiDependencies };
}

async function mobilePreflight(client, files) {
  if (requestedEnvironment !== "production") throw new Error("Mobile production preflight is production-only.");
  if (client.expectedRdsHostMatched !== true) throw new Error("DATABASE_TARGET_MISMATCH");
  assertInspectionSql("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const databaseIdentitySql = `select current_database() as database_name,
      inet_server_addr()::text as server_address, inet_server_port() as server_port,
      current_setting('search_path') as search_path, current_schemas(true) as effective_schemas,
      current_user as database_user, session_user as session_user`;
    assertInspectionSql(databaseIdentitySql);
    const databaseIdentity = (await client.query(databaseIdentitySql)).rows[0];
    assertDatabaseTargetIdentity(databaseIdentity);
    const databasePrincipalSql = `select current_user as database_user,
      current_setting('transaction_read_only') as transaction_read_only,
      current_setting('transaction_isolation') as transaction_isolation,
      principal_role.rolsuper as is_superuser, principal_role.rolcreatedb as can_create_database,
      principal_role.rolcreaterole as can_create_roles, principal_role.rolreplication as can_replicate,
      principal_role.rolbypassrls as can_bypass_rls
      from pg_roles principal_role where principal_role.rolname = current_user`;
    assertInspectionSql(databasePrincipalSql);
    const databasePrincipal = (await client.query(databasePrincipalSql)).rows[0];
    if (!databasePrincipal) throw new Error("DATABASE_PRINCIPAL_UNAVAILABLE");
    const migrationStatus = await report(client, files);
    const catalog = await inspect(client, { transactionAlreadyOpen: true });
    assertInspectionSql("COMMIT");
    await client.query("COMMIT");
    return {
      status: "PASSED",
      inspection: "read-only",
      transaction: { isolation: "repeatable read", readOnly: true },
      connectionIdentity: { ...databaseIdentity, expectedRdsHostMatched: true },
      databasePrincipal,
      ledger: migrationStatus.ledger,
      latestAppliedVersion: migrationStatus.latestAppliedVersion,
      appliedVersions: migrationStatus.applied.map(row => Number(row.version)),
      pending: migrationStatus.pending.map(({ version, filename, content_sha256 }) => ({ version, filename, content_sha256 })),
      migrations: catalog.migrations.map(({ version, status }) => ({ version, status })),
      highestContiguousVersion: catalog.highestContiguousVersion,
      outOfOrderPresent: catalog.outOfOrderPresent,
      mobileApiDependencies: catalog.mobileApiDependencies,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
async function rangeWorkspaceContract(client) {
  const result = await client.query(`select
    to_regclass('public.pilot_range_workspaces') is not null as table_present,
    coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.pilot_range_workspaces')), false) as rls_enabled,
    exists(select 1 from pg_attribute where attrelid=to_regclass('public.pilot_range_workspaces') and attname='workspace' and atttypid='jsonb'::regtype and attnum>0 and not attisdropped) as workspace_jsonb,
    exists(select 1 from pg_attribute where attrelid=to_regclass('public.pilot_range_workspaces') and attname='updated_by_user_id' and atttypid='uuid'::regtype and attnum>0 and not attisdropped) as updated_by_uuid,
    exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and cmd in ('INSERT','ALL') and 'authenticated'=any(roles)) as insert_policy,
    exists(select 1 from pg_policies where schemaname='public' and tablename='pilot_range_workspaces' and cmd in ('UPDATE','ALL') and 'authenticated'=any(roles)) as update_policy,
    coalesce((select jsonb_agg(jsonb_build_object('name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check) order by policyname) from pg_policies where schemaname='public' and tablename='pilot_range_workspaces'),'[]'::jsonb) as policies,
    coalesce((select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid,true)) order by tgname) from pg_trigger where tgrelid=to_regclass('public.pilot_range_workspaces') and not tgisinternal),'[]'::jsonb) as triggers,
    coalesce((select array_agg(privilege_type order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='pilot_range_workspaces' and grantee='authenticated'),array[]::text[]) as privileges`);
  return result.rows[0];
}
function assertRangeWorkspaceContract(contract, expectedPrivileges) {
  const failures = [
    ["table_present", contract.table_present], ["rls_enabled", contract.rls_enabled], ["workspace_jsonb", contract.workspace_jsonb], ["updated_by_uuid", contract.updated_by_uuid], ["insert_policy", contract.insert_policy], ["update_policy", contract.update_policy],
  ].filter(([, value]) => value !== true).map(([key]) => key);
  if (!Array.isArray(contract.policies) || contract.policies.length === 0) failures.push("range_workspace_policies_missing");
  if (!Array.isArray(contract.triggers) || contract.triggers.length === 0 || !contract.triggers.some(trigger => trigger.name === "pilot_range_workspaces_accountability_audit")) failures.push("range_workspace_accountability_trigger_missing");
  if (JSON.stringify(contract.privileges) !== JSON.stringify(expectedPrivileges)) failures.push(`authenticated_privileges=${JSON.stringify(contract.privileges)}`);
  if (failures.length) throw new Error(`RANGE_WORKSPACE_HOTFIX_PRECONDITION_FAILED: ${failures.join(", ")}`);
}
async function applyRangeWorkspaceHotfix(client, files) {
  if (requestedEnvironment !== "production") throw new Error("Range workspace hotfix is production-only.");
  const migration = files.find(file => file.version === 38 && file.filename === "038_range_workspace_authenticated_writes.sql");
  if (!migration || files.filter(file => file.version === 38).length !== 1 || !migration.ownsTransaction) throw new Error("Range workspace hotfix requires exactly the transaction-owned migration 038.");
  const before = await rangeWorkspaceContract(client);
  assertRangeWorkspaceContract(before, ["SELECT"]);
  await client.query(migration.contents);
  const after = await rangeWorkspaceContract(client);
  assertRangeWorkspaceContract(after, ["INSERT", "SELECT", "UPDATE"]);
  if (JSON.stringify(before.policies) !== JSON.stringify(after.policies) || JSON.stringify(before.triggers) !== JSON.stringify(after.triggers)) throw new Error("RANGE_WORKSPACE_HOTFIX_POSTCONDITION_FAILED: RLS policies or triggers changed.");
  return { action: "range-workspace-hotfix", environment: requestedEnvironment, executed_at: new Date().toISOString(), filename: migration.filename, content_sha256: migration.sha256, application_git_sha: process.env.DEPLOYMENT_VERSION ?? "unknown", ledger_modified: false, before, after };
}

let files;
let client;
try {
  files = await migrations();
  client = await connect();
  if (action === "status") {
    console.log(JSON.stringify(await report(client, files)));
  } else if (action === "inspect") {
    console.log(JSON.stringify(await inspect(client)));
  } else if (action === "mobile-preflight") {
    console.log(JSON.stringify(await mobilePreflight(client, files)));
  } else if (action === "range-workspace-hotfix") {
    console.log(JSON.stringify(await applyRangeWorkspaceHotfix(client, files)));
  } else await withLock(client, async () => {
    const before = await ledgerRows(client);
    if (before) verifyLedger(files, before);
    if (action === "baseline") {
      if (before?.length) throw new Error("AWS-native migration ledger already contains entries; refusing to re-baseline.");
      await verifyBaselineAnchor(client);
      // 001–028 are an audited historical baseline. Some legacy files predate
      // the explicit transaction convention; only post-baseline migrations may
      // be executed by this runner and must own a transaction.
      const target = files.filter((file) => file.version <= 28);
      if (target.at(-1)?.version !== 28) throw new Error("Baseline requires the verified Phase A migration 028.");
      await client.query("begin");
      try {
        await ensureLedger(client);
        for (const file of target) await client.query(`insert into ${ledger}(version, filename, content_sha256, application_git_sha, environment, application_context, is_baseline) values ($1,$2,$3,$4,$5,'baseline',true)`, [file.version, file.filename, file.sha256, process.env.DEPLOYMENT_VERSION ?? "unknown", requestedEnvironment]);
        await client.query("commit");
      } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
    } else if (action === "reconcile") {
      if (before?.length) throw new Error("AWS-native migration ledger already contains entries; reconciliation requires an unbaselined verified historical schema.");
      if (requestedEnvironment === "production") {
        await verifyProductionLedgerAdoptionAnchor(client);
        const adopted = files.filter((file) => file.version <= productionLedgerAdoptionVersions.last);
        const pending = files.filter((file) => file.version > productionLedgerAdoptionVersions.last);
        if (
          adopted.length !== productionLedgerAdoptionVersions.last
          || !adopted.every((file, index) => file.version === index + 1)
          || pending.length !== 2
          || pending[0]?.version !== 38
          || pending[0]?.filename !== "038_range_workspace_authenticated_writes.sql"
          || pending[1]?.version !== 39
          || pending[1]?.filename !== "039_cognito_password_global_scope.sql"
        ) {
          throw new Error("Production reconciliation requires the verified 001-037 chain followed by pending migrations 038 and 039.");
        }
        await client.query("begin");
        try {
          await ensureLedger(client);
          for (const file of adopted) await client.query(`insert into ${ledger}(version, filename, content_sha256, application_git_sha, environment, application_context, is_baseline) values ($1,$2,$3,$4,$5,'reconcile',true)`, [file.version, file.filename, file.sha256, process.env.DEPLOYMENT_VERSION ?? "unknown", requestedEnvironment]);
          await client.query("commit");
        } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
        console.log(JSON.stringify(await report(client, files)));
        return;
      }
      const historical = files.filter((file) => file.version <= 27);
      const phaseA = files.find((file) => file.version === 28);
      const reconciliation = files.find((file) => file.version === 29 && file.filename === "029_firearm_custody_phase_a_function_reconciliation.sql");
      if (!phaseA || !reconciliation) throw new Error("Expected Phase A 028 and reconciliation 029 are unavailable.");
      await client.query("begin");
      try {
        await ensureLedger(client);
        for (const file of historical) await client.query(`insert into ${ledger}(version, filename, content_sha256, application_git_sha, environment, application_context, is_baseline) values ($1,$2,$3,$4,$5,'baseline',true)`, [file.version, file.filename, file.sha256, process.env.DEPLOYMENT_VERSION ?? "unknown", requestedEnvironment]);
        await client.query("commit");
      } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
      await client.query(migrationSqlWithLedgerEntry(reconciliation, { environment: requestedEnvironment, action: "reconcile" }));
      await verifyBaselineAnchor(client);
      await client.query(`insert into ${ledger}(version, filename, content_sha256, application_git_sha, environment, application_context, is_baseline) values ($1,$2,$3,$4,$5,'baseline',true)`, [phaseA.version, phaseA.filename, phaseA.sha256, process.env.DEPLOYMENT_VERSION ?? "unknown", requestedEnvironment]);
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
} catch (error) {
  if (action === "mobile-preflight") {
    console.error(JSON.stringify({ status: "BLOCKED", inspection: "read-only", reason: "DATABASE_INSPECTION_FAILED" }));
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  if (client) await client.end().catch(() => undefined);
}
