import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { assertDatabaseTargetIdentity, assertExpectedDatabaseHost, assertInspectionSql, classifyMigrationInspection, inspectMigrationLedgerEvidence, inspectionCatalogQueries, inspectionSearchPathSql, inspectionTargetIdentitySql, mobileApiDependenciesSql } from "./aws-native-migration-inspection.mjs";
import { mobilePreflightFailureDetails } from "./aws-native-mobile-preflight-diagnostics.mjs";
import { applyAgencyDocumentsUnit, applyInventoryUnit, applyPasswordScopeResolutionUnit, liveOwnerActions, parsePasswordScopeResolutions, runLivePrecheck } from "./aws-native-live-release-units.mjs";
import {
  assertProductionLedgerAdoptionPostconditions,
  productionLedgerAdoptionPostconditionsSql,
  productionLedgerAdoptionVersions,
} from "./aws-native-production-ledger-adoption.mjs";

const ledger = "public.tracepoint_aws_schema_migrations";
const lockName = "tracepoint:aws-native-schema-migrations:v1";
const action = process.argv[2] ?? "status";
const requestedEnvironment = process.argv[3];
let mobilePreflightFailureStage = "MIGRATION_MANIFEST";

function setMobilePreflightStage(stage) {
  if (action === "mobile-preflight") mobilePreflightFailureStage = stage;
}

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
  setMobilePreflightStage("RUNTIME_CONFIGURATION");
  if (process.env.TRACEPOINT_DATA_PROVIDER !== "postgres" || process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native") throw new Error("AWS-native PostgreSQL runtime configuration is required.");
  let secret;
  setMobilePreflightStage("DATABASE_SECRET_PARSE");
  try { secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? ""); } catch { throw new Error("AWS-native database secret is invalid."); }
  setMobilePreflightStage("DATABASE_SECRET_SHAPE");
  if (!secret || typeof secret.host !== "string" || secret.port !== 5432 || secret.dbname !== "tracepoint" || typeof secret.username !== "string" || typeof secret.password !== "string") throw new Error("AWS-native database secret is invalid.");
  setMobilePreflightStage("EXPECTED_DATABASE_HOST");
  // An inspect task given a pinned host must connect to exactly that host;
  // TLS below then verifies the server certificate for the same name.
  const expectedHostPinned = action === "mobile-preflight"
    || (action === "inspect" && process.env.TRACEPOINT_EXPECTED_DATABASE_HOST !== undefined);
  const expectedRdsHostMatched = expectedHostPinned
    ? assertExpectedDatabaseHost(secret.host, process.env.TRACEPOINT_EXPECTED_DATABASE_HOST)
    : false;
  // The owner credential predates the final instance and keeps its original
  // hostname, so live owner actions connect only to the separately pinned host.
  let host = secret.host;
  if (liveOwnerActions.includes(action)) {
    const pinnedHost = process.env.TRACEPOINT_EXPECTED_DATABASE_HOST?.trim().toLowerCase().replace(/\.$/, "");
    assertExpectedDatabaseHost(pinnedHost, pinnedHost);
    if (requestedEnvironment !== "production" || secret.username !== "tracepoint_migrator") throw new Error("LIVE_OWNER_CREDENTIAL_MISMATCH");
    host = pinnedHost;
  }
  setMobilePreflightStage("DATABASE_CA");
  const caPath = process.env.TRACEPOINT_DATABASE_CA_PATH;
  if (!caPath?.startsWith("/app/") || !caPath.endsWith(".pem")) throw new Error("AWS-native database CA path is invalid.");
  const ca = await readFile(caPath, "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error("AWS-native database CA is invalid.");
  const client = new Client({ host, port: secret.port, user: secret.username, password: secret.password, database: secret.dbname, ssl: { ca, rejectUnauthorized: true, servername: host }, connectionTimeoutMillis: 10_000, statement_timeout: 60_000, application_name: "tracepoint-aws-native-migrations" });
  setMobilePreflightStage("DATABASE_CONNECT");
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
// The staging release of the Fleet/Inventory catalog rows (047) that production's Agency Documents unit also
// applies. Staging's ledger records 001-046 (046 applied by 75499335 on 2026-10-20). Its apply must find
// 001-046 recorded and exactly 047 pending; anything else stops before any SQL.
export const STAGING_RELEASE_PENDING = Object.freeze([
  "047_fleet_inventory_feature_catalog.sql",
]);
const STAGING_RELEASE_RECORDED = 46;
function requireStagingReleaseMigrations(report, files) {
  const versions = files.map((file) => file.version);
  if (report.ledger !== "present" || versions.length !== 47 || versions.some((version, index) => version !== index + 1)) {
    throw new Error("STAGING_RELEASE_LINEAGE_INVALID: expected a present ledger and contiguous migration files 001-047.");
  }
  if (report.applied.length !== STAGING_RELEASE_RECORDED || report.applied.some((row, index) => Number(row.version) !== index + 1)) {
    throw new Error("STAGING_RELEASE_LEDGER_GAP: migrations 001-046, including the Agency Documents lineage and module entitlements, must all be recorded before 047.");
  }
  if (report.pending.length !== STAGING_RELEASE_PENDING.length || report.pending.some((file, index) => file.filename !== STAGING_RELEASE_PENDING[index])) {
    throw new Error("STAGING_RELEASE_PENDING_INVALID: apply requires exactly 047 pending.");
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
  let connectionIdentity = null;
  if (!transactionAlreadyOpen) {
    for (const sql of ["BEGIN TRANSACTION READ ONLY", "SET TRANSACTION READ ONLY"]) { assertInspectionSql(sql); await client.query(sql); }
    assertInspectionSql(inspectionSearchPathSql);
    await client.query(inspectionSearchPathSql);
    if (client.expectedRdsHostMatched === true) {
      assertInspectionSql(inspectionTargetIdentitySql);
      const identity = (await client.query(inspectionTargetIdentitySql)).rows[0];
      assertDatabaseTargetIdentity(identity);
      connectionIdentity = { ...identity, expectedRdsHostMatched: true };
    }
  }
  for (const [section, sql] of inspectionCatalogQueries) { assertInspectionSql(sql); snapshot[section] = (await client.query(sql)).rows; }
  assertInspectionSql(mobileApiDependenciesSql);
  const mobileApiDependencies = (await client.query(mobileApiDependenciesSql)).rows;
  if (!transactionAlreadyOpen) {
    assertInspectionSql("COMMIT");
    await client.query("COMMIT");
  }
  return { ...classifyMigrationInspection(snapshot), mobileApiDependencies, ...(connectionIdentity ? { connectionIdentity } : {}) };
}

async function mobilePreflight(client, files) {
  setMobilePreflightStage("EXPECTED_DATABASE_HOST");
  if (requestedEnvironment !== "production") throw new Error("Mobile production preflight is production-only.");
  if (client.expectedRdsHostMatched !== true) throw new Error("DATABASE_TARGET_MISMATCH");
  setMobilePreflightStage("READ_ONLY_TRANSACTION_BEGIN");
  assertInspectionSql("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    setMobilePreflightStage("READ_ONLY_SEARCH_PATH");
    assertInspectionSql(inspectionSearchPathSql);
    await client.query(inspectionSearchPathSql);
    setMobilePreflightStage("DATABASE_IDENTITY_QUERY");
    const databaseIdentitySql = `select current_database() as database_name,
      inet_server_addr()::text as server_address, inet_server_port() as server_port,
      current_setting('search_path') as search_path, array_to_json(current_schemas(true)) as effective_schemas,
      current_user as database_user, session_user as session_user`;
    assertInspectionSql(databaseIdentitySql);
    const databaseIdentity = (await client.query(databaseIdentitySql)).rows[0];
    setMobilePreflightStage("DATABASE_IDENTITY_VALIDATION");
    assertDatabaseTargetIdentity(databaseIdentity);
    setMobilePreflightStage("DATABASE_PRINCIPAL_QUERY");
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
    setMobilePreflightStage("MIGRATION_LEDGER_READ");
    const migrationLineage = await inspectMigrationLedgerEvidence(client, files);
    if (migrationLineage.blocked) {
      const error = new Error("MIGRATION_LEDGER_LINEAGE_UNVERIFIED");
      error.migrationLineageEvidence = migrationLineage;
      throw error;
    }
    setMobilePreflightStage("SCHEMA_CATALOG_READ");
    const catalog = await inspect(client, { transactionAlreadyOpen: true });
    setMobilePreflightStage("READ_ONLY_TRANSACTION_COMMIT");
    assertInspectionSql("COMMIT");
    await client.query("COMMIT");
    return {
      status: "PASSED",
      inspection: "read-only",
      transaction: { isolation: "repeatable read", readOnly: true },
      connectionIdentity: { ...databaseIdentity, expectedRdsHostMatched: true },
      databasePrincipal,
      ledger: "present",
      latestAppliedVersion: migrationLineage.latestAppliedVersion,
      appliedVersions: migrationLineage.appliedVersions,
      pending: migrationLineage.pending,
      ledgerEvidence: migrationLineage,
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
  const migration = files.find(file => file.version === 43 && file.filename === "043_range_workspace_authenticated_writes.sql");
  if (!migration || files.filter(file => file.version === 43).length !== 1 || !migration.ownsTransaction) throw new Error("Range workspace hotfix requires exactly the transaction-owned migration 043.");
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
  if (!["status", "inspect", "diagnose", "mobile-preflight", "range-workspace-hotfix", "baseline", "reconcile", "apply", ...liveOwnerActions].includes(action)) throw new Error("Usage: run-aws-native-migrations.mjs <status|inspect|diagnose|mobile-preflight|range-workspace-hotfix|baseline|reconcile|apply|precheck|inventory-035-037|password-scope-039-040|agency-documents-038-047> <staging|production>");
  if (!["staging", "production"].includes(requestedEnvironment)) throw new Error("A staging or production environment is required.");
  if (action === "mobile-preflight" && requestedEnvironment !== "production") throw new Error("Mobile production preflight is production-only.");
  if (action === "diagnose" && requestedEnvironment !== "staging") throw new Error("Migration diagnostics are staging-only.");
  if (liveOwnerActions.includes(action) && requestedEnvironment !== "production") throw new Error("Live final-database actions are production-only.");
  setMobilePreflightStage("RUNTIME_CONFIGURATION");
  if (process.env.CONFIGURATION_ENVIRONMENT !== requestedEnvironment) throw new Error("Migration environment does not match the runtime configuration.");
  if (action === "baseline" && requestedEnvironment !== "staging") throw new Error("Baseline is intentionally staging-only.");
  // The reviewed resolution list is validated before any connection.
  const passwordScopeResolutions = action === "password-scope-039-040"
    ? parsePasswordScopeResolutions(process.env.TRACEPOINT_PASSWORD_SCOPE_RESOLUTIONS)
    : null;
  setMobilePreflightStage("MIGRATION_MANIFEST");
  files = await migrations();
  try {
    client = await connect();
  } catch (error) {
    if (action === "diagnose") throw new Error("STAGING_DATABASE_DIAGNOSTIC_FAILED: database connection details suppressed.");
    throw error;
  }
  if (action === "status") {
    console.log(JSON.stringify(await report(client, files)));
  } else if (action === "inspect") {
    console.log(JSON.stringify(await inspect(client)));
  } else if (action === "diagnose") {
    try {
      const { readMigration038Diagnostics } = await import("./aws-native-migration-diagnostics.mjs");
      console.log(JSON.stringify(await readMigration038Diagnostics(client)));
    } catch {
      throw new Error("STAGING_DATABASE_DIAGNOSTIC_FAILED: query details suppressed.");
    }
  } else if (action === "mobile-preflight") {
    console.log(JSON.stringify(await mobilePreflight(client, files)));
  } else if (action === "range-workspace-hotfix") {
    console.log(JSON.stringify(await applyRangeWorkspaceHotfix(client, files)));
  } else if (action === "precheck") {
    console.log(JSON.stringify(await runLivePrecheck(client)));
  } else if (action === "inventory-035-037") {
    console.log(JSON.stringify(await withLock(client, () => applyInventoryUnit(client, files))));
  } else if (action === "password-scope-039-040") {
    console.log(JSON.stringify(await withLock(client, () => applyPasswordScopeResolutionUnit(client, files, passwordScopeResolutions))));
  } else if (action === "agency-documents-038-047") {
    console.log(JSON.stringify(await withLock(client, () => applyAgencyDocumentsUnit(client, files))));
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
          || pending[0]?.version !== 43
          || pending[0]?.filename !== "043_range_workspace_authenticated_writes.sql"
          || pending[1]?.version !== 44
          || pending[1]?.filename !== "044_cognito_password_global_scope.sql"
        ) {
          throw new Error("Production reconciliation requires the verified 001-037 chain followed by pending migrations 043 and 044.");
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
      if (requestedEnvironment === "staging" && action === "apply") requireStagingReleaseMigrations(await report(client, files), files);
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
    console.error(JSON.stringify({
      status: "BLOCKED",
      inspection: "read-only",
      reason: "DATABASE_INSPECTION_FAILED",
      failure: mobilePreflightFailureDetails(mobilePreflightFailureStage, error),
        ...(error?.migrationLineageEvidence ? { migrationLineage: error.migrationLineageEvidence } : {}),
    }));
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  if (client) await client.end().catch(() => undefined);
}
