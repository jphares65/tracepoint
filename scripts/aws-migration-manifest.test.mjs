import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// database/aws/MANIFEST.json allocates every AWS-native migration number. It
// stops two branches from taking the same number (047 was claimed by the
// staging lineage and B6; 038-046 and 048 by the staging lineage and the remediation)
// and an applied migration from being edited after the fact.
const directory = path.resolve("database/aws");
const manifest = JSON.parse(readFileSync(path.join(directory, "MANIFEST.json"), "utf8"));
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const files = readdirSync(directory).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();

test("every migration file is allocated in the manifest with its exact content", () => {
  assert.deepEqual(files, manifest.migrations.map((entry) => entry.filename));
  for (const entry of manifest.migrations) {
    assert.equal(entry.filename.slice(0, 3), String(entry.version).padStart(3, "0"), entry.filename);
    const lf = readFileSync(path.join(directory, entry.filename), "utf8").replaceAll("\r\n", "\n");
    assert.equal(sha256(lf), entry.sha256Lf, `${entry.filename} changed: an allocated migration is immutable once recorded here`);
    assert.equal(sha256(lf.replaceAll("\n", "\r\n")), entry.sha256Crlf, entry.filename);
  }
});

test("manifest versions are contiguous, unique and never reuse a reserved number", () => {
  const allocated = manifest.migrations.map((entry) => entry.version);
  assert.deepEqual(allocated, allocated.map((_, index) => index + 1));
  const reserved = manifest.reserved.map((entry) => entry.version);
  assert.equal(new Set([...allocated, ...reserved]).size, allocated.length + reserved.length);
  assert.ok(reserved.every((version) => version > allocated.at(-1)));
  assert.equal(manifest.nextFree, Math.max(...allocated, ...reserved) + 1);
  for (const entry of manifest.reserved) {
    assert.ok(!files.some((name) => name.startsWith(String(entry.version).padStart(3, "0") + "_")), `${entry.version} is reserved for ${entry.owner}; promote it in the manifest first`);
  }
});

test("applied history matches the reconciled staging ledger and CRLF image checksums", () => {
  const applied = manifest.migrations.filter((entry) => entry.stagingLedger === "applied");
  // 064-065 applied by the Batch 2 staging release of f4e8588d (2026-10-22); 066-068 by the Batch 3 release of e1d5cdab
  // (2026-10-23); the read-only SCH-3 capture read the ledger as 001-068, 0 pending (2026-10-24).
  assert.deepEqual(applied.map((entry) => entry.version), Array.from({ length: 68 }, (_, index) => index + 1));
  assert.equal(applied.at(-1).filename, "068_fleet_manual_status_under_safety_hold.sql");
  assert.ok(manifest.migrations.filter((entry) => entry.stagingLedger !== "applied").every((entry) => entry.version > 68));
});
