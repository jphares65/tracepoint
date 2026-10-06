import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

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
});

test("migration tasks use the distroless numeric nonroot user and report pre-start failures", async () => {
  const migrationTask = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  assert.match(migrationTask, /function Set-MigrationTaskContainerUser/);
  assert.match(migrationTask, /NotePropertyValue '65532'/);
  assert.match(migrationTask, /\$user\.Value = '65532'/);
  assert.match(migrationTask, /function Get-MigrationTaskFailureDetails/);
  assert.match(migrationTask, /Get-OptionalPropertyValue \$container 'exitCode'/);
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
