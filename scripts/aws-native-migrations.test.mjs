import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  assertProductionLedgerAdoptionPostconditions,
  productionLedgerAdoptionPostconditions,
  productionLedgerAdoptionPostconditionsSql,
} from "./aws-native-production-ledger-adoption.mjs";
import { assertInspectionSql, classifyMigrationInspection, inspectionCatalogQueries } from "./aws-native-migration-inspection.mjs";

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
  for (const sql of ["insert into public.tracepoint_aws_schema_migrations values (1)", "update public.x set y=1", "create table public.x(id int)"]) assert.throws(() => assertInspectionSql(sql), /READ_ONLY_INSPECTION_SQL_REJECTED/);
  assert.match(runner, /action === "inspect"/);
  assert.match(runner, /BEGIN TRANSACTION READ ONLY/);
  assert.doesNotMatch(runner.slice(runner.indexOf("async function inspect"), runner.indexOf("const files =")), /ensureLedger|withLock|migrationSqlWithLedgerEntry/);
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
  const hotfixBody = runner.slice(runner.indexOf("async function applyRangeWorkspaceHotfix"), runner.indexOf("const files ="));
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
