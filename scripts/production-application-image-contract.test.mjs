import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"];
const typecheckExtensions = new Set([".ts", ".tsx", ".mts", ".cts"]);
const normalize = (value) => value.replaceAll("\\", "/");

function quotedValues(source) {
  return [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function localSpecifiers(source) {
  return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'\n]*?\s+from\s+)?["'](\.{1,2}\/[^"']+?)["']|\b(?:import|require)\(\s*["'](\.{1,2}\/[^"']+?)["']\s*\)/g)]
    .map((match) => match[1] ?? match[2]);
}

function archiveIncludes(archivePaths, file) {
  return archivePaths.some((entry) => file === entry || file.startsWith(`${entry}/`));
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

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return sourceExtensions.includes(path.extname(entry.name)) ? [file] : [];
  }));
  return files.flat();
}

async function localImportClosure(entries) {
  const pending = [...entries];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(path.join(root, file), "utf8");
    for (const specifier of localSpecifiers(source)) {
      const base = path.resolve(root, path.dirname(file), specifier);
      const resolved = await firstExisting([
        base,
        ...sourceExtensions.map((extension) => `${base}${extension}`),
        ...sourceExtensions.map((extension) => path.join(base, `index${extension}`)),
      ]);
      assert.ok(resolved, `${file} imports missing local module ${specifier}`);
      pending.push(normalize(path.relative(root, resolved)));
    }
  }
  return visited;
}

test("production application build archive contains every local validation and typecheck dependency", async () => {
  const [dockerfile, deployScript] = await Promise.all([
    readFile(path.join(root, "Dockerfile.aws-native-production"), "utf8"),
    readFile(path.join(root, "scripts/deploy-app.ps1"), "utf8"),
  ]);
  const baseManifest = deployScript.match(/\$archivePaths\s*=\s*@\(([^)]*)\)/s);
  const productionManifest = deployScript.match(/else\s*\{\s*\$archivePaths\s*\+=\s*@\(([^)]*)\)\s*\}/s);
  assert.ok(baseManifest, "application archive manifest");
  assert.ok(productionManifest, "production application archive manifest");
  const archivePaths = [...quotedValues(baseManifest[1]), ...quotedValues(productionManifest[1])];

  assert.ok(archivePaths.includes("scripts"), "production archive must include the complete scripts tree");
  assert.ok(archivePaths.includes("infra/lib/production-target.ts"), "production archive must include the production target validation module");

  const validationScripts = [...dockerfile.matchAll(/\bnode(?:\s+--test)?\s+(scripts\/[\w./-]+\.m?js)/g)]
    .map((match) => match[1]);
  assert.deepEqual(validationScripts, [
    "scripts/assert-production-lint-ratchet.mjs",
    "scripts/run-application-tests.mjs",
    "scripts/production-application-image-contract.test.mjs",
    "scripts/aws-native-migrations.test.mjs",
  ]);

  const typecheckedScripts = (await sourceFiles(path.join(root, "scripts")))
    .filter((file) => typecheckExtensions.has(path.extname(file)))
    .map((file) => normalize(path.relative(root, file)));
  const closure = await localImportClosure([...validationScripts, ...typecheckedScripts]);
  for (const file of closure) {
    assert.ok(
      archiveIncludes(archivePaths, file),
      `${file} is required by the production build but missing from its archive`,
    );
  }
  assert.ok(archiveIncludes(archivePaths, "src"), "application test sources must remain in the archive");
});
