import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import {
  assertProductionLedgerAdoptionPostconditions,
  productionLedgerAdoptionPostconditions,
  productionLedgerAdoptionPostconditionsSql,
} from "./aws-native-production-ledger-adoption.mjs";
import { assertDatabaseTargetIdentity, assertExpectedDatabaseHost, assertInspectionSql, classifyMigrationInspection, inspectMigrationLedgerEvidence, inspectionCatalogQueries, inspectionSearchPathSql, migrationInspectionManifest, migrationLedgerDiscoverySql, awsNativeMigrationLedgerSql, importedAwsMigrationLedgerSql, migrationLedgerTransactionSql, mobileApiDependenciesSql } from "./aws-native-migration-inspection.mjs";
import { localPostgresPort } from "../src/test-support/local-postgres-port.mjs";
import { mobilePreflightFailureDetails } from "./aws-native-mobile-preflight-diagnostics.mjs";

const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"];
const typecheckExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const generatedRuntimeImports = new Set(["scripts/start-tracepoint-container.mjs -> ./server.js"]);
const normalize = value => value.replaceAll("\\", "/");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(name);
    return sourceExtensions.includes(path.extname(entry.name)) ? [name] : [];
  }));
  return files.flat();
}

async function firstExisting(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

function localSpecifiers(source) {
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'\n]*?\s+from\s+)?["'](\.{1,2}\/[^"]+?)["']|\b(?:import|require)\(\s*["'](\.{1,2}\/[^"]+?)["']\s*\)/g)]
    .map(match => match[1] ?? match[2]);
}

function archiveIncludes(archivePaths, file) {
  return archivePaths.some(entry => file === entry || file.startsWith(`${entry}/`));
}

async function assertArchivedScriptImportClosure({ root, archivePaths, validationScripts }) {
  const scripts = await sourceFiles(path.join(root, "scripts"));
  const pending = [
    ...scripts.filter(file => typecheckExtensions.has(path.extname(file))).map(file => normalize(path.relative(root, file))),
    ...validationScripts,
  ];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(path.join(root, file), "utf8");
    for (const specifier of localSpecifiers(source)) {
      const base = path.resolve(root, path.dirname(file), specifier);
      const resolved = await firstExisting([base, ...sourceExtensions.map(extension => `${base}${extension}`), ...sourceExtensions.map(extension => path.join(base, `index${extension}`))]);
      if (!resolved && generatedRuntimeImports.has(`${file} -> ${specifier}`)) continue;
      assert.ok(resolved, `${file} imports missing local module ${specifier}`);
      const relative = normalize(path.relative(root, resolved));
      assert.ok(archiveIncludes(archivePaths, relative), `${file} imports ${relative}, which is absent from the migration archive`);
      pending.push(relative);
    }
  }
}

async function localImportClosure({ root, entry }) {
  const pending = [entry];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(path.join(root, file), "utf8");
    for (const specifier of localSpecifiers(source)) {
      const base = path.resolve(root, path.dirname(file), specifier);
      const resolved = await firstExisting([base, ...sourceExtensions.map(extension => `${base}${extension}`), ...sourceExtensions.map(extension => path.join(base, `index${extension}`))]);
      assert.ok(resolved, `${file} imports missing local runtime module ${specifier}`);
      pending.push(normalize(path.relative(root, resolved)));
    }
  }
  return visited;
}

function finalStageCopyDestinations(dockerfile) {
  const finalStage = dockerfile.slice(dockerfile.lastIndexOf("\nFROM "));
  return [...finalStage.matchAll(/^COPY(?:\s+--\S+)*\s+\S+\s+(\S+)\s*$/gm)]
    .map(match => normalize(match[1].replace(/^\.\//, "").replace(/^\/app\//, "")));
}

async function assertFinalMigrationRuntimeClosure({ root, dockerfilePath }) {
  const dockerfile = await readFile(dockerfilePath, "utf8");
  const destinations = finalStageCopyDestinations(dockerfile);
  const closure = await localImportClosure({ root, entry: "scripts/run-aws-native-migrations.mjs" });
  for (const file of closure) {
    assert.ok(archiveIncludes(destinations, file), `${path.basename(dockerfilePath)} final migration stage omits runtime module ${file}`);
  }
}

async function activeRuntimeDockerfiles(root) {
  const environments = [
    { name: "staging", filename: "Dockerfile" },
    { name: "production", filename: "Dockerfile.aws-native-production" },
  ];
  const requestedEnvironment = process.env.TRACEPOINT_MIGRATION_TEST_ENVIRONMENT;
  const candidates = requestedEnvironment
    ? environments.filter(environment => environment.name === requestedEnvironment)
    : environments;
  assert.ok(candidates.length, `Unsupported migration test environment ${requestedEnvironment}`);
  const existing = [];
  for (const environment of candidates) {
    const dockerfilePath = path.join(root, environment.filename);
    try {
      await access(dockerfilePath);
      existing.push({ ...environment, dockerfilePath });
    } catch {
      if (requestedEnvironment) throw new Error(`${environment.filename} is required for the ${requestedEnvironment} migration image`);
    }
  }
  assert.ok(existing.length, "the current migration image must include its environment Dockerfile");
  return existing;
}

test("AWS-native migration runner is ledgered, locked, hash-checked, and does not wrap file transactions", async () => {
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  assert.match(runner, /tracepoint_aws_schema_migrations/);
  assert.match(runner, /createHash\("sha256"\)/);
  assert.match(runner, /MIGRATION_DRIFT/);
  assert.match(runner, /pg_advisory_lock/);
  assert.match(runner, /ownsTransaction/);
  assert.match(runner, /cannot be executed: AWS-native migrations must own an explicit outer BEGIN\/COMMIT transaction/);
  assert.match(runner, /replace\(\/commit;/);
  assert.match(runner, /AWS_NATIVE_BASELINE_UNVERIFIED/);
  assert.match(runner, /action === "baseline" && requestedEnvironment !== "staging"/);
  assert.match(runner, /requestedEnvironment === "production"/);
  assert.match(runner, /verifyProductionLedgerAdoptionAnchor/);
  assert.match(runner, /file\.version <= productionLedgerAdoptionVersions\.last/);
  assert.match(runner, /038_range_workspace_authenticated_writes\.sql/);
});

test("production publish-only action stops after immutable image publication", async () => {
  const publisher = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  assert.match(publisher, /ValidateSet\([^\n]*'publish-only'/);
  assert.match(publisher, /publish-only' -and \$Environment -ne 'production'/);
  assert.match(publisher, /publish-only' -and -not \$ImageCommit/);
  assert.match(publisher, /publish-only' -and \$resolved -ne \$commit/);
  const branchStart = publisher.lastIndexOf("if ($Action -eq 'publish-only') {");
  const branchEnd = publisher.indexOf("Invoke-MigrationTask $commit", branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  const branch = publisher.slice(branchStart, branchEnd);
  assert.match(branch, /Publish-MigrationImage \$commit/);
  assert.match(branch, /ConvertTo-Json \$published/);
  assert.match(publisher.slice(branchStart), /}\s+else\s+\{\s+Invoke-MigrationTask \$commit/);
  assert.doesNotMatch(branch, /Invoke-MigrationTask|ecs|rds|MigratorSecretArn|TRACEPOINT_DATABASE/);
  const imagePublisher = publisher.slice(publisher.indexOf("function Publish-MigrationImage"), publisher.indexOf("function Invoke-MigrationTask"));
  assert.match(imagePublisher, /'s3api','put-object'/);
  assert.match(imagePublisher, /'codebuild','start-build'/);
  assert.match(imagePublisher, /'ecr','describe-images'/);
  assert.doesNotMatch(imagePublisher, /'ecs'|'rds'|MigratorSecretArn|TRACEPOINT_DATABASE/);
});

test("production reconciliation refuses to adopt a migration when a catalog postcondition is absent", () => {
  const verified = Object.fromEntries(productionLedgerAdoptionPostconditions.map(key => [key, true]));
  assert.doesNotThrow(() => assertProductionLedgerAdoptionPostconditions(verified));
  assert.throws(
    () => assertProductionLedgerAdoptionPostconditions({ ...verified, inventory_runtime_dml_grants: false }),
    /AWS_NATIVE_PRODUCTION_ADOPTION_UNVERIFIED: inventory_runtime_dml_grants/,
  );
  assert.match(productionLedgerAdoptionPostconditionsSql, /audit_log_select_authorized/);
  assert.match(productionLedgerAdoptionPostconditionsSql, /attachments_fleet_vehicle_document_active_idx/);
  assert.match(productionLedgerAdoptionPostconditionsSql, /inventory_transactions_transaction_type_check/);
  assert.match(productionLedgerAdoptionPostconditionsSql, /has_table_privilege\('authenticated', to_regclass\('public.inventory_items'\), 'insert'\)/);
});

test("inspection is fixed catalog-only SQL and cannot mutate the ledger", async () => {
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  for (const [, sql] of inspectionCatalogQueries) assert.doesNotThrow(() => assertInspectionSql(sql));
  const mobileDependencyQuery = mobileApiDependenciesSql;
  assert.ok(mobileDependencyQuery);
  assert.doesNotThrow(() => assertInspectionSql(mobileDependencyQuery));
  for (const sql of [migrationLedgerTransactionSql, migrationLedgerDiscoverySql, awsNativeMigrationLedgerSql, importedAwsMigrationLedgerSql]) assert.doesNotThrow(() => assertInspectionSql(sql));
  const databasePrincipalQuery = runner.match(/const databasePrincipalSql = `([\s\S]*?)`;/)?.[1];
  assert.ok(databasePrincipalQuery);
  assert.doesNotThrow(() => assertInspectionSql(databasePrincipalQuery));
  assert.doesNotThrow(() => assertInspectionSql("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"));
  assert.doesNotThrow(() => assertInspectionSql(inspectionSearchPathSql));
  assert.throws(() => assertInspectionSql("SET LOCAL search_path = public"), /READ_ONLY_INSPECTION_SQL_REJECTED/);
  for (const sql of ["insert into public.tracepoint_aws_schema_migrations values (1)", "insert into tracepoint_migrations.applied_migrations values ('aws','001_test.sql','hash')", "update public.x set y=1", "create table public.x(id int)"]) assert.throws(() => assertInspectionSql(sql), /READ_ONLY_INSPECTION_SQL_REJECTED/);
  assert.match(runner, /action === "inspect"/);
  assert.match(runner, /BEGIN TRANSACTION READ ONLY/);
  const inspectionBody = runner.slice(runner.indexOf("async function inspect"), runner.indexOf("async function rangeWorkspaceContract"));
  assert.doesNotMatch(inspectionBody, /ensureLedger|withLock|migrationSqlWithLedgerEntry/);
  assert.match(runner, /mobileApiDependencies/);
  assert.match(runner, /inspectMigrationLedgerEvidence\(client, files\)/);
  assert.doesNotMatch(runner.slice(runner.indexOf("async function mobilePreflight"), runner.indexOf("async function rangeWorkspaceContract")), /await report\(client, files\)/);
  assert.match(runner, /pilot_range_workspaces_accountability_audit/);
});

test("column and trigger discovery uses explicit catalogs independent of runtime visibility", () => {
  const columnsSql = inspectionCatalogQueries.find(([name]) => name === "columns")?.[1] ?? "";
  const privilegesSql = inspectionCatalogQueries.find(([name]) => name === "privileges")?.[1] ?? "";
  const triggersSql = inspectionCatalogQueries.find(([name]) => name === "triggers")?.[1] ?? "";
  const mobileDependencyQuery = mobileApiDependenciesSql;
  assert.match(columnsSql, /from pg_attribute[\s\S]*join pg_class[\s\S]*join pg_namespace/);
  assert.match(columnsSql, /n\.nspname in \('public','tracepoint_auth'\)/);
  assert.doesNotMatch(columnsSql, /information_schema\.columns/);
  assert.match(mobileDependencyQuery, /from pg_attribute actual[\s\S]*join pg_class relation[\s\S]*join pg_namespace relation_schema/);
  assert.match(mobileDependencyQuery, /to_regclass\(format\('public\.%I', required\.relation_name\)\) is not null as relation_present/);
  assert.match(mobileDependencyQuery, /runtime_select_privilege_present/);
  assert.match(mobileDependencyQuery, /authenticated_select_privilege_present/);
  assert.match(privilegesSql, /has_table_privilege/);
  assert.match(triggersSql, /from pg_trigger[\s\S]*join pg_class[\s\S]*join pg_namespace/);
  assert.doesNotMatch(triggersSql, /information_schema\.triggers/);

  const runtimeWithoutTableGrants = classifyMigrationInspection({
    schemas: [],
    relations: [{ schema: "public", name: "authentication_refresh_sessions" }],
    columns: [
      { schema: "public", relation: "authentication_refresh_sessions", column_name: "last_seen_at" },
      { schema: "public", relation: "authentication_refresh_sessions", column_name: "idle_expires_at" },
    ],
    routines: [],
    indexes: [{ name: "authentication_refresh_ready_session" }],
    constraints: [],
    policies: [],
    privileges: [],
    roles: [{ name: "tracepoint_runtime" }],
    triggers: [],
  });
  assert.equal(runtimeWithoutTableGrants.migrations.find(({ version }) => version === 2)?.status, "present");
  assert.equal(runtimeWithoutTableGrants.migrations.find(({ version }) => version === 35)?.status, "absent");
  assert.deepEqual(runtimeWithoutTableGrants.migrations[1].evidence.filter(({ check }) => check.includes("authentication_refresh_sessions")).map(({ present }) => present), [true, true]);
});

test("inspection target identity rejects wrong host, database, server, or principal", () => {
  assert.equal(assertExpectedDatabaseHost("TRACEPOINT-PROD.ABC.us-east-1.rds.amazonaws.com.", "tracepoint-prod.abc.us-east-1.rds.amazonaws.com"), true);
  assert.throws(() => assertExpectedDatabaseHost("tracepoint-staging.abc.us-east-1.rds.amazonaws.com", "tracepoint-prod.abc.us-east-1.rds.amazonaws.com"), /DATABASE_TARGET_MISMATCH/);
  const identity = {
    database_name: "tracepoint",
    server_address: "10.0.1.25",
    server_port: 5432,
    search_path: "pg_catalog",
    effective_schemas: ["pg_catalog"],
    database_user: "tracepoint_runtime",
    session_user: "tracepoint_runtime",
  };
  assert.equal(assertDatabaseTargetIdentity(identity), true);
  assert.throws(() => assertDatabaseTargetIdentity({ ...identity, database_name: "staging" }), /DATABASE_TARGET_MISMATCH/);
  assert.throws(() => assertDatabaseTargetIdentity({ ...identity, server_port: 5433 }), /DATABASE_TARGET_MISMATCH/);
  assert.throws(() => assertDatabaseTargetIdentity({ ...identity, session_user: "postgres" }), /DATABASE_TARGET_MISMATCH/);
});

test("embedded Postgres confirms catalog columns despite NOINHERIT visibility and preserves local search path", { timeout: 120_000 }, async () => {
  let server;
  let owner;
  let runtime;
  let directory;
  let transactionOpen = false;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "tp-inspection-noinherit-"));
    const port = await localPostgresPort();
    server = new EmbeddedPostgres({
      databaseDir: directory,
      user: "postgres",
      password: "local-inspection-only",
      port,
      persistent: true,
      postgresFlags: ["-h", "127.0.0.1"],
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    const config = { host: "127.0.0.1", port, database: "postgres" };
    owner = new pg.Client({ ...config, user: "postgres", password: "local-inspection-only" });
    await owner.connect();
    await owner.query("CREATE DATABASE tracepoint");
    await owner.end();
    config.database = "tracepoint";
    owner = new pg.Client({ ...config, user: "postgres", password: "local-inspection-only" });
    await owner.connect();
    await owner.query(`
      create role authenticated nologin noinherit;
      create role tracepoint_runtime login noinherit password 'runtime-local-only';
      grant authenticated to tracepoint_runtime;
      alter role tracepoint_runtime set search_path = public, pg_catalog;
      create table public.fleet_vehicles (
        id uuid, department_id uuid, unit_number text, vin text, status text
      );
      grant select on public.fleet_vehicles to authenticated;
      create function public.format_type(oid, integer) returns text
        language sql immutable as $$ select 'SHADOWED'::text $$;
    `);
    runtime = new pg.Client({ ...config, user: "tracepoint_runtime", password: "runtime-local-only" });
    await runtime.connect();

    const rolePrivileges = (await runtime.query(`
      select current_user as current_user, session_user as session_user, role.rolinherit,
        has_table_privilege(current_user, 'public.fleet_vehicles', 'select') as runtime_select,
        has_table_privilege('authenticated', 'public.fleet_vehicles', 'select') as authenticated_select
      from pg_roles role where role.rolname=current_user
    `)).rows[0];
    assert.deepEqual(rolePrivileges, {
      current_user: "tracepoint_runtime",
      session_user: "tracepoint_runtime",
      rolinherit: false,
      runtime_select: false,
      authenticated_select: true,
    });
    assert.equal((await runtime.query(`select format_type('uuid'::regtype, 0) as rendered_type`)).rows[0].rendered_type, "SHADOWED");
    const legacyColumns = await runtime.query("select column_name from information_schema.columns where table_schema='public' and table_name='fleet_vehicles'");
    assert.equal(legacyColumns.rowCount, 0, "information_schema hides columns from the NOINHERIT member without direct table grants");

    await runtime.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    await runtime.query(inspectionSearchPathSql);
    const identity = (await runtime.query(`select current_database() as database_name,
      inet_server_addr()::text as server_address, inet_server_port() as server_port,
      current_setting('search_path') as search_path, array_to_json(current_schemas(true)) as effective_schemas,
      current_user as database_user, session_user as session_user`)).rows[0];
    assert.equal(assertDatabaseTargetIdentity(identity, { expectedPort: port }), true);

    const columnsQuery = inspectionCatalogQueries.find(([name]) => name === "columns")?.[1];
    assert.ok(columnsQuery);
    const columns = await runtime.query(columnsQuery);
    const fleetColumns = columns.rows.filter(row => row.schema === "public" && row.relation === "fleet_vehicles");
    assert.deepEqual(fleetColumns.map(row => row.column_name), ["id", "department_id", "unit_number", "vin", "status"]);
    assert.equal(fleetColumns.find(row => row.column_name === "id")?.data_type, "uuid", "pg_catalog format_type must win over the shadowed public function");

    assert.doesNotThrow(() => assertInspectionSql(mobileApiDependenciesSql));
    const dependencies = await runtime.query(mobileApiDependenciesSql);
    const fleet = dependencies.rows.find(row => row.relation_name === "fleet_vehicles");
    assert.equal(fleet.relation_present, true);
    assert.equal(fleet.required_columns_present, true);
    assert.equal(fleet.runtime_select_privilege_present, false);
    assert.equal(fleet.authenticated_select_privilege_present, true);
    const missingInventory = dependencies.rows.find(row => row.relation_name === "inventory_items");
    assert.equal(missingInventory.relation_present, false);
    assert.equal(missingInventory.required_columns_present, false);
    assert.equal(missingInventory.runtime_select_privilege_present, false);
    await runtime.query("COMMIT");
    transactionOpen = false;
    assert.equal((await runtime.query("select current_setting('search_path') as search_path")).rows[0].search_path, "public, pg_catalog", "SET LOCAL must not change the runtime role's normal session search path");
  } finally {
    if (transactionOpen) await runtime?.query("ROLLBACK").catch(() => undefined);
    await runtime?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
    await server?.stop().catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => undefined);
  }
});

test("embedded Postgres reconciles both migration ledgers without writes or count-based lineage claims", { timeout: 120_000 }, async () => {
  let server;
  let owner;
  let reader;
  let directory;
  let transactionOpen = false;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "tp-dual-migration-ledger-"));
    const port = await localPostgresPort();
    server = new EmbeddedPostgres({
      databaseDir: directory,
      user: "postgres",
      password: "local-ledger-only",
      port,
      persistent: true,
      postgresFlags: ["-h", "127.0.0.1"],
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
      onError: () => {},
    });
    await server.initialise();
    await server.start();
    const config = { host: "127.0.0.1", port, database: "postgres" };
    owner = new pg.Client({ ...config, user: "postgres", password: "local-ledger-only" });
    await owner.connect();
    await owner.query("CREATE DATABASE tracepoint");
    await owner.end();
    config.database = "tracepoint";
    owner = new pg.Client({ ...config, user: "postgres", password: "local-ledger-only" });
    await owner.connect();
    await owner.query("create role migration_ledger_reader login noinherit password 'ledger-reader-local-only'");
    reader = new pg.Client({ ...config, user: "migration_ledger_reader", password: "ledger-reader-local-only" });
    await reader.connect();

    const files = [
      { version: 1, filename: "001_first.sql", sha256: "a".repeat(64) },
      { version: 2, filename: "002_second.sql", sha256: "b".repeat(64) },
      { version: 3, filename: "003_third.sql", sha256: "c".repeat(64) },
      { version: 4, filename: "004_fourth.sql", sha256: "d".repeat(64) },
    ];
    const importedFor = versions => versions.map(version => ({
      kind: "aws",
      filename: files[version - 1].filename,
      sha256: files[version - 1].sha256,
    }));
    const nativeFor = (versions, overrides = {}) => versions.map(version => ({
      version,
      filename: files[version - 1].filename,
      sha256: overrides[version] ?? files[version - 1].sha256,
    }));
    async function replaceLedgers({ awsNativeRows = null, importedRows = null, grantNativeSelect = true, grantImportedUsage = true, grantImportedSelect = true } = {}) {
      await owner.query("drop table if exists public.tracepoint_aws_schema_migrations");
      await owner.query("drop schema if exists tracepoint_migrations cascade");
      if (awsNativeRows !== null) {
        await owner.query("create table public.tracepoint_aws_schema_migrations (version integer, filename text, content_sha256 text)");
        for (const row of awsNativeRows) await owner.query(
          "insert into public.tracepoint_aws_schema_migrations(version, filename, content_sha256) values ($1, $2, $3)",
          [row.version, row.filename, row.sha256],
        );
        if (grantNativeSelect) await owner.query("grant select on public.tracepoint_aws_schema_migrations to migration_ledger_reader");
      }
      if (importedRows !== null) {
        await owner.query("create schema tracepoint_migrations");
        await owner.query("create table tracepoint_migrations.applied_migrations (kind text, name text, sha256 text)");
        for (const row of importedRows) await owner.query(
          "insert into tracepoint_migrations.applied_migrations(kind, name, sha256) values ($1, $2, $3)",
          [row.kind, row.filename, row.sha256],
        );
        if (grantImportedUsage) await owner.query("grant usage on schema tracepoint_migrations to migration_ledger_reader");
        if (grantImportedSelect) await owner.query("grant select on tracepoint_migrations.applied_migrations to migration_ledger_reader");
      }
    }
    async function inspectReadOnly() {
      await reader.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionOpen = true;
      try {
        const result = await inspectMigrationLedgerEvidence(reader, files);
        await reader.query("COMMIT");
        transactionOpen = false;
        return result;
      } catch (error) {
        await reader.query("ROLLBACK");
        transactionOpen = false;
        throw error;
      }
    }

    await replaceLedgers();
    const noLedger = await inspectReadOnly();
    assert.equal(noLedger.status, "unknown");
    assert.equal(noLedger.blocked, true);
    assert.equal(noLedger.appliedVersions, null);
    assert.equal(noLedger.pending, null, "absence of both ledgers must not be reported as every migration pending");

    await replaceLedgers({ importedRows: importedFor([1, 2]) });
    const alternateOnly = await inspectReadOnly();
    assert.equal(alternateOnly.status, "verified");
    assert.equal(alternateOnly.source, "tracepoint_migrations.applied_migrations");
    assert.deepEqual(alternateOnly.appliedVersions, [1, 2]);
    assert.deepEqual(alternateOnly.pending.map(row => row.version), [3, 4]);
    assert.deepEqual(alternateOnly.ledgers.imported.entries.map(({ filename, sha256, expectedFilename, expectedSha256 }) => ({ filename, sha256, expectedFilename, expectedSha256 })), [
      { filename: files[0].filename, sha256: files[0].sha256, expectedFilename: files[0].filename, expectedSha256: files[0].sha256 },
      { filename: files[1].filename, sha256: files[1].sha256, expectedFilename: files[1].filename, expectedSha256: files[1].sha256 },
    ]);
    await owner.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await assert.rejects(owner.query("insert into tracepoint_migrations.applied_migrations(kind, name, sha256) values ('aws', '003_third.sql', 'x')"), error => error.code === "25006");
    await owner.query("ROLLBACK");
    assert.equal((await owner.query("select count(*)::int as count from tracepoint_migrations.applied_migrations")).rows[0].count, 2, "read-only transaction must leave ledger rows unchanged");

    await replaceLedgers({ awsNativeRows: nativeFor([1, 2, 3]) });
    const nativeOnly = await inspectReadOnly();
    assert.equal(nativeOnly.status, "verified");
    assert.equal(nativeOnly.source, "public.tracepoint_aws_schema_migrations");
    assert.deepEqual(nativeOnly.appliedVersions, [1, 2, 3]);
    assert.deepEqual(nativeOnly.pending.map(row => row.version), [4]);

    const sharedRows = importedFor([1, 2, 3, 4]);
    await replaceLedgers({ importedRows: sharedRows, awsNativeRows: nativeFor([1, 2, 3, 4]) });
    const bothAgree = await inspectReadOnly();
    assert.equal(bothAgree.status, "verified");
    assert.equal(bothAgree.source, "both");
    assert.equal(bothAgree.comparison, "both-agree");
    assert.deepEqual(bothAgree.appliedVersions, [1, 2, 3, 4]);
    assert.deepEqual(bothAgree.pending, []);

    await replaceLedgers({ importedRows: sharedRows, awsNativeRows: nativeFor([1, 2, 3, 4]), grantNativeSelect: false });
    await assert.rejects(inspectReadOnly(), error => error.code === "MIGRATION_LEDGER_AWS_NATIVE_SELECT_DENIED", "an unreadable AWS-native ledger must be identified and block verification");

    await replaceLedgers({ importedRows: sharedRows, awsNativeRows: nativeFor([1, 2, 3, 4]), grantImportedUsage: false });
    await assert.rejects(inspectReadOnly(), error => error.code === "MIGRATION_LEDGER_IMPORTED_SCHEMA_USAGE_DENIED", "missing imported-ledger schema USAGE must be distinguished from table SELECT");

    await replaceLedgers({ importedRows: sharedRows, awsNativeRows: nativeFor([1, 2, 3, 4], { 2: "f".repeat(64) }) });
    const disagree = await inspectReadOnly();
    assert.equal(disagree.status, "divergent");
    assert.equal(disagree.blocked, true);
    assert.equal(disagree.pending, null);
    assert.ok(disagree.ledgers.awsNative.issues.some(issue => issue.code === "REPOSITORY_MISMATCH" && issue.expectedSha256 === files[1].sha256));
    assert.equal(disagree.comparison, "conflicts");

    await replaceLedgers({ importedRows: importedFor([1, 2]), awsNativeRows: nativeFor([1, 2, 3]) });
    const coverageMismatch = await inspectReadOnly();
    assert.equal(coverageMismatch.status, "partial");
    assert.equal(coverageMismatch.blocked, true);
    assert.equal(coverageMismatch.comparison, "coverage-differs");
    assert.equal(coverageMismatch.appliedVersions, null);
    assert.equal(coverageMismatch.pending, null, "different ledger coverage must not be collapsed into one guessed pending list");

    await replaceLedgers({ importedRows: importedFor([1, 3]) });
    const partial = await inspectReadOnly();
    assert.equal(partial.status, "partial");
    assert.equal(partial.blocked, true);
    assert.equal(partial.highestContiguousVersion, 1);
    assert.deepEqual(partial.ledgers.imported.outOfOrderVersions, [3]);
    assert.equal(partial.appliedVersions, null);
    assert.equal(partial.pending, null, "a gap must not be converted into a guessed pending list");

    await replaceLedgers({ importedRows: sharedRows, awsNativeRows: nativeFor([1, 2, 3, 4]), grantImportedSelect: false });
    await assert.rejects(inspectReadOnly(), error => error.code === "MIGRATION_LEDGER_IMPORTED_SELECT_DENIED", "permission failure on one present ledger must block rather than fall back to the readable ledger");
    await reader.query("BEGIN");
    transactionOpen = true;
    await assert.rejects(inspectMigrationLedgerEvidence(reader, files), /MIGRATION_LEDGER_READ_ONLY_TRANSACTION_REQUIRED/);
    await reader.query("ROLLBACK");
    transactionOpen = false;
  } finally {
    if (transactionOpen) await reader?.query("ROLLBACK").catch(() => undefined);
    await reader?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
    await server?.stop().catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => undefined);
  }
});

test("mobile production preflight reads ledger and schema in one explicit read-only transaction", async () => {
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  assert.match(runner, /"mobile-preflight"/);
  assert.match(runner, /async function mobilePreflight\(client, files\)/);
  assert.match(runner, /requestedEnvironment !== "production"\) throw new Error\("Mobile production preflight is production-only/);
  const body = runner.slice(runner.indexOf("async function mobilePreflight"), runner.indexOf("async function rangeWorkspaceContract"));
  assert.match(body, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.ok(body.indexOf("await client.query(inspectionSearchPathSql)") < body.indexOf("const databaseIdentitySql"));
  assert.match(body, /array_to_json\(current_schemas\(true\)\) as effective_schemas/);
  assert.match(body, /await inspectMigrationLedgerEvidence\(client, files\)/);
  assert.match(body, /migrationLineage\.blocked/);
  assert.match(body, /ledgerEvidence: migrationLineage/);
  assert.match(body, /inspect\(client, \{ transactionAlreadyOpen: true \}\)/);
  assert.match(body, /await client\.query\("COMMIT"\)/);
  assert.match(body, /await client\.query\("ROLLBACK"\)/);
  assert.doesNotMatch(body, /ensureLedger|withLock|migrationSqlWithLedgerEntry|applyRangeWorkspaceHotfix/);
  assert.match(body, /appliedVersions:/);
  assert.match(body, /mobileApiDependencies:/);
  assert.match(body, /migrations: catalog\.migrations\.map\(\(\{ version, status \}\) => \(\{ version, status \}\)\)/);
  assert.match(body, /current_database\(\)[\s\S]*inet_server_addr\(\)[\s\S]*inet_server_port\(\)[\s\S]*current_setting\('search_path'\)[\s\S]*current_user[\s\S]*session_user/);
  assert.match(body, /expectedRdsHostMatched: true/);
});

test("mobile preflight failures report safe stage and stable code without database details", async () => {
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  assert.match(runner, /failure:\s*mobilePreflightFailureDetails\(mobilePreflightFailureStage,\s*error\)/);
  const failureHandler = runner.slice(runner.lastIndexOf("} catch (error) {"));
  assert.doesNotMatch(failureHandler, /error\.(?:message|stack)/);

  const hostMismatch = mobilePreflightFailureDetails("EXPECTED_DATABASE_HOST", new Error("DATABASE_TARGET_MISMATCH"));
  assert.deepEqual(hostMismatch, { stage: "EXPECTED_DATABASE_HOST", code: "DATABASE_TARGET_MISMATCH" });

  const authRejected = mobilePreflightFailureDetails("DATABASE_CONNECT", Object.assign(new Error("password rejected for secret user"), { code: "28P01" }));
  assert.deepEqual(authRejected, { stage: "DATABASE_CONNECT", code: "DATABASE_AUTH_REJECTED" });

  const ledgerDenied = mobilePreflightFailureDetails("MIGRATION_LEDGER_READ", Object.assign(new Error("sensitive database error"), { code: "MIGRATION_LEDGER_IMPORTED_SELECT_DENIED" }));
  assert.deepEqual(ledgerDenied, { stage: "MIGRATION_LEDGER_READ", code: "MIGRATION_LEDGER_IMPORTED_SELECT_DENIED" });
  const discoveryDenied = mobilePreflightFailureDetails("MIGRATION_LEDGER_READ", Object.assign(new Error("secret-bearing query failure"), { code: "MIGRATION_LEDGER_DISCOVERY_FAILED_42501" }));
  assert.deepEqual(discoveryDenied, { stage: "MIGRATION_LEDGER_READ", code: "MIGRATION_LEDGER_DISCOVERY_FAILED_42501" });

  const tlsFailure = mobilePreflightFailureDetails("DATABASE_CONNECT", Object.assign(new Error("certificate details and host"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }));
  assert.deepEqual(tlsFailure, { stage: "DATABASE_CONNECT", code: "DATABASE_TLS_VALIDATION_FAILED" });

  const unknownFailure = mobilePreflightFailureDetails("SCHEMA_CATALOG_READ", new Error("postgres://user:secret@db/password"));
  assert.deepEqual(unknownFailure, { stage: "SCHEMA_CATALOG_READ", code: "SCHEMA_CATALOG_READ_FAILED" });
  assert.doesNotMatch(JSON.stringify([hostMismatch, authRejected, ledgerDenied, discoveryDenied, tlsFailure, unknownFailure]), /secret|password|postgres:|certificate details|host/);

  const unknownStage = mobilePreflightFailureDetails("secret-host", new Error("untrusted details"));
  assert.deepEqual(unknownStage, { stage: "UNKNOWN", code: "MOBILE_PREFLIGHT_FAILED" });
});

test("mobile preflight reports runtime environment mismatch through the sanitized failure handler", () => {
  const runnerPath = fileURLToPath(new URL("./run-aws-native-migrations.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [runnerPath, "mobile-preflight", "production"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, CONFIGURATION_ENVIRONMENT: "staging" },
  });

  assert.equal(result.status, 1, result.stderr);
  const failure = JSON.parse(result.stderr);
  assert.deepEqual(failure.failure, { stage: "RUNTIME_CONFIGURATION", code: "RUNTIME_CONFIGURATION_INVALID" });
  assert.doesNotMatch(result.stderr, /secret|password|postgres:|host|Migration environment/);
});

test("Cognito password operations fail closed for global admins and cross-department identities", async () => {
  const guard = await readFile(new URL("../database/aws/039_cognito_password_global_scope.sql", import.meta.url), "utf8");
  const lifecycle = await readFile(new URL("../database/aws/006_cognito_lifecycle_state.sql", import.meta.url), "utf8");
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  const prepare = lifecycle.slice(
    lifecycle.indexOf("create or replace function tracepoint_auth.prepare_cognito_password_operation"),
    lifecycle.indexOf("create or replace function tracepoint_auth.finish_cognito_password_operation"),
  );
  assert.match(prepare, /has_department_permission\(p_department_id,'manage_users'\)/);
  assert.match(prepare, /m\.department_id=p_department_id and m\.is_active and m\.user_id=p_target_user_id/);
  assert.match(guard, /before insert on public\.authentication_lifecycle_operations/);
  assert.match(guard, /new\.operation_kind in \('assign_password','reset_password'\)/);
  assert.match(guard, /public\.platform_admins administrator[\s\S]*administrator\.is_active/);
  assert.match(guard, /public\.department_memberships membership[\s\S]*membership\.department_id <> new\.department_id/);
  assert.match(guard, /password operation target is a platform administrator/);
  assert.match(guard, /password operation target has another department membership/);
  assert.match(guard, /pg_advisory_xact_lock\(hashtextextended\(new\.tracepoint_user_id::text, 0\)\)/);
  assert.match(guard, /guard_cognito_scope_membership_write[\s\S]*operation\.state <> 'committed'[\s\S]*operation\.department_id <> new\.department_id/);
  assert.match(guard, /guard_cognito_scope_platform_admin_write[\s\S]*operation\.state <> 'committed'/);
  assert.match(guard, /before insert or update on public\.department_memberships/);
  assert.match(guard, /before insert or update on public\.platform_admins/);
  const passwordGuard = guard.slice(guard.indexOf("function tracepoint_auth.guard_cognito_password_global_scope"), guard.indexOf("function tracepoint_auth.guard_cognito_scope_membership_write"));
  const membershipGuard = guard.slice(guard.indexOf("function tracepoint_auth.guard_cognito_scope_membership_write"), guard.indexOf("function tracepoint_auth.guard_cognito_scope_platform_admin_write"));
  const platformAdminGuard = guard.slice(guard.indexOf("function tracepoint_auth.guard_cognito_scope_platform_admin_write"), guard.indexOf("revoke all on function"));
  assert.ok(passwordGuard.indexOf("pg_advisory_xact_lock") < passwordGuard.indexOf("from public.department_memberships"));
  assert.ok(membershipGuard.indexOf("pg_advisory_xact_lock") < membershipGuard.indexOf("from public.authentication_lifecycle_operations"));
  assert.ok(platformAdminGuard.indexOf("pg_advisory_xact_lock") < platformAdminGuard.indexOf("from public.authentication_lifecycle_operations"));
  const integration = await readFile(new URL("../src/lib/authentication/cognito-password-scope.test.ts", import.meta.url), "utf8");
  assert.match(integration, /scope-write-first serializes and denies password preparation/);
  assert.match(integration, /operation-first serializes and denies a new department membership/);
  assert.match(integration, /compensation_required and release after commit/);
  const inspection = await readFile(new URL("./aws-native-migration-inspection.mjs", import.meta.url), "utf8");
  assert.match(inspection, /\[39, \[routine\("tracepoint_auth\.guard_cognito_password_global_scope"\)/);
  assert.match(inspection, /\[39,[\s\S]*trigger\("public\.authentication_lifecycle_operations\.authentication_lifecycle_password_global_scope"\)/);
  assert.match(inspectionCatalogQueries.find(([name]) => name === "triggers")?.[1] ?? "", /pg_trigger/);
  assert.ok(migrationInspectionManifest.some(({ version }) => version === 39));
  assert.match(runner, /pending\.length !== 2[\s\S]*pending\[0\]\?\.version !== 38[\s\S]*pending\[1\]\?\.version !== 39/);
});
test("mobile preflight separates immutable pre-039 evidence from the 039 release gate", async () => {
  const preflight = await readFile(new URL("./verify-production-mobile-preflight.ps1", import.meta.url), "utf8");
  assert.match(preflight, /\$pre039InspectorCommit = 'b22eba426de42417931184ea3a25aebcf81cf3d7'/);
  assert.match(preflight, /ReleaseReady' -and \[string\]::IsNullOrWhiteSpace\(\$ExpectedProductionMobileClientId\)/);
  assert.match(preflight, /immutable b22 inspector is accepted only for exact pre-039 evidence through version 038/);
  assert.match(preflight, /candidate inspector prerequisite phase requires exact 001-038 applied and only 039 pending/);
  assert.match(preflight, /ReleaseReady requires a candidate inspector that includes migration 039/);
  assert.match(preflight, /complete repository migration chain through version 039/);
  assert.match(preflight, /Dedicated production Cognito mobile client exists but its reviewed id was not supplied/);
});
test("inspection reports partial lineage without adopting absent migrations", () => {
  const result = classifyMigrationInspection({ relations: [], columns: [], routines: [{ schema: "tracepoint_auth", name: "subject_id" }], indexes: [], constraints: [], policies: [], privileges: [], roles: [], triggers: [] });
  assert.equal(result.migrations[0].status, "partial");
  assert.equal(result.highestContiguousVersion, 0);
  assert.ok(result.missingPhaseAObjects.length > 0);
  assert.match(result.recommendation, /Do not adopt/);
});

test("Range Day hotfix is isolated from the ledger and missing 023–037 lineage", async () => {
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  const migration = await readFile(new URL("../database/aws/038_range_workspace_authenticated_writes.sql", import.meta.url), "utf8");
  assert.match(runner, /action === "range-workspace-hotfix"/);
  assert.match(runner, /Range workspace hotfix is production-only/);
  assert.match(runner, /assertRangeWorkspaceContract\(before, \["SELECT"\]\)/);
  assert.match(runner, /assertRangeWorkspaceContract\(after, \["INSERT", "SELECT", "UPDATE"\]\)/);
  assert.match(runner, /pilot_range_workspaces_accountability_audit/);
  const hotfixBody = runner.slice(runner.indexOf("async function applyRangeWorkspaceHotfix"), runner.indexOf("let files;"));
  assert.doesNotMatch(hotfixBody, /ensureLedger|withLock|migrationSqlWithLedgerEntry|tracepoint_aws_schema_migrations/);
  assert.match(migration, /grant insert, update on public\.pilot_range_workspaces to authenticated;/);
  assert.doesNotMatch(migration, /\b(delete|create|alter|drop|revoke)\b/i);
  for (let version = 23; version <= 37; version += 1) {
    const file = (await readdir(new URL("../database/aws/", import.meta.url))).find(name => name.startsWith(`${String(version).padStart(3, "0")}_`));
    assert.ok(file, `migration ${version}`);
    assert.doesNotMatch(await readFile(new URL(`../database/aws/${file}`, import.meta.url), "utf8"), /pilot_range_workspaces/);
  }
});

test("migration tasks use the distroless numeric nonroot runtime contract and report pre-start failures", async () => {
  const migrationTask = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  assert.match(migrationTask, /function Set-MigrationTaskContainerUser/);
  assert.match(migrationTask, /NotePropertyValue '65532'/);
  assert.match(migrationTask, /\$user\.Value = '65532'/);
  assert.match(migrationTask, /function Set-MigrationTaskContainerEntryPoint/);
  assert.match(migrationTask, /Add-Member -NotePropertyName entryPoint -NotePropertyValue @\('\/nodejs\/bin\/node'\)/);
  assert.match(migrationTask, /\$entryPoint\.Value = @\('\/nodejs\/bin\/node'\)/);
  assert.doesNotMatch(migrationTask, /entryPoint\.Value = @\('node'\)/);
  assert.match(migrationTask, /function Get-MigrationTaskFailureDetails/);
  assert.match(migrationTask, /function Get-ReportedValue/);
  assert.match(migrationTask, /Get-OptionalPropertyValue \$container 'exitCode'/);
  assert.doesNotMatch(migrationTask, /\?\?/);
  assert.match(migrationTask, /stop code \$\(\$failure\.StopCode\); stopped reason \$\(\$failure\.StoppedReason\); container reason \$\(\$failure\.ContainerReason\); exit code \$\(\$failure\.ExitCode\)/);
});

test("migration archives select the environment Dockerfile and include its validation dependencies", async () => {
  const archiveRunner = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  const environments = [
    {
      name: "staging",
      dockerfile: "../Dockerfile",
      manifest: /\$paths = @[^\n]*'scripts'[^\n]*'infra\/lib\/production-target\.ts'[^\n]*'Dockerfile'[^\n]*'buildspec\.staging-image\.yml'/,
      validationScripts: ["scripts/run-application-tests.mjs", "scripts/aws-native-migrations.test.mjs"],
    },
    {
      name: "production",
      dockerfile: "../Dockerfile.aws-native-production",
      manifest: /if \(\$Environment -eq 'production'\) \{ \$paths = @[^\n]*'scripts'[^\n]*'infra\/lib\/production-target\.ts'[^\n]*'Dockerfile\.aws-native-production'[^\n]*'buildspec\.production-image\.yml'/,
      validationScripts: ["scripts/assert-production-lint-ratchet.mjs", "scripts/run-application-tests.mjs", "scripts/aws-native-migrations.test.mjs"],
    },
  ];

  for (const environment of environments) assert.match(archiveRunner, environment.manifest, `${environment.name} archive contract`);

  const currentArchiveDockerfiles = [];
  for (const environment of environments) {
    try {
      currentArchiveDockerfiles.push({ environment, dockerfile: await readFile(new URL(environment.dockerfile, import.meta.url), "utf8") });
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }

  assert.ok(currentArchiveDockerfiles.length > 0, "the current migration archive must include its environment Dockerfile");
  for (const { environment, dockerfile } of currentArchiveDockerfiles) {
    for (const script of environment.validationScripts) assert.match(dockerfile, new RegExp(script.replaceAll(".", "\\.")));
  }

  await assertArchivedScriptImportClosure({
    root: path.resolve(import.meta.dirname, ".."),
    archivePaths: ["scripts", "src", "infra/lib/production-target.ts"],
    validationScripts: environments.flatMap(environment => environment.validationScripts),
  });
});

test("final migration stages contain the recursive local runtime dependency closure", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  for (const environment of await activeRuntimeDockerfiles(root)) {
    await assertFinalMigrationRuntimeClosure({ root, dockerfilePath: environment.dockerfilePath });
  }
});
