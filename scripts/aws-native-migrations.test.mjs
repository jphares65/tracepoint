import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { assertDatabaseTargetIdentity, assertExpectedDatabaseHost, assertInspectionSql, classifyMigrationInspection, inspectMigrationLedgerEvidence, inspectionCatalogQueries, inspectionSearchPathSql, inspectionTargetIdentitySql, migrationInspectionManifest, migrationLedgerDiscoverySql, awsNativeMigrationLedgerSql, importedAwsMigrationLedgerSql, migrationLedgerTransactionSql, mobileApiDependenciesSql } from "./aws-native-migration-inspection.mjs";
import { localPostgresPort } from "../src/test-support/local-postgres-port.mjs";
import { mobilePreflightFailureDetails } from "./aws-native-mobile-preflight-diagnostics.mjs";
import { applyAgencyDocumentsUnit, applyInventoryUnit, applyPasswordScopeResolutionUnit, liveOwnerActions, liveReleaseUnits, liveUnitReadiness, normalizedSha256, parsePasswordScopeResolutions, runAtomicLiveUnit, runLivePrecheck, selectUnitFiles, transactionBody } from "./aws-native-live-release-units.mjs";

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
  assert.match(runner, /requireStagingReleaseMigrations/);
  assert.match(runner, /STAGING_RELEASE_PENDING_INVALID/);
  assert.match(runner, /STAGING_RELEASE_LEDGER_GAP/);
  assert.match(runner, /requestedEnvironment === "production"/);
  assert.match(runner, /verifyProductionLedgerAdoptionAnchor/);
  assert.match(runner, /file\.version <= productionLedgerAdoptionVersions\.last/);
  assert.match(runner, /043_range_workspace_authenticated_writes\.sql/);
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

test("status and inspect reuse the scanned application image and dispatch only to read-only runner paths", async () => {
  const publisher = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  const resolver = publisher.slice(publisher.indexOf("function Resolve-ApplicationInspectionImage"), publisher.indexOf("function Publish-MigrationImage"));
  assert.match(resolver, /\$tag = "\$Commit-aws-native-\$Environment"/);
  assert.match(resolver, /refusing to build an image for \$Action/);
  assert.match(resolver, /Wait-MigrationImageScan -Digest/);
  assert.doesNotMatch(resolver, /codebuild|s3api|start-build|put-object|git\.exe|'ecs'/);
  assert.match(publisher, /\$Action -in \(@\('status','inspect'\) \+ \$liveOwnerActions\)\) \{ Resolve-ApplicationInspectionImage/);
  assert.match(publisher, /else \{ Publish-MigrationImage -Commit \$Commit/);
  assert.doesNotMatch(publisher, /update-service|delete-service|update-cluster/);

  assert.match(runner, /if \(action === "status"\) \{\s*console\.log\(JSON\.stringify\(await report\(client, files\)\)\);\s*\} else if \(action === "inspect"\) \{\s*console\.log\(JSON\.stringify\(await inspect\(client\)\)\);/);
  assert.match(runner, /action === "range-workspace-hotfix"\) \{[\s\S]*?\} else await withLock\(/);
  const reportPath = runner.slice(runner.indexOf("async function ledgerRows"), runner.indexOf("async function verifyBaselineAnchor"));
  const inspectPath = runner.slice(runner.indexOf("async function inspect("), runner.indexOf("async function mobilePreflight"));
  for (const body of [reportPath, inspectPath]) {
    assert.ok(body.length > 0);
    assert.doesNotMatch(body, /\b(insert|update|delete|create|alter|drop|grant|truncate)\b|ensureLedger|withLock|migrationSqlWithLedgerEntry|pg_advisory/i);
  }
  assert.match(inspectPath, /BEGIN TRANSACTION READ ONLY/);
  assert.match(inspectPath, /assertInspectionSql\(sql\); snapshot\[section\]/);
});

test("production inspect is pinned to the live final-cutover database through the running service's runtime credential", async () => {
  const publisher = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  const production = publisher.split("\n").find(line => line.trimStart().startsWith("production = @{"));
  assert.match(production, /LiveDatabaseInstance='tracepoint-production-final-cutover-20260926'/);
  assert.match(production, /LiveDatabaseHost='tracepoint-production-final-cutover-20260926\.c8r4sgs089tu\.us-east-1\.rds\.amazonaws\.com'/);
  assert.match(production, /LiveDatabaseSecretArn='arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint\/production\/final\/database-runtime-20260926-yg23sb'/);
  assert.match(production, /LiveInspectionFamily='tracepoint-production-live-database-inspect'/);
  // status, apply, and publish-only keep the existing owner credential and bootstrap source.
  assert.match(production, /MigrationTaskDefinition='tracepoint-production-database-bootstrap:3'; MigratorSecretArn='[^']*migrator-8X57JT'/);
  const staging = publisher.split("\n").find(line => line.trimStart().startsWith("staging = @{"));
  assert.doesNotMatch(staging, /Live/);
  assert.match(publisher, /\$liveInspection = \$Action -eq 'inspect' -and \$settings\.ContainsKey\('LiveDatabaseInstance'\)/);
  assert.match(publisher, /if \(\$liveInspection\) \{ \$service\.taskDefinition \}/);
  assert.match(publisher, /if \(\$settings\.MigratorSecretArn -and -not \$liveInspection\)/);
  const liveCheck = publisher.slice(publisher.indexOf("function Assert-LiveInspectionTarget"), publisher.indexOf("function Publish-MigrationImage"));
  assert.match(liveCheck, /valueFrom -cne \$settings\.LiveDatabaseSecretArn/);
  assert.match(liveCheck, /'rds','describe-db-instances','--db-instance-identifier',\$settings\.LiveDatabaseInstance/);
  assert.match(liveCheck, /Endpoint\.Address -cne \$settings\.LiveDatabaseHost/);
  assert.match(production, /LiveDatabaseSecretVersionId='5edc21b8-99f0-183c-a6e8-98f0809d0594'/);
  assert.match(liveCheck, /'secretsmanager','list-secret-version-ids','--secret-id',\$settings\.LiveDatabaseSecretArn,'--include-deprecated'/);
  assert.match(liveCheck, /\$versions\.Count -ne 1 -or \[string\]\$versions\[0\]\.VersionId -cne \$settings\.LiveDatabaseSecretVersionId/);
  // Metadata only: the workstation never reads a secret value.
  assert.doesNotMatch(publisher, /get-secret-value|GetSecretValue|SecretString/);
  assert.doesNotMatch(liveCheck, /'ecs'/);

  const connect = runner.slice(runner.indexOf("async function connect"), runner.indexOf("async function ledgerRows"));
  assert.match(connect, /action === "inspect" && process\.env\.TRACEPOINT_EXPECTED_DATABASE_HOST !== undefined/);
  assert.ok(connect.indexOf("assertExpectedDatabaseHost") < connect.indexOf("await client.connect()"));
  const inspectPath = runner.slice(runner.indexOf("async function inspect("), runner.indexOf("async function mobilePreflight"));
  assert.match(inspectPath, /client\.expectedRdsHostMatched === true[\s\S]*assertInspectionSql\(inspectionTargetIdentitySql\)[\s\S]*assertDatabaseTargetIdentity\(identity\)/);
  assert.ok(inspectPath.indexOf("inspectionSearchPathSql);") < inspectPath.indexOf("inspectionTargetIdentitySql"));
  assert.doesNotThrow(() => assertInspectionSql(inspectionTargetIdentitySql));
  const live = { database_name: "tracepoint", server_address: "10.0.0.1/32", server_port: 5432, database_user: "tracepoint_runtime", session_user: "tracepoint_runtime", search_path: "pg_catalog", effective_schemas: ["pg_catalog"] };
  assert.equal(assertDatabaseTargetIdentity(live), true);
  for (const wrong of [{ database_user: "tracepoint_migrator", session_user: "tracepoint_migrator" }, { database_name: "postgres" }, { server_port: 5433 }]) {
    assert.throws(() => assertDatabaseTargetIdentity({ ...live, ...wrong }), /DATABASE_TARGET_MISMATCH/);
  }
});

test("a host-pinned inspect fails closed before connecting when the credential targets another database", () => {
  const runnerPath = fileURLToPath(new URL("./run-aws-native-migrations.mjs", import.meta.url));
  const liveHost = "tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com";
  const run = (action, secretHost, expectedHost) => spawnSync(process.execPath, [runnerPath, action, "production"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      CONFIGURATION_ENVIRONMENT: "production",
      TRACEPOINT_DATA_PROVIDER: "postgres",
      TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native",
      TRACEPOINT_DATABASE_CA_PATH: "/app/tracepoint-test-absent-ca.pem",
      TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ host: secretHost, port: 5432, dbname: "tracepoint", username: "tracepoint_runtime", password: "synthetic-inspection-password" }),
      ...(expectedHost === undefined ? {} : { TRACEPOINT_EXPECTED_DATABASE_HOST: expectedHost }),
    },
  });
  for (const [secretHost, expectedHost] of [
    ["tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com", liveHost],
    [liveHost, ""],
    [liveHost, "tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com"],
  ]) {
    const result = run("inspect", secretHost, expectedHost);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATABASE_TARGET_MISMATCH/);
    assert.doesNotMatch(result.stderr, /synthetic-inspection-password/);
  }
  // A matching host passes the pin and stops at the absent CA, before any connection.
  const matched = run("inspect", liveHost, `${liveHost.toUpperCase()}.`);
  assert.notEqual(matched.status, 0);
  assert.doesNotMatch(matched.stderr, /DATABASE_TARGET_MISMATCH/);
  assert.match(matched.stderr, /ENOENT/);
  // status is unchanged: it does not read the inspect host pin.
  const status = run("status", "tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com", liveHost);
  assert.doesNotMatch(status.stderr, /DATABASE_TARGET_MISMATCH/);
  assert.match(status.stderr, /ENOENT/);
});

test("live release units pin the exact repository migration files and route only through guarded owner actions", async () => {
  const directory = path.resolve(import.meta.dirname, "../database/aws");
  for (const pins of Object.values(liveReleaseUnits)) {
    for (const pin of pins) assert.equal(normalizedSha256(await readFile(path.join(directory, pin.filename), "utf8")), pin.sha256, pin.filename);
  }
  assert.deepEqual(liveOwnerActions, ["precheck", "inventory-035-037", "password-scope-039-040", "agency-documents-038-048"]);
  assert.deepEqual(liveReleaseUnits["inventory-035-037"].map(file => file.version), [35, 36, 37]);
  assert.deepEqual(liveReleaseUnits["password-scope-039-040"].map(file => file.version), [44, 45]);
  // 042 (default module entitlements) would enable every module for every production agency: no unit may include it.
  assert.deepEqual(liveReleaseUnits["agency-documents-038-048"].map(file => file.version), [38, 39, 40, 41, 46, 47, 48]);
  for (const pins of Object.values(liveReleaseUnits)) assert.ok(pins.every(pin => pin.version !== 42));
  const files = [{ version: 35, filename: "035_inventory_phase1.sql", contents: "begin;\nselect 1;\ncommit;\n" }];
  assert.throws(() => selectUnitFiles("inventory-035-037", files), /LIVE_RELEASE_UNIT_FILE_MISMATCH: 035_inventory_phase1\.sql/);
  assert.throws(() => selectUnitFiles("apply", files), /LIVE_RELEASE_UNIT_UNKNOWN/);

  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  assert.match(runner, /liveOwnerActions\.includes\(action\) && requestedEnvironment !== "production"\) throw/);
  const connect = runner.slice(runner.indexOf("async function connect"), runner.indexOf("async function ledgerRows"));
  assert.match(connect, /secret\.username !== "tracepoint_migrator"\) throw new Error\("LIVE_OWNER_CREDENTIAL_MISMATCH"\)/);
  assert.match(connect, /host = pinnedHost/);
  assert.match(connect, /servername: host/);
  assert.match(runner, /action === "precheck"\) \{\s*console\.log\(JSON\.stringify\(await runLivePrecheck\(client\)\)\);/);
  assert.match(runner, /action === "inventory-035-037"\) \{\s*console\.log\(JSON\.stringify\(await withLock\(client, \(\) => applyInventoryUnit\(client, files\)\)\)\);/);
  assert.match(runner, /action === "password-scope-039-040"\) \{\s*console\.log\(JSON\.stringify\(await withLock\(client, \(\) => applyPasswordScopeResolutionUnit\(client, files, passwordScopeResolutions\)\)\)\);/);
  assert.match(runner, /action === "agency-documents-038-048"\) \{\s*console\.log\(JSON\.stringify\(await withLock\(client, \(\) => applyAgencyDocumentsUnit\(client, files\)\)\)\);/);
  const units = await readFile(new URL("./aws-native-live-release-units.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(units, /insert into public\.tracepoint_aws_schema_migrations|ensureLedger/);

  const publisher = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  assert.match(publisher, /\$liveOwnerActions -and \$Environment -ne 'production'\) \{ throw 'Live final-database actions are production-only\.' \}/);
  assert.match(publisher, /\$liveDatabaseChangeActions -and -not \$AuthorizeLiveDatabaseChange\) \{ throw/);
  assert.match(publisher, /\$liveDatabaseChangeActions = @\('inventory-035-037','password-scope-039-040','agency-documents-038-048'\)/);
  // Each image build archives only its own Dockerfile, so the required set
  // follows the build environment. A required Dockerfile that is missing
  // fails the read below; it is never skipped.
  const deployScript = await readFile(new URL("./deploy-app.ps1", import.meta.url), "utf8");
  // -PublishOnly publishes the image the live units run from, and stops before any task definition or ECS change.
  const publishOnlyExit = deployScript.indexOf("if ($PublishOnly) {");
  assert.ok(publishOnlyExit > deployScript.indexOf("$image = Publish-Image -Commit $commit -ImageTag $imageTag"));
  assert.ok(publishOnlyExit < deployScript.indexOf("$registered = Register-ApplicationTaskRevision"));
  assert.match(deployScript.slice(publishOnlyExit, publishOnlyExit + 220), /IMAGE PUBLISHED - ECS unchanged[\s\S]*exit 0/);
  assert.match(deployScript, /if \(\$PublishOnly -and \$RollbackTaskDefinitionArn\) \{ throw/);
  assert.match(deployScript, /if \(\$Environment -eq 'staging'\) \{ \$archivePaths \+= @\('Dockerfile', 'buildspec\.staging-image\.yml'\) \}/);
  assert.match(deployScript, /else \{ \$archivePaths \+= @\('Dockerfile\.aws-native-production', 'buildspec\.production-image\.yml'\) \}/);
  const requiredDockerfiles = {
    production: ["Dockerfile.aws-native-production"],
    staging: ["Dockerfile"],
  }[process.env.TRACEPOINT_MIGRATION_TEST_ENVIRONMENT] ?? ["Dockerfile", "Dockerfile.aws-native-production"];
  for (const filename of requiredDockerfiles) {
    const dockerfile = await readFile(path.resolve(import.meta.dirname, "..", filename), "utf8");
    assert.match(dockerfile, /COPY --from=builder --chown=nonroot:nonroot \/app\/scripts\/aws-native-live-release-units\.mjs \.\/scripts\/aws-native-live-release-units\.mjs/, filename);
  }
});

test("live owner actions refuse staging, a non-owner credential, and a missing host pin before connecting", () => {
  const runnerPath = fileURLToPath(new URL("./run-aws-native-migrations.mjs", import.meta.url));
  const liveHost = "tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com";
  let resolutions = "";
  const run = (action, environment, username, expectedHost) => spawnSync(process.execPath, [runnerPath, action, environment], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      CONFIGURATION_ENVIRONMENT: environment,
      TRACEPOINT_DATA_PROVIDER: "postgres",
      TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native",
      TRACEPOINT_DATABASE_CA_PATH: "/app/tracepoint-test-absent-ca.pem",
      TRACEPOINT_DATABASE_SECRET_JSON: JSON.stringify({ host: "tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com", port: 5432, dbname: "tracepoint", username, password: "synthetic-owner-password" }),
      ...(expectedHost === undefined ? {} : { TRACEPOINT_EXPECTED_DATABASE_HOST: expectedHost }),
      TRACEPOINT_PASSWORD_SCOPE_RESOLUTIONS: resolutions,
    },
  });
  // The reviewed resolution list is required, and validated, before any connection.
  resolutions = "";
  const unlisted = run("password-scope-039-040", "production", "tracepoint_migrator", liveHost);
  assert.notEqual(unlisted.status, 0);
  assert.match(unlisted.stderr, /PASSWORD_SCOPE_RESOLUTIONS_INVALID/);
  assert.doesNotMatch(unlisted.stderr, /ENOENT/);
  resolutions = JSON.stringify([{ operation_id: "10000000-0000-0000-0000-000000000001", operation_kind: "reset_password", safe_error_code: "recovery_unavailable",
    basis: "The reset was refused by the readiness check before any Cognito write.",
    evidence: { cognito_writes_by_operation: "none", cloudtrail_window: "AdminGetUser only", code_path: "readiness check before writes" } }]);
  for (const action of liveOwnerActions) {
    const staging = run(action, "staging", "tracepoint_migrator", liveHost);
    assert.notEqual(staging.status, 0);
    assert.match(staging.stderr, /production-only/);
    for (const expectedHost of [undefined, ""]) {
      const unpinned = run(action, "production", "tracepoint_migrator", expectedHost);
      assert.notEqual(unpinned.status, 0);
      assert.match(unpinned.stderr, /DATABASE_TARGET_MISMATCH/);
    }
    const runtime = run(action, "production", "tracepoint_runtime", liveHost);
    assert.notEqual(runtime.status, 0);
    assert.match(runtime.stderr, /LIVE_OWNER_CREDENTIAL_MISMATCH/);
    // A pinned owner credential passes those gates and stops at the absent CA, before any connection.
    const pinned = run(action, "production", "tracepoint_migrator", liveHost);
    assert.notEqual(pinned.status, 0);
    assert.doesNotMatch(pinned.stderr, /DATABASE_TARGET_MISMATCH|LIVE_OWNER_CREDENTIAL_MISMATCH/);
    assert.match(pinned.stderr, /ENOENT/);
    assert.doesNotMatch(pinned.stderr + runtime.stderr, /synthetic-owner-password/);
  }
});

test("embedded Postgres applies the inventory and password-scope units atomically with fail-closed gates", { timeout: 180_000 }, async () => {
  let server;
  let owner;
  let runtime;
  let directory;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "tp-live-release-units-"));
    const port = await localPostgresPort();
    server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-units-only", port, persistent: true,
      postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    const config = { host: "127.0.0.1", port };
    const admin = new pg.Client({ ...config, database: "postgres", user: "postgres", password: "local-units-only" });
    await admin.connect();
    await admin.query("CREATE DATABASE tracepoint");
    await admin.end();
    const superuser = new pg.Client({ ...config, database: "tracepoint", user: "postgres", password: "local-units-only" });
    await superuser.connect();
    await superuser.query(`
      create role authenticated nologin; create role anon nologin; create role service_role nologin;
      create role tracepoint_runtime login noinherit password 'runtime-local-only';
      grant authenticated to tracepoint_runtime;
      create role tracepoint_migrator login password 'owner-local-only';
      grant create on schema public to tracepoint_migrator;
      create schema tracepoint_auth authorization tracepoint_migrator;`);
    await superuser.end();
    owner = new pg.Client({ ...config, database: "tracepoint", user: "tracepoint_migrator", password: "owner-local-only" });
    await owner.connect();
    // The live prerequisites the units depend on, owned by the migrator as on the final instance.
    await owner.query(`
      create table public.departments(id uuid primary key);
      create table public.profiles(id uuid primary key, email text, full_name text);
      create table public.permissions(code text primary key, display_name text, description text);
      create table public.department_memberships(department_id uuid not null references public.departments(id), user_id uuid not null references public.profiles(id), is_active boolean not null default true);
      create table public.platform_admins(user_id uuid primary key references public.profiles(id), is_active boolean not null default true);
      create table public.authentication_lifecycle_operations(id uuid primary key, operation_kind text not null, tracepoint_user_id uuid not null references public.profiles(id),
        department_id uuid references public.departments(id), state text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
      create function tracepoint_auth.subject_id() returns uuid language sql stable as $$ select null::uuid $$;
      create function tracepoint_auth.department_id() returns uuid language sql stable as $$ select null::uuid $$;
      create function public.is_department_member(p_department_id uuid) returns boolean language sql stable as $$ select true $$;
      create function public.has_department_permission(p_department_id uuid, p_code text) returns boolean language sql stable as $$ select true $$;
      insert into public.departments values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
      insert into public.profiles(id) values ('00000000-0000-0000-0000-000000000001');
      insert into public.department_memberships(department_id, user_id) values
        ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000001');`);
    const options = { expectedPort: port };
    const migrationDirectory = path.resolve(import.meta.dirname, "../database/aws");
    const files = await Promise.all((await readdir(migrationDirectory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(async filename => ({
      version: Number(filename.slice(0, 3)), filename, contents: await readFile(path.join(migrationDirectory, filename), "utf8"),
    })));
    const inventoryTablePresent = async () => (await owner.query("select to_regclass('public.inventory_items') is not null as present")).rows[0].present;

    const precheck = await runLivePrecheck(owner, options);
    assert.equal(precheck.inspection, "read-only");
    assert.equal(precheck.identity.database_user, "tracepoint_migrator");
    assert.deepEqual({ inventory: precheck.readiness.inventory, passwordScope: precheck.readiness.passwordScope }, { inventory: { ready: true, blockers: [] }, passwordScope: { ready: true, blockers: [] } });
    // This database has no entitlement tables: the Agency Documents report says so instead of failing the precheck.
    assert.deepEqual(precheck.precheck.agency_documents, { entitlement_tables_present: false, prerequisite_tables_present: false });
    assert.deepEqual(precheck.readiness.agencyDocuments.blockers, ["agency_documents_prerequisite_tables_missing"]);
    assert.equal(precheck.precheck.multi_agency_users_any, 1);
    assert.equal(precheck.precheck.unresolved_password_operation_users, 0);
    assert.deepEqual(precheck.precheck.inventory_tables_present, []);

    runtime = new pg.Client({ ...config, database: "tracepoint", user: "tracepoint_runtime", password: "runtime-local-only" });
    await runtime.connect();
    await assert.rejects(runLivePrecheck(runtime, options), /LIVE_OWNER_IDENTITY_MISMATCH/);
    await assert.rejects(runLivePrecheck(owner), /LIVE_OWNER_IDENTITY_MISMATCH/);

    // A failed postcondition rolls the whole unit back.
    const [inventory035] = selectUnitFiles("inventory-035-037", files);
    await assert.rejects(runAtomicLiveUnit(owner, [inventory035.body], "select 1 as checked", () => { throw new Error("FORCED_POSTCONDITION_FAILURE"); }), /FORCED_POSTCONDITION_FAILURE/);
    assert.equal(await inventoryTablePresent(), false);
    assert.equal((await owner.query("select count(*)::int as total from public.permissions")).rows[0].total, 0);

    const inventory = await applyInventoryUnit(owner, files, options);
    assert.equal(inventory.status, "APPLIED");
    assert.equal(inventory.ledger_modified, false);
    assert.deepEqual(inventory.files.map(file => file.version), [35, 36, 37]);
    assert.equal(inventory.postconditions.tables_present, 6);
    assert.equal(inventory.postconditions.tables_with_rls, 6);
    assert.equal(inventory.postconditions.unexpected_role_privileges, 0);
    assert.equal(await inventoryTablePresent(), true);
    assert.equal((await owner.query("select to_regclass('public.tracepoint_aws_schema_migrations') is null as absent")).rows[0].absent, true);
    await assert.rejects(applyInventoryUnit(owner, files, options), /LIVE_RELEASE_UNIT_PRECONDITION_FAILED: inventory_tables_already_present/);

  } finally {
    await runtime?.end().catch(() => undefined);
    await owner?.end().catch(() => undefined);
    await server?.stop().catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("live unit readiness reports every blocker instead of guessing", () => {
  const clean = { inventory_tables_present: [], permissions_code_unique: true, permissions_writable: true, public_schema_create: true, inventory_prerequisites_present: true,
    password_scope_functions_present: 0, password_scope_triggers_present: 0, password_scope_tables_present: 3, password_scope_tables_owned: true, tracepoint_auth_schema_create: true, password_operation_resolutions_present: false, unresolved_password_operation_users: 2 };
  const { inventory, passwordScope, agencyDocuments } = liveUnitReadiness(clean);
  assert.deepEqual({ inventory, passwordScope }, { inventory: { ready: true, blockers: [] }, passwordScope: { ready: true, blockers: [] } });
  // Without the Agency Documents report the unit is never ready.
  assert.equal(agencyDocuments.ready, false);
  const blocked = liveUnitReadiness({ ...clean, inventory_tables_present: ["inventory_items"], permissions_code_unique: false, password_scope_tables_owned: false, password_operation_resolutions_present: true });
  assert.deepEqual(blocked.inventory.blockers, ["inventory_tables_already_present", "permissions_code_not_unique"]);
  assert.deepEqual(blocked.passwordScope.blockers, ["password_scope_tables_not_owned", "password_operation_resolutions_already_present"]);
});

const departmentA = "00000000-0000-0000-0000-00000000000a";
const departmentB = "00000000-0000-0000-0000-00000000000b";
const scopeUser = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const scopeOperation = n => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const reviewedEvidence = {
  cognito_writes_by_operation: "none",
  cloudtrail_window: "the failure second shows AdminGetUser only",
  code_path: "assertCognitoPasswordResetReady refuses before globalSignOut and beginPasswordReset",
  known_side_effects: ["tracepoint_sessions_revoked_at_prepare"],
};
const reviewedResolution = (n, code) => ({
  operation_id: scopeOperation(n), operation_kind: "reset_password", safe_error_code: code,
  basis: "The reset was refused by the readiness check before any Cognito write.", evidence: reviewedEvidence,
});

// The 006 lifecycle tables and finish function exactly as the live database
// has them, plus minimal companions for the success path and the 039 guards.
async function createScopeFixture(admin, config, database) {
  await admin.query(`CREATE DATABASE ${database}`);
  const superuser = new pg.Client({ ...config, database, user: "postgres", password: "local-scope-only" });
  await superuser.connect();
  await superuser.query(`grant create on schema public to tracepoint_migrator;
    create schema tracepoint_auth authorization tracepoint_migrator;
    grant usage on schema public to tracepoint_runtime;
    grant usage on schema tracepoint_auth to tracepoint_runtime;`);
  await superuser.end();
  const owner = new pg.Client({ ...config, database, user: "tracepoint_migrator", password: "owner-scope-only" });
  await owner.connect();
  const source006 = (await readFile(new URL("../database/aws/006_cognito_lifecycle_state.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const slice = (start, end) => { const from = source006.indexOf(start); const to = source006.indexOf(end, from); assert.ok(from >= 0 && to > from, start); return source006.slice(from, to + end.length); };
  await owner.query(`
    create table public.departments(id uuid primary key);
    create table public.profiles(id uuid primary key, email text, full_name text);
    create table public.department_memberships(department_id uuid not null references public.departments(id), user_id uuid not null references public.profiles(id),
      is_active boolean not null default true, activation_status text);
    create table public.platform_admins(user_id uuid primary key references public.profiles(id), is_active boolean not null default true);
    create table public.authentication_identity_links(provider text not null, issuer text not null, subject text not null, tracepoint_user_id uuid not null references public.profiles(id),
      state text not null default 'pending', provider_username text, updated_at timestamptz not null default now(), primary key(provider, issuer, subject));
    create table public.user_activation_tokens(id uuid primary key default gen_random_uuid(), department_id uuid, user_id uuid, used_at timestamptz, revoked_at timestamptz);
    create table public.audit_events(id bigint generated always as identity primary key, department_id uuid not null references public.departments(id), actor_user_id uuid,
      action text not null, entity_type text not null, entity_id uuid, summary text, previous_value jsonb, new_value jsonb, created_at timestamptz not null default now());
    ${slice("create table if not exists public.authentication_identity_events (", "\n);")}
    ${slice("create table if not exists public.authentication_lifecycle_operations (", "\n);")}
    ${slice("create or replace function tracepoint_auth.finish_cognito_password_operation(", "end;$$;")}
    ${slice("revoke all on function tracepoint_auth.finish_cognito_password_operation(uuid,boolean,text)", ";")}
    ${slice("grant execute on function tracepoint_auth.finish_cognito_password_operation(uuid,boolean,text)", ";")}
    insert into public.departments values ('${departmentA}'), ('${departmentB}');
    insert into public.profiles(id, email) select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'user' || n || '@example.test' from generate_series(1, 9) n;
    insert into public.department_memberships(department_id, user_id) select '${departmentA}', ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 9) n;
    insert into public.platform_admins values ('${scopeUser(5)}', true);
    insert into public.authentication_identity_links(provider, issuer, subject, tracepoint_user_id, state, provider_username)
      select 'cognito', 'issuer', 'subject-' || n, ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'active', 'provider-' || n from generate_series(1, 9) n;
    -- The two historical reset refusals, and a later committed assignment for the first user.
    insert into public.authentication_lifecycle_operations(id, operation_kind, tracepoint_user_id, department_id, state, attempts, safe_error_code, created_at, updated_at) values
      ('${scopeOperation(1)}', 'reset_password', '${scopeUser(1)}', '${departmentA}', 'compensation_required', 1, 'recovery_unavailable', '2026-09-29T17:06:55.902Z', '2026-09-29T17:06:56.153Z'),
      ('${scopeOperation(2)}', 'reset_password', '${scopeUser(2)}', '${departmentA}', 'compensation_required', 1, 'initial_password_required', '2026-10-05T13:31:52.940Z', '2026-10-05T13:31:53.121Z'),
      ('${scopeOperation(3)}', 'assign_password', '${scopeUser(1)}', '${departmentA}', 'committed', 1, null, '2026-09-29T17:08:49Z', '2026-09-29T17:08:49Z');`);
  return owner;
}

const scopeObjectsState = async client => (await client.query(`select
  to_regclass('public.authentication_lifecycle_resolutions') is not null as resolutions_table,
  (select count(*)::int from pg_trigger where not tgisinternal and tgname like '%password_scope%') as scope_triggers,
  (select string_agg(pg_get_function_identity_arguments(p.oid), ' | ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tracepoint_auth' and p.proname = 'finish_cognito_password_operation') as finish_arguments,
  (select count(*)::int from public.audit_events where action = 'password_operation_resolved') as resolution_audit_rows`)).rows[0];

test("embedded Postgres applies 039 and 040 with reviewed resolutions atomically and keeps scope protections", { timeout: 240_000 }, async () => {
  let server; let admin; let directory; const clients = [];
  try {
    directory = await mkdtemp(path.join(tmpdir(), "tp-password-scope-"));
    const port = await localPostgresPort();
    server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-scope-only", port, persistent: true,
      postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    const config = { host: "127.0.0.1", port };
    admin = new pg.Client({ ...config, database: "postgres", user: "postgres", password: "local-scope-only" });
    await admin.connect();
    await admin.query(`create role authenticated nologin; create role anon nologin; create role service_role nologin;
      create role tracepoint_runtime login noinherit password 'runtime-scope-only'; grant authenticated to tracepoint_runtime;
      create role tracepoint_migrator login password 'owner-scope-only';`);
    const optionsFor = database => ({ expectedPort: port, expectedDatabase: database });
    const migrationDirectory = path.resolve(import.meta.dirname, "../database/aws");
    const files = await Promise.all((await readdir(migrationDirectory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(async filename => ({
      version: Number(filename.slice(0, 3)), filename, contents: await readFile(path.join(migrationDirectory, filename), "utf8"),
    })));
    const connect = async (database, user, password) => { const client = new pg.Client({ ...config, database, user, password }); await client.connect(); clients.push(client); return client; };

    // Before 040: the original three-argument finish works and the four-argument form is absent.
    const compatibility = await createScopeFixture(admin, config, "scope_compat"); clients.push(compatibility);
    await compatibility.query(`insert into public.authentication_lifecycle_operations(id, operation_kind, tracepoint_user_id, department_id, state) values ('${scopeOperation(20)}', 'reset_password', '${scopeUser(4)}', '${departmentA}', 'prepared')`);
    const runtimeBefore = await connect("scope_compat", "tracepoint_runtime", "runtime-scope-only");
    await assert.rejects(runtimeBefore.query("select tracepoint_auth.finish_cognito_password_operation($1,$2,$3,$4)", [scopeOperation(20), false, "initial_password_required", true]), error => error.code === "42883");
    await runtimeBefore.query("select tracepoint_auth.finish_cognito_password_operation($1,$2,$3)", [scopeOperation(20), false, "initial_password_required"]);
    assert.equal((await compatibility.query(`select state from public.authentication_lifecycle_operations where id = '${scopeOperation(20)}'`)).rows[0].state, "compensation_required");

    // Authorization mismatches, a failing step, or a failing postcondition leave the database unchanged.
    const rollback = await createScopeFixture(admin, config, "scope_rollback"); clients.push(rollback);
    const untouched = await scopeObjectsState(rollback);
    assert.deepEqual(untouched, { resolutions_table: false, scope_triggers: 0, finish_arguments: "p_operation_id uuid, p_succeeded boolean, p_error_code text", resolution_audit_rows: 0 });
    for (const [resolutions, expected] of [
      [[reviewedResolution(1, "recovery_unavailable")], /unauthorized_unresolved_operation/],
      [[reviewedResolution(1, "recovery_unavailable"), reviewedResolution(2, "initial_password_required"), reviewedResolution(9, "recovery_unavailable")], /authorized_operation_not_unresolved/],
      [[reviewedResolution(1, "initial_password_required"), reviewedResolution(2, "initial_password_required")], /operation_does_not_match_authorized_evidence/],
    ]) {
      await assert.rejects(applyPasswordScopeResolutionUnit(rollback, files, resolutions, optionsFor("scope_rollback")), expected);
      assert.deepEqual(await scopeObjectsState(rollback), untouched);
    }
    await rollback.query(`update public.authentication_lifecycle_operations set department_id = null where id = '${scopeOperation(2)}'`);
    await assert.rejects(applyPasswordScopeResolutionUnit(rollback, files, [reviewedResolution(1, "recovery_unavailable"), reviewedResolution(2, "initial_password_required")], optionsFor("scope_rollback")), error => error.code === "23502");
    assert.deepEqual(await scopeObjectsState(rollback), untouched);
    await rollback.query(`update public.authentication_lifecycle_operations set department_id = '${departmentA}' where id = '${scopeOperation(2)}'`);
    // Default privileges are neutralized by 040's explicit revokes, so they do not block the unit.
    await rollback.query("alter default privileges in schema public grant select on tables to anon");
    // A stray finish overload is not repaired by 040: the signature postcondition must roll back everything.
    await rollback.query("create function tracepoint_auth.finish_cognito_password_operation(p_operation_id text) returns void language sql as 'select null'");
    const withStrayOverload = await scopeObjectsState(rollback);
    await assert.rejects(applyPasswordScopeResolutionUnit(rollback, files, [reviewedResolution(1, "recovery_unavailable"), reviewedResolution(2, "initial_password_required")], optionsFor("scope_rollback")), /LIVE_PASSWORD_SCOPE_POSTCONDITION_FAILED: finish_overloads, finish_arguments/);
    assert.deepEqual(await scopeObjectsState(rollback), withStrayOverload);
    await rollback.query("drop function tracepoint_auth.finish_cognito_password_operation(text)");
    const appliedDespiteDefaults = await applyPasswordScopeResolutionUnit(rollback, files, [reviewedResolution(1, "recovery_unavailable"), reviewedResolution(2, "initial_password_required")], optionsFor("scope_rollback"));
    assert.equal(appliedDespiteDefaults.postconditions.resolutions_app_privileges, 0);

    // The reviewed unit applies 039, 040, and both resolutions together.
    const owner = await createScopeFixture(admin, config, "scope_live"); clients.push(owner);
    const originals = (await owner.query("select id::text, state, safe_error_code, attempts, updated_at from public.authentication_lifecycle_operations order by id")).rows;
    const precheck = await runLivePrecheck(owner, optionsFor("scope_live"));
    assert.equal(precheck.readiness.passwordScope.ready, true);
    assert.equal(precheck.precheck.unresolved_password_operation_users, 2);
    const applied = await applyPasswordScopeResolutionUnit(owner, files, [reviewedResolution(1, "recovery_unavailable"), reviewedResolution(2, "initial_password_required")], optionsFor("scope_live"));
    assert.equal(applied.status, "APPLIED");
    assert.equal(applied.resolved_operations, 2);
    assert.deepEqual(applied.files.map(file => file.version), [44, 45]);
    assert.equal(applied.postconditions.unresolved_remaining, 0);
    assert.deepEqual((await owner.query("select id::text, state, safe_error_code, attempts, updated_at from public.authentication_lifecycle_operations order by id")).rows, originals);
    const audit = (await owner.query(`select entity_id::text, previous_value, new_value from public.audit_events where action = 'password_operation_resolved' order by entity_id`)).rows;
    assert.deepEqual(audit.map(row => [row.entity_id, row.previous_value.state, row.previous_value.safe_error_code, row.new_value.source]), [
      [scopeOperation(1), "compensation_required", "recovery_unavailable", "owner_verified"],
      [scopeOperation(2), "compensation_required", "initial_password_required", "owner_verified"],
    ]);
    assert.deepEqual(audit[0].new_value.evidence.known_side_effects, ["tracepoint_sessions_revoked_at_prepare"]);
    const afterApply = await runLivePrecheck(owner, optionsFor("scope_live"));
    assert.deepEqual(afterApply.precheck.resolution_aware, { unresolved_password_operations: 0, unresolved_password_operation_users: 0, resolutions: 2, owner_verified_resolutions: 2 });
    assert.equal(afterApply.precheck.unresolved_password_operation_users, 2, "raw counts still show the historical failures");
    await assert.rejects(applyPasswordScopeResolutionUnit(owner, files, [], optionsFor("scope_live")), /password_scope_objects_already_present/);

    // Resolutions are append-only, owner-only, and resolve an operation at most once.
    for (const statement of [`update public.authentication_lifecycle_resolutions set basis = basis || ' edited'`, "delete from public.authentication_lifecycle_resolutions", "truncate public.authentication_lifecycle_resolutions"]) {
      await assert.rejects(owner.query(statement), error => error.code === "42501", statement);
    }
    await assert.rejects(owner.query("select tracepoint_auth.resolve_password_operation_provider_unchanged($1,'owner_verified',$2,$3::jsonb)",
      [scopeOperation(1), reviewedResolution(1, "x").basis, JSON.stringify(reviewedEvidence)]), error => error.code === "22023" || error.code === "23505");
    const runtime = await connect("scope_live", "tracepoint_runtime", "runtime-scope-only");
    await assert.rejects(runtime.query(`insert into public.authentication_lifecycle_resolutions(operation_id, resolution, resolution_source, basis, evidence) values ('${scopeOperation(3)}', 'provider_unchanged', 'owner_verified', 'An application role must never write a resolution.', '{}')`), error => error.code === "42501");
    for (const call of ["select tracepoint_auth.resolve_password_operation_provider_unchanged($1,'owner_verified','An application role must never resolve an operation.','{}'::jsonb)", "select tracepoint_auth.password_scope_hold_exists($1, null)"]) {
      await assert.rejects(runtime.query(call, [scopeOperation(1)]), error => error.code === "42501");
    }

    // Concurrent owner resolutions of one eligible operation: exactly one succeeds.
    await owner.query(`insert into public.authentication_lifecycle_operations(id, operation_kind, tracepoint_user_id, department_id, state, attempts, safe_error_code) values ('${scopeOperation(4)}', 'reset_password', '${scopeUser(4)}', '${departmentA}', 'compensation_required', 1, 'initial_password_required')`);
    const [first, second] = [await connect("scope_live", "tracepoint_migrator", "owner-scope-only"), await connect("scope_live", "tracepoint_migrator", "owner-scope-only")];
    const resolve = client => client.query("select tracepoint_auth.resolve_password_operation_provider_unchanged($1,'owner_verified',$2,$3::jsonb)", [scopeOperation(4), reviewedResolution(4, "initial_password_required").basis, JSON.stringify(reviewedEvidence)]);
    await first.query("begin");
    await resolve(first);
    const racing = resolve(second).then(() => "resolved", error => error.code);
    await first.query("commit");
    assert.equal(await racing, "23505");
    assert.equal((await owner.query(`select count(*)::int as total from public.authentication_lifecycle_resolutions where operation_id = '${scopeOperation(4)}'`)).rows[0].total, 1);
    assert.equal((await owner.query(`select count(*)::int as total from public.audit_events where entity_id = '${scopeOperation(4)}' and action = 'password_operation_resolved'`)).rows[0].total, 1);

    // Even a direct owner insert, bypassing the resolution function, records its audit entry in the same transaction.
    await owner.query(`insert into public.authentication_lifecycle_operations(id, operation_kind, tracepoint_user_id, department_id, state, attempts, safe_error_code) values
      ('${scopeOperation(16)}', 'reset_password', '${scopeUser(4)}', '${departmentA}', 'compensation_required', 1, 'initial_password_required'),
      ('${scopeOperation(17)}', 'reset_password', '${scopeUser(4)}', null, 'compensation_required', 1, 'initial_password_required')`);
    await owner.query(`insert into public.authentication_lifecycle_resolutions(operation_id, resolution, resolution_source, basis, evidence) values ('${scopeOperation(16)}', 'provider_unchanged', 'owner_verified', 'Direct owner resolution recorded for the audit trigger test.', '{"cognito_writes_by_operation":"none"}')`);
    assert.equal((await owner.query(`select count(*)::int as total from public.audit_events where entity_id = '${scopeOperation(16)}' and action = 'password_operation_resolved'`)).rows[0].total, 1);
    await assert.rejects(owner.query(`insert into public.authentication_lifecycle_resolutions(operation_id, resolution, resolution_source, basis, evidence) values ('${scopeOperation(17)}', 'provider_unchanged', 'owner_verified', 'An unauditable resolution must not be recorded at all.', '{}')`), error => error.code === "23502");
    assert.equal((await owner.query(`select count(*)::int as total from public.authentication_lifecycle_resolutions where operation_id = '${scopeOperation(17)}'`)).rows[0].total, 0);

    // Only resolved or committed operations release scope: ambiguous and unverified failures stay blocked.
    await owner.query(`insert into public.authentication_lifecycle_operations(id, operation_kind, tracepoint_user_id, department_id, state, attempts, safe_error_code) values
      ('${scopeOperation(6)}', 'reset_password', '${scopeUser(6)}', '${departmentA}', 'compensation_required', 1, 'provider_unavailable'),
      ('${scopeOperation(7)}', 'assign_password', '${scopeUser(7)}', '${departmentA}', 'failed', 1, 'conflict')`);
    await assert.rejects(owner.query("select tracepoint_auth.resolve_password_operation_provider_unchanged($1,'owner_verified',$2,$3::jsonb)", [scopeOperation(6), reviewedResolution(6, "x").basis, JSON.stringify(reviewedEvidence)]), error => error.code === "22023");
    for (const user of [6, 7]) {
      await assert.rejects(owner.query(`insert into public.department_memberships(department_id, user_id) values ('${departmentB}', '${scopeUser(user)}')`), error => error.code === "42501", `user ${user}`);
    }
    await owner.query(`insert into public.department_memberships(department_id, user_id) values ('${departmentB}', '${scopeUser(1)}')`);
    // Cross-agency and platform-administrator password restrictions from 039 still apply.
    await assert.rejects(owner.query(`insert into public.authentication_lifecycle_operations(id, operation_kind, tracepoint_user_id, department_id, state) values ('${scopeOperation(10)}', 'assign_password', '${scopeUser(1)}', '${departmentA}', 'prepared')`), error => error.code === "42501");
    await assert.rejects(owner.query(`insert into public.authentication_lifecycle_operations(id, operation_kind, tracepoint_user_id, department_id, state) values ('${scopeOperation(11)}', 'reset_password', '${scopeUser(5)}', '${departmentA}', 'prepared')`), error => error.code === "42501");
    await assert.rejects(owner.query(`insert into public.platform_admins values ('${scopeUser(6)}', true)`), error => error.code === "42501");
    await owner.query(`insert into public.platform_admins values ('${scopeUser(2)}', true)`);

    // After 040: one finish signature; three-argument callers keep uncertain failures, and only an
    // application-reported pre-write refusal of a prepared operation becomes a resolved failure.
    assert.deepEqual((await owner.query(`select pg_get_function_identity_arguments(p.oid) as arguments, p.pronargdefaults as defaults,
        has_function_privilege('tracepoint_runtime', p.oid, 'EXECUTE') as runtime, has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'tracepoint_auth' and p.proname = 'finish_cognito_password_operation'`)).rows,
      [{ arguments: "p_operation_id uuid, p_succeeded boolean, p_error_code text, p_provider_unchanged boolean", defaults: 2, runtime: true, anon: false, authenticated: false }]);
    await owner.query(`insert into public.authentication_lifecycle_operations(id, operation_kind, tracepoint_user_id, department_id, state, provider_username) values
      ('${scopeOperation(12)}', 'reset_password', '${scopeUser(8)}', '${departmentA}', 'prepared', 'provider-8'),
      ('${scopeOperation(13)}', 'reset_password', '${scopeUser(9)}', '${departmentA}', 'prepared', 'provider-9'),
      ('${scopeOperation(14)}', 'assign_password', '${scopeUser(3)}', '${departmentA}', 'prepared', 'provider-3')`);
    await runtime.query("select tracepoint_auth.finish_cognito_password_operation($1,$2,$3)", [scopeOperation(12), false, "provider_unavailable"]);
    await runtime.query("select tracepoint_auth.finish_cognito_password_operation($1,$2,$3,$4)", [scopeOperation(13), false, "initial_password_required", true]);
    await assert.rejects(runtime.query("select tracepoint_auth.finish_cognito_password_operation($1,$2,$3,$4)", [scopeOperation(12), false, "initial_password_required", true]), error => error.code === "22023");
    await runtime.query("select tracepoint_auth.finish_cognito_password_operation($1,$2)", [scopeOperation(14), true]);
    const finished = Object.fromEntries((await owner.query(`select o.id::text, o.state, r.resolution_source from public.authentication_lifecycle_operations o
      left join public.authentication_lifecycle_resolutions r on r.operation_id = o.id where o.id in ('${scopeOperation(12)}','${scopeOperation(13)}','${scopeOperation(14)}')`)).rows.map(row => [row.id, [row.state, row.resolution_source]]));
    assert.deepEqual(finished, {
      [scopeOperation(12)]: ["compensation_required", null],
      [scopeOperation(13)]: ["failed", "application_pre_write_refusal"],
      [scopeOperation(14)]: ["committed", null],
    });
    await assert.rejects(owner.query(`insert into public.department_memberships(department_id, user_id) values ('${departmentB}', '${scopeUser(8)}')`), error => error.code === "42501");
    await owner.query(`insert into public.department_memberships(department_id, user_id) values ('${departmentB}', '${scopeUser(9)}')`);
  } finally {
    for (const client of clients.reverse()) await client.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
    await server?.stop().catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("reviewed resolution lists are validated before any connection and carry no personal data", () => {
  const valid = [reviewedResolution(1, "recovery_unavailable")];
  assert.deepEqual(parsePasswordScopeResolutions(JSON.stringify(valid)), valid);
  for (const invalid of [
    "not json", "{}", JSON.stringify([{ ...valid[0], operation_kind: "assign_password" }]),
    JSON.stringify([{ ...valid[0], safe_error_code: "provider_unavailable" }]),
    JSON.stringify([{ ...valid[0], evidence: { ...reviewedEvidence, cognito_writes_by_operation: "unknown" } }]),
    JSON.stringify([{ ...valid[0], basis: "too short" }]), JSON.stringify([valid[0], valid[0]]),
  ]) assert.throws(() => parsePasswordScopeResolutions(invalid), /PASSWORD_SCOPE_RESOLUTIONS_INVALID/);
  assert.throws(() => parsePasswordScopeResolutions(JSON.stringify([{ ...valid[0], basis: "Reviewed with officer@example.test before resolution." }])), /PERSONAL_DATA/);
});

test("unit files are atomic bodies: nested transaction control outside function bodies is refused", async () => {
  for (const file of ["035_inventory_phase1.sql", "036_inventory_checkout_phase2a.sql", "037_inventory_management_runtime_grants.sql", "044_cognito_password_global_scope.sql", "045_password_operation_resolution.sql"]) {
    assert.doesNotThrow(() => transactionBody(readFileSync(new URL(`../database/aws/${file}`, import.meta.url), "utf8")), file);
  }
  for (const nested of ["begin;\nselect 1;\ncommit;\nbegin;\nselect 2;\ncommit;", "begin;\nselect 1;\nsavepoint inner_step;\ncommit;", "begin;\nselect 1; rollback;\ncommit;", "begin;\ncreate function f() returns int language plpgsql as $$ begin return 1; end; $$;\nend;\ncommit;"]) {
    assert.throws(() => transactionBody(nested), /LIVE_RELEASE_UNIT_FILE_HAS_NESTED_TRANSACTION_CONTROL/);
  }
  assert.deepEqual(liveReleaseUnits["password-scope-039-040"].map(file => file.version), [44, 45]);
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  assert.ok(runner.indexOf("parsePasswordScopeResolutions(process.env.TRACEPOINT_PASSWORD_SCOPE_RESOLUTIONS)") < runner.indexOf("client = await connect();"));
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
  const guard = await readFile(new URL("../database/aws/044_cognito_password_global_scope.sql", import.meta.url), "utf8");
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
  assert.match(inspection, /\[44, \[routine\("tracepoint_auth\.guard_cognito_password_global_scope"\)/);
  assert.match(inspection, /\[44,[\s\S]*trigger\("public\.authentication_lifecycle_operations\.authentication_lifecycle_password_global_scope"\)/);
  assert.match(inspectionCatalogQueries.find(([name]) => name === "triggers")?.[1] ?? "", /pg_trigger/);
  assert.ok(migrationInspectionManifest.some(({ version }) => version === 44));
  assert.match(runner, /pending\.length !== 2[\s\S]*pending\[0\]\?\.version !== 43[\s\S]*pending\[1\]\?\.version !== 44/);
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
  const migration = await readFile(new URL("../database/aws/043_range_workspace_authenticated_writes.sql", import.meta.url), "utf8");
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

test("migration versions are unique and 038-048 hold the reconciled lineage with unchanged contents", async () => {
  // Agency Documents keeps 038-041 (recorded in the staging ledger). The release line's range-workspace and
  // password-scope migrations, applied to production without ledger rows, moved byte-for-byte to 043-045.
  // 042 is the staging line's default module entitlements migration. Hashes here are of LF content
  // (normalizedSha256), as the live release-unit pins record; staging's ledger records the SHA-256 of the
  // CRLF bytes of the core.autocrlf=true migration archive, checked below for 038 and 042.
  // 046 adds the default-off Agency Documents module toggle to the catalog; 047 the Fleet/Inventory catalog rows;
  // 048 activates those rows where production imported them inactive.
  const directory = new URL("../database/aws/", import.meta.url);
  const names = (await readdir(directory)).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort();
  const versions = names.map((name) => Number(name.slice(0, 3)));
  assert.equal(new Set(versions).size, versions.length, "each version is used by exactly one file");
  const expected = {
    38: ["038_agency_documents_template_builder.sql", "e5d9731e6eef405945ca1c222c69bdd76559646fc97c393beec537cd656eee89"],
    39: ["039_document_template_analysis.sql", "894c51ea4d74e8e6d4a6b988a4bf3add34266cf5fde9a199f18a2660ecfa6086"],
    40: ["040_document_template_structured_bindings.sql", "908c2e8704c331d4122ee820143ab645f851761c9747b6d65dee8743e3007525"],
    41: ["041_document_template_write_authority.sql", "e0d5cb1b4abb1257debff25c6de00785e7853b9b5157b459cae592f8545ca06c"],
    42: ["042_default_module_entitlements.sql", "857baa4ab02f99acb046a71a820c9d54bd0d69fd56cf6048fba22945685adff1"],
    43: ["043_range_workspace_authenticated_writes.sql", "f250c74b87b63a9d4ac614edf09ae84e15976cbe0234114a158f79b2b0cae3e1"],
    44: ["044_cognito_password_global_scope.sql", "3916971b7ffee8e9aa0b44269ab251c1a6f780aae1b4ac9cbc450c98be3dc987"],
    45: ["045_password_operation_resolution.sql", "3a6e582e16afc402696ee162cbd046e27703a0dc0ed36701031ff84604033e6b"],
    46: ["046_agency_documents_module_toggle.sql", "f308741ec52ab2947cc5cf8a08bde0e20e0dd7d89c25b633ccc0c714f1457f4b"],
    47: ["047_fleet_inventory_feature_catalog.sql", "b1ca090ad5fb0f5b09f20cb6620cc59737b03303798bd0c21b911906138338ab"],
    48: ["048_activate_fleet_inventory_catalog.sql", "a62ff9e684fb9f5ce1ba79d1ca59e9b1cbc00c8989967dfd643df7c4fdcc20ea"],
  };
  for (const [version, [filename, sha256]] of Object.entries(expected)) {
    assert.ok(names.includes(filename), `${filename} is version ${version}`);
    assert.equal(normalizedSha256(await readFile(new URL(filename, directory), "utf8")), sha256, `${filename} contents are unchanged`);
  }
  assert.deepEqual(versions, Array.from({ length: 48 }, (_, index) => index + 1), "migrations are 001-048 contiguous");
  assert.equal(names.find((name) => name.startsWith("042_")), "042_default_module_entitlements.sql", "042 holds the default module entitlements");
  const crlfSha256 = async (filename) => createHash("sha256").update((await readFile(new URL(filename, directory), "utf8")).replace(/\r\n/g, "\n").replace(/\n/g, "\r\n")).digest("hex");
  assert.equal(await crlfSha256("038_agency_documents_template_builder.sql"), "83f1ffdb10c646d4b7ac7e1d0478b009d53da214cbc4407c12f6b9db6edf1e3a", "038 staging ledger (CRLF archive) hash");
  assert.equal(await crlfSha256("042_default_module_entitlements.sql"), "f24425f5370f1ab32ec7074b13dd56f5b00afa5ab757039ca431f7312c27a4b4", "042 staging ledger (CRLF archive) hash");
  for (const [unit, pins] of Object.entries(liveReleaseUnits)) for (const pin of pins) assert.equal(pin.filename.slice(0, 3), String(pin.version).padStart(3, "0"), `${unit} pins ${pin.filename} at its own version`);
});

test("Agency Documents migration grants only manager writes and generation inserts", async () => {
  const contents = await readFile(new URL("../database/aws/041_document_template_write_authority.sql", import.meta.url), "utf8");
  assert.match(contents, /grant insert, update, delete on public\.document_templates/);
  assert.match(contents, /document_templates_manage[\s\S]*manage_document_templates/);
  assert.match(contents, /document_template_structured_bindings_manage[\s\S]*manage_document_templates/);
  assert.match(contents, /grant insert on public\.generated_documents to authenticated/);
  assert.match(contents, /generated_documents_create[\s\S]*generate_agency_documents/);
  assert.doesNotMatch(contents, /grant all on public\.generated_documents/i);
});

test("duplicate migration versions fail before the runner connects to PostgreSQL", async () => {
  const runner = await readFile(new URL("./run-aws-native-migrations.mjs", import.meta.url), "utf8");
  assert.match(runner, /result\[index - 1\]\.version >= result\[index\]\.version/);
  assert.ok(runner.indexOf("files = await migrations();") >= 0);
  assert.ok(runner.indexOf("files = await migrations();") < runner.indexOf("client = await connect();"));
});

test("embedded Postgres applies the Agency Documents unit to a production-shaped database without changing entitlements", { timeout: 180_000 }, async () => {
  let server;
  let owner;
  let directory;
  try {
    directory = await mkdtemp(path.join(tmpdir(), "tp-live-agency-documents-"));
    const port = await localPostgresPort();
    server = new EmbeddedPostgres({ databaseDir: directory, user: "postgres", password: "local-units-only", port, persistent: true,
      postgresFlags: ["-h", "127.0.0.1"], initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
    await server.initialise();
    await server.start();
    const config = { host: "127.0.0.1", port };
    const admin = new pg.Client({ ...config, database: "postgres", user: "postgres", password: "local-units-only" });
    await admin.connect();
    await admin.query("CREATE DATABASE tracepoint");
    await admin.end();
    const superuser = new pg.Client({ ...config, database: "tracepoint", user: "postgres", password: "local-units-only" });
    await superuser.connect();
    await superuser.query(`
      create role authenticated nologin; create role anon nologin; create role service_role nologin;
      create role tracepoint_migrator login password 'owner-local-only';
      grant create on schema public to tracepoint_migrator;
      create schema tracepoint_auth authorization tracepoint_migrator;`);
    await superuser.end();
    owner = new pg.Client({ ...config, database: "tracepoint", user: "tracepoint_migrator", password: "owner-local-only" });
    await owner.connect();
    // Production's shape: the 015-era entitlement tables with no 042 triggers or default_enabled column, some
    // agencies with partial entitlement rows, Fleet and Inventory data, and fleet/inventory catalog rows imported
    // inactive (so set_platform_entitlement refuses them until 048 runs).
    await owner.query(`
      create table public.departments(id uuid primary key, name text not null);
      create table public.profiles(id uuid primary key, email text, full_name text);
      create table public.permissions(code text primary key, display_name text, description text);
      create table public.department_memberships(department_id uuid not null references public.departments(id), user_id uuid not null references public.profiles(id), is_active boolean not null default true);
      create table public.platform_admins(user_id uuid primary key references public.profiles(id), is_active boolean not null default true);
      create table public.authentication_lifecycle_operations(id uuid primary key, operation_kind text not null, tracepoint_user_id uuid not null references public.profiles(id),
        department_id uuid references public.departments(id), state text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
      create table public.feature_catalog(code text primary key, display_name text not null, description text, sort_order integer not null default 0, is_active boolean not null default true, created_at timestamptz not null default now());
      create table public.department_features(department_id uuid not null references public.departments(id) on delete cascade, feature_code text not null references public.feature_catalog(code),
        is_enabled boolean not null default false, enabled_at timestamptz, disabled_at timestamptz, updated_at timestamptz not null default now(), updated_by uuid, primary key(department_id, feature_code));
      create table public.department_feature_events(id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id) on delete cascade,
        feature_code text not null references public.feature_catalog(code), previous_enabled boolean, new_enabled boolean not null, actor_user_id uuid, reason text, created_at timestamptz not null default now());
      create table public.fleet_vehicles(id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id));
      create table public.inventory_items(id uuid primary key default gen_random_uuid(), department_id uuid not null references public.departments(id));
      create function tracepoint_auth.subject_id() returns uuid language sql stable as $$ select null::uuid $$;
      create function tracepoint_auth.department_id() returns uuid language sql stable as $$ select null::uuid $$;
      create function public.is_department_member(p_department_id uuid) returns boolean language sql stable as $$ select true $$;
      create function public.has_department_permission(p_department_id uuid, p_code text) returns boolean language sql stable as $$ select true $$;
      insert into public.departments values ('00000000-0000-0000-0000-00000000000a', 'Alpha PD'), ('00000000-0000-0000-0000-00000000000b', 'Bravo PD');
      insert into public.feature_catalog(code, display_name, sort_order) values ('firearms', 'Firearms', 60), ('ammunition', 'Ammunition', 10);
      insert into public.feature_catalog(code, display_name, sort_order, is_active) values ('fleet', 'Fleet', 55, false), ('inventory', 'Inventory', 65, false);
      insert into public.department_features(department_id, feature_code, is_enabled) values
        ('00000000-0000-0000-0000-00000000000a', 'firearms', true), ('00000000-0000-0000-0000-00000000000a', 'ammunition', true),
        ('00000000-0000-0000-0000-00000000000b', 'firearms', true);
      insert into public.fleet_vehicles(department_id) values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000a');
      insert into public.inventory_items(department_id) values ('00000000-0000-0000-0000-00000000000b');`);
    const options = { expectedPort: port };
    const migrationDirectory = path.resolve(import.meta.dirname, "../database/aws");
    const files = await Promise.all((await readdir(migrationDirectory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(async filename => ({
      version: Number(filename.slice(0, 3)), filename, contents: await readFile(path.join(migrationDirectory, filename), "utf8"),
    })));
    const entitlements = async () => (await owner.query("select department_id::text, feature_code, is_enabled from public.department_features order by 1, 2")).rows;
    const before = await entitlements();

    const precheck = await runLivePrecheck(owner, options);
    assert.deepEqual(precheck.readiness.agencyDocuments, { ready: true, blockers: [] });
    const documents = precheck.precheck.agency_documents;
    assert.deepEqual(documents.feature_catalog_codes, ["ammunition", "firearms", "fleet", "inventory"]);
    assert.deepEqual(documents.inactive_feature_catalog_codes, ["fleet", "inventory"]);
    assert.equal(documents.module_entitlement_triggers, 0);
    assert.equal(documents.department_features_rows, 3);
    assert.deepEqual(documents.agencies.map(agency => [agency.name, agency.entitlements, Number(agency.fleet_vehicles), Number(agency.inventory_items)]), [
      ["Alpha PD", { firearms: true, ammunition: true }, 2, 0],
      ["Bravo PD", { firearms: true }, 0, 1],
    ]);

    const result = await applyAgencyDocumentsUnit(owner, files, options);
    assert.equal(result.status, "APPLIED");
    assert.equal(result.ledger_modified, false);
    assert.deepEqual(result.files.map(file => file.version), [38, 39, 40, 41, 46, 47, 48]);
    assert.equal(result.postconditions.tables_present, 6);
    assert.equal(result.postconditions.policies_present, 12);
    assert.equal(result.postconditions.entitlements_unchanged, true);
    assert.deepEqual(await entitlements(), before, "no agency's entitlements change");
    assert.deepEqual((await owner.query("select code, is_active, default_enabled from public.feature_catalog order by code")).rows, [
      { code: "agency_documents", is_active: true, default_enabled: false },
      { code: "ammunition", is_active: true, default_enabled: true },
      { code: "firearms", is_active: true, default_enabled: true },
      { code: "fleet", is_active: true, default_enabled: true },
      { code: "inventory", is_active: true, default_enabled: true },
    ]);
    assert.equal((await owner.query("select count(*)::int as total from public.department_feature_events")).rows[0].total, 0);
    assert.equal((await owner.query("select to_regclass('public.tracepoint_aws_schema_migrations') is null as absent")).rows[0].absent, true);
    // The adding of a department later must not provision anything either: 042's triggers are absent.
    await owner.query("insert into public.departments values ('00000000-0000-0000-0000-00000000000c', 'Charlie PD')");
    assert.equal((await owner.query("select count(*)::int as total from public.department_features where department_id = '00000000-0000-0000-0000-00000000000c'")).rows[0].total, 0);

    await assert.rejects(applyAgencyDocumentsUnit(owner, files, options), /LIVE_RELEASE_UNIT_PRECONDITION_FAILED: .*agency_documents_tables_already_present/);
  } finally {
    await owner?.end().catch(() => undefined);
    await server?.stop().catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("Agency Documents readiness refuses 042's triggers and any earlier Agency Documents objects", () => {
  const ready = { permissions_code_unique: true, permissions_writable: true, public_schema_create: true, tracepoint_auth_schema_create: true, inventory_prerequisites_present: true,
    agency_documents: { agency_documents_tables_present: [], agency_documents_permissions_present: 0, entitlement_tables_present: true, feature_catalog_codes: ["firearms"],
      feature_catalog_default_enabled_present: false, module_entitlement_triggers: 0 } };
  assert.deepEqual(liveUnitReadiness(ready).agencyDocuments, { ready: true, blockers: [] });
  const blocked = { ...ready, agency_documents: { ...ready.agency_documents, module_entitlement_triggers: 2, feature_catalog_codes: ["agency_documents"], agency_documents_tables_present: ["document_templates"] } };
  assert.deepEqual(liveUnitReadiness(blocked).agencyDocuments.blockers, ["agency_documents_tables_already_present", "agency_documents_catalog_row_already_present", "module_entitlement_triggers_present"]);
  assert.equal(liveUnitReadiness({ ...ready, agency_documents: undefined }).agencyDocuments.ready, false);
});
