import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildReconciliationReport,
  createDepartmentManifest,
  loadCheckpoint,
  migrateDepartment,
  newCheckpoint,
  sha256,
  validateManifest,
  writeCheckpoint,
} from "./storage-migration-core.mjs";
import { assertEnvironmentSafeguards, main, parseArguments } from "./storage-migration.mjs";

const departmentId = "11111111-1111-4111-8111-111111111111";
const otherDepartmentId = "22222222-2222-4222-8222-222222222222";
const firstBytes = new TextEncoder().encode("first object");
const secondBytes = new TextEncoder().encode("second object");

function manifest(objects = [
  { bucket: "tracepoint-attachments", key: `${departmentId}/firearm/record/file.pdf`, bytes: firstBytes.length, contentType: "application/pdf", sha256: sha256(firstBytes) },
  { bucket: "department-assets", key: `${departmentId}/patch-1.png`, bytes: secondBytes.length, contentType: "image/png", sha256: sha256(secondBytes) },
]) {
  return createDepartmentManifest({
    departmentId,
    environment: "production",
    sourceProjectRef: "izlkwggluhlhzlumtzes",
    destination: { bucket: "tracepoint-production-private-193644343389", region: "us-east-1", expectedOwner: "193644343389" },
    objects,
    createdAt: "2026-09-09T00:00:00.000Z",
  });
}

function sourceAdapter(reads = { first: 0, second: 0 }) {
  return {
    reads,
    async read(source) {
      if (source.bucket === "tracepoint-attachments") {
        reads.first += 1;
        return firstBytes;
      }
      reads.second += 1;
      return secondBytes;
    },
  };
}

function destinationAdapter(initial = new Map()) {
  let writes = 0;
  return {
    data: initial,
    get writes() { return writes; },
    async read(key) { return initial.get(key) ?? null; },
    async create(input) {
      assert.equal(initial.has(input.key), false, "copy must never overwrite");
      assert.equal(input.checksumSha256Base64, sha256(input.bytes, "base64"));
      assert.equal(input.metadata.department, departmentId);
      initial.set(input.key, input.bytes);
      writes += 1;
    },
  };
}

test("manifest is deterministic, department-scoped, and tamper evident", () => {
  const value = manifest();
  assert.equal(validateManifest(value).manifestId, value.manifestId);
  assert.deepEqual(value.objects.map((object) => object.destinationKey), [
    `attachments/${departmentId}/firearm/record/file.pdf`,
    `department-assets/${departmentId}/patch-1.png`,
  ]);
  assert.throws(() => manifest([{ bucket: "tracepoint-attachments", key: `${otherDepartmentId}/firearm/record/file.pdf`, bytes: 1, contentType: "application/pdf" }]), /outside department/);
  assert.throws(() => manifest([{ bucket: "tracepoint-attachments", key: `${departmentId}/firearm/%252e%252e/file.pdf`, bytes: 1, contentType: "application/pdf" }]), /unsafe encoding/);
  assert.throws(() => manifest([{ bucket: "department-assets", key: `${departmentId}/unexpected.png`, bytes: 1, contentType: "image/png" }]), /runtime contract/);
  assert.throws(() => validateManifest({ ...value, departmentId: otherDepartmentId }), /outside department|identity/);
  const duplicate = value.objects[0];
  const duplicateInput = { bucket: duplicate.source.bucket, key: duplicate.source.key, bytes: duplicate.bytes, contentType: duplicate.contentType, sha256: duplicate.sha256 };
  assert.throws(() => manifest([duplicateInput, duplicateInput]), /duplicate/);
});

test("dry-run reads and hashes but performs no destination writes", async () => {
  const value = manifest();
  const destination = destinationAdapter();
  const result = await migrateDepartment({ manifest: value, source: sourceAdapter(), destination });
  assert.equal(result.dryRun, true);
  assert.equal(result.complete, false);
  assert.equal(result.counts.missing, 2);
  assert.equal(destination.writes, 0);
});

test("copy is idempotent and checkpoints every verified object", async () => {
  const value = manifest();
  const destination = destinationAdapter();
  const checkpoint = newCheckpoint(value);
  const saved = [];
  const first = await migrateDepartment({ manifest: value, source: sourceAdapter(), destination, checkpoint, execute: true, saveCheckpoint: async (state) => saved.push(JSON.parse(JSON.stringify(state))) });
  assert.equal(first.complete, true);
  assert.equal(first.counts.created, 2);
  assert.equal(saved.length, 2);
  const reads = { first: 0, second: 0 };
  const second = await migrateDepartment({ manifest: value, source: sourceAdapter(reads), destination, checkpoint, execute: true });
  assert.equal(second.counts.resumed, 2);
  assert.deepEqual(reads, { first: 0, second: 0 });
  assert.equal(destination.writes, 2);
});

test("interrupted copy resumes without duplicate writes", async () => {
  const value = manifest();
  const destination = destinationAdapter();
  const checkpoint = newCheckpoint(value);
  await migrateDepartment({ manifest: value, source: sourceAdapter(), destination, checkpoint, execute: true, stopAfter: 1 });
  assert.equal(Object.keys(checkpoint.completed).length, 1);
  const result = await migrateDepartment({ manifest: value, source: sourceAdapter(), destination, checkpoint, execute: true });
  assert.equal(result.counts.resumed, 1);
  assert.equal(result.counts.created, 1);
  assert.equal(destination.writes, 2);
});

test("source drift, destination mismatch, and stale checkpoints fail closed", async () => {
  const value = manifest();
  const destination = destinationAdapter(new Map([[value.objects[0].destinationKey, new TextEncoder().encode("wrong")]]));
  await assert.rejects(migrateDepartment({ manifest: value, source: sourceAdapter(), destination, execute: true }), /Destination checksum mismatch/);
  assert.equal(destination.writes, 0);
  await assert.rejects(migrateDepartment({ manifest: value, source: { read: async () => new TextEncoder().encode("changed") }, destination: destinationAdapter(), execute: true }), /Source changed/);
  const checkpoint = newCheckpoint(value);
  checkpoint.completed[value.objects[0].destinationKey] = { bytes: firstBytes.length, sha256: sha256(firstBytes) };
  await assert.rejects(migrateDepartment({ manifest: value, source: sourceAdapter(), destination: destinationAdapter(), checkpoint, execute: true }), /Checkpoint verification failed/);
});

test("reconciliation separates all finding categories by tenant", () => {
  const value = manifest();
  const report = buildReconciliationReport({
    manifest: value,
    sourceObjects: [
      { bucket: "tracepoint-attachments", key: value.objects[0].source.key, bytes: firstBytes.length, sha256: sha256(firstBytes) },
      { bucket: "tracepoint-attachments", key: value.objects[0].source.key, bytes: firstBytes.length, sha256: sha256(firstBytes) },
    ],
    destinationObjects: [
      { key: value.objects[0].destinationKey, bytes: firstBytes.length, sha256: sha256(new TextEncoder().encode("different")) },
      { key: value.objects[0].destinationKey, bytes: firstBytes.length, sha256: sha256(new TextEncoder().encode("different")) },
      { key: `attachments/${departmentId}/orphan`, bytes: 1, sha256: sha256(new Uint8Array([1])) },
      { key: `attachments/${otherDepartmentId}/not-this-tenant`, bytes: 1, sha256: sha256(new Uint8Array([1])) },
    ],
  });
  assert.deepEqual(report.counts, { expected: 2, missingSource: 1, missingDestination: 1, duplicates: 2, mismatched: 1, orphans: 1 });
  assert.equal(report.clean, false);
  assert.deepEqual(report.orphans, [`attachments/${departmentId}/orphan`]);
});

test("environment, project, owner, and execution approvals are explicit", () => {
  const env = {
    TRACEPOINT_MIGRATION_ENVIRONMENT: "production",
    TRACEPOINT_MIGRATION_SUPABASE_URL: "https://izlkwggluhlhzlumtzes.supabase.co/",
    TRACEPOINT_MIGRATION_SUPABASE_SERVICE_ROLE_KEY: "test-only",
    TRACEPOINT_STORAGE_MIGRATION_APPROVAL: "manifest-id",
  };
  const base = { environment: "production", sourceProjectRef: "izlkwggluhlhzlumtzes", destinationOwner: "193644343389", destinationBucket: "tracepoint-production-private-193644343389", destinationRegion: "us-east-1", env };
  assert.doesNotThrow(() => assertEnvironmentSafeguards(base));
  assert.throws(() => assertEnvironmentSafeguards({ ...base, environment: "staging" }), /environment/);
  assert.throws(() => assertEnvironmentSafeguards({ ...base, sourceProjectRef: "wrong" }), /source project/);
  assert.throws(() => assertEnvironmentSafeguards({ ...base, destinationOwner: "123" }), /12-digit/);
  assert.throws(() => assertEnvironmentSafeguards({ ...base, destinationBucket: "other" }), /environment boundary/);
  assert.throws(() => assertEnvironmentSafeguards({ ...base, execute: true, manifestId: "manifest-id" }), /acknowledgements/);
  assert.doesNotThrow(() => assertEnvironmentSafeguards({ ...base, execute: true, manifestId: "manifest-id", flags: new Set(["--acknowledge-source-read", "--acknowledge-s3-write"]) }));
});

test("checkpoint files round-trip and reject another manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tracepoint-storage-migration-"));
  try {
    const value = manifest();
    const file = path.join(directory, "checkpoint.json");
    const checkpoint = newCheckpoint(value);
    checkpoint.completed[value.objects[0].destinationKey] = { bytes: firstBytes.length, sha256: sha256(firstBytes) };
    await writeCheckpoint(file, checkpoint);
    assert.deepEqual(await loadCheckpoint(file, value), checkpoint);
    assert.match(await readFile(file, "utf8"), /tracepoint-storage-migration-checkpoint/);
    await assert.rejects(loadCheckpoint(file, manifest([{
      bucket: "tracepoint-attachments",
      key: `${departmentId}/firearm/record/another.pdf`,
      bytes: firstBytes.length,
      contentType: "application/pdf",
      sha256: sha256(firstBytes),
    }])), /does not belong/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("argument parsing defaults to flags and rejects duplicates", () => {
  assert.deepEqual(parseArguments(["copy", "--manifest", "m.json", "--execute"]), { command: "copy", values: { "--manifest": "m.json" }, flags: new Set(["--execute"]) });
  assert.throws(() => parseArguments(["copy", "--manifest", "a", "--manifest", "b"]), /Duplicate/);
});

test("help is available without credentials or provider calls", async () => {
  assert.match((await main(["--help"], {})).help, /Dry-run is the default/);
});
