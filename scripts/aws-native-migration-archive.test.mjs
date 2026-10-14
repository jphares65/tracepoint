import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationPathPattern = /^database\/aws\/(\d{3})_[^/]+\.sql$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readTarEntries(tar) {
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const path = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim(), 8);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    entries.set(path, Buffer.from(tar.subarray(dataStart, dataEnd)));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test("migration source archive pins CRLF conversion and preserves migration bytes", async () => {
  const releaseScript = await readFile(new URL("./apply-app-migrations.ps1", import.meta.url), "utf8");
  assert.match(releaseScript, /git\.exe -C \$root -c core\.autocrlf=true archive/);
  assert.match(releaseScript, /node\.exe --test \$archiveTest/);
  assert.ok(releaseScript.indexOf("aws-native-migration-archive.test.mjs") < releaseScript.lastIndexOf("Assert-Identity"), "archive validation must run before AWS identity calls");

  const tar = execFileSync("git", ["-C", repoRoot, "-c", "core.autocrlf=true", "archive", "--format=tar", "HEAD", "--", "database/aws"]);
  const entries = readTarEntries(tar);
  const trackedMigrations = execFileSync("git", ["-C", repoRoot, "ls-tree", "-r", "--name-only", "HEAD", "--", "database/aws"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((path) => migrationPathPattern.test(path))
    .sort((a, b) => Number(a.match(migrationPathPattern)[1]) - Number(b.match(migrationPathPattern)[1]));
  const migrations = [...entries.keys()]
    .map((path) => ({ path, match: path.match(migrationPathPattern) }))
    .filter(({ match }) => match)
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));

  assert.deepEqual(migrations.map(({ path }) => path), trackedMigrations);
  assert.deepEqual(migrations.map(({ match }) => Number(match[1])), Array.from({ length: migrations.length }, (_, index) => index + 1));

  for (const { path } of migrations) {
    const archived = entries.get(path);
    const blob = execFileSync("git", ["-C", repoRoot, "cat-file", "blob", `HEAD:${path}`]);
    const expected = Buffer.from(blob.toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8");
    assert.deepEqual(archived, expected, `${path} archive bytes must be the Git blob with canonical CRLF line endings`);
    assert.equal(archived.toString("binary").replace(/\r\n/g, "").includes("\n"), false, `${path} archive must not contain bare LF`);
  }

  assert.equal(sha256(entries.get("database/aws/038_agency_documents_template_builder.sql")), "83f1ffdb10c646d4b7ac7e1d0478b009d53da214cbc4407c12f6b9db6edf1e3a");
  assert.equal(sha256(entries.get("database/aws/042_default_module_entitlements.sql")), "f24425f5370f1ab32ec7074b13dd56f5b00afa5ab757039ca431f7312c27a4b4");
});
