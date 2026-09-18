import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

export const MANIFEST_FORMAT = "tracepoint-storage-migration/v1";
export const CHECKPOINT_FORMAT = "tracepoint-storage-migration-checkpoint/v1";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SOURCE_BUCKETS = new Map([
  ["tracepoint-attachments", "attachments"],
  ["department-assets", "department-assets"],
]);
const ATTACHMENT_DOMAINS = new Set(["qualification", "agency-training", "firearm", "drill-document"]);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value, encoding = "hex") {
  return createHash("sha256").update(value).digest(encoding);
}

export function manifestIdentity(manifest) {
  const stable = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "manifestId"));
  return sha256(canonicalJson(stable));
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() !== value || !value) throw new Error(`${label} must be a non-empty trimmed string`);
}

export function assertDepartmentKey(key, departmentId, label = "object key") {
  assertString(key, label);
  if (key.startsWith("/") || key.includes("\\") || /[\x00-\x1f\x7f]/.test(key)) throw new Error(`${label} is unsafe`);
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new Error(`${label} is unsafe`);
  let decoded;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    throw new Error(`${label} has invalid encoding`);
  }
  if (decoded.includes("\\") || decoded.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(`${label} has unsafe encoding`);
  if (segments[0] !== departmentId) throw new Error(`${label} is outside department ${departmentId}`);
}

function safelyDecodeSegment(segment) {
  let decoded = segment;
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded;
}

export function assertSourceKey(sourceBucket, sourceKey, departmentId) {
  assertDepartmentKey(sourceKey, departmentId, "source key");
  const segments = sourceKey.split("/");
  if (sourceBucket === "department-assets") {
    if (segments.length !== 2 || !/^patch-[0-9]+\.(png|jpg|webp)$/.test(segments[1])) throw new Error("Source department asset key does not match the runtime contract");
    return;
  }
  if (sourceBucket !== "tracepoint-attachments" || segments.length !== 4 || !ATTACHMENT_DOMAINS.has(segments[1])) throw new Error("Source attachment key does not match the runtime contract");
  for (const [index, segment] of segments.entries()) {
    const decoded = safelyDecodeSegment(segment);
    const decodedParts = decoded?.split("/") ?? [];
    const qualificationRecord = index === 2 && segments[1] === "qualification";
    if (decoded === null || decoded.includes("%") || decoded.includes("\\") || /[\x00-\x1f\x7f]/.test(decoded) || (!qualificationRecord && decoded.includes("/")) || decodedParts.some((part) => !part || part === "." || part === "..")) {
      throw new Error("Source attachment key has unsafe encoding");
    }
  }
}

export function destinationKeyFor(sourceBucket, sourceKey, departmentId) {
  const prefix = SOURCE_BUCKETS.get(sourceBucket);
  if (!prefix) throw new Error(`Unsupported source bucket: ${sourceBucket}`);
  assertSourceKey(sourceBucket, sourceKey, departmentId);
  return `${prefix}/${sourceKey}`;
}

function normalizeInventoryObject(value, departmentId) {
  assertString(value.bucket, "source bucket");
  assertString(value.key, "source key");
  if (!SOURCE_BUCKETS.has(value.bucket)) throw new Error(`Unsupported source bucket: ${value.bucket}`);
  assertSourceKey(value.bucket, value.key, departmentId);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) throw new Error("Object bytes must be a non-negative safe integer");
  if (typeof value.contentType !== "string" || !value.contentType) throw new Error("Object contentType is required");
  if (value.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error("Object sha256 must be lowercase hexadecimal");
  return {
    source: { bucket: value.bucket, key: value.key },
    destinationKey: destinationKeyFor(value.bucket, value.key, departmentId),
    bytes: value.bytes,
    contentType: value.contentType,
    ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}),
    ...(value.etag ? { etag: value.etag } : {}),
    ...(value.sha256 ? { sha256: value.sha256 } : {}),
  };
}

export function createDepartmentManifest({ departmentId, environment, sourceProjectRef, destination, objects, createdAt = new Date().toISOString() }) {
  if (!UUID.test(departmentId)) throw new Error("A valid department UUID is required");
  assertString(environment, "environment");
  assertString(sourceProjectRef, "source project ref");
  assertString(destination?.bucket, "destination bucket");
  assertString(destination?.region, "destination region");
  if (!/^\d{12}$/.test(destination?.expectedOwner ?? "")) throw new Error("Destination expectedOwner must be a 12-digit AWS account ID");
  if (!Array.isArray(objects)) throw new Error("Inventory objects must be an array");

  const normalized = objects.map((object) => normalizeInventoryObject(object, departmentId));
  normalized.sort((a, b) => a.destinationKey.localeCompare(b.destinationKey));
  const duplicates = duplicateValues(normalized.map((object) => object.destinationKey));
  if (duplicates.length) throw new Error(`Inventory has duplicate destination keys: ${duplicates.join(", ")}`);

  const manifest = {
    format: MANIFEST_FORMAT,
    departmentId,
    environment,
    createdAt,
    source: { provider: "supabase-storage", projectRef: sourceProjectRef },
    destination: { provider: "aws-s3", ...destination },
    objects: normalized,
  };
  return { ...manifest, manifestId: manifestIdentity(manifest) };
}

export function validateManifest(manifest, expected = {}) {
  if (!manifest || manifest.format !== MANIFEST_FORMAT) throw new Error(`Manifest format must be ${MANIFEST_FORMAT}`);
  if (manifest.manifestId !== manifestIdentity(manifest)) throw new Error("Manifest identity does not match its contents");
  const rebuilt = createDepartmentManifest({
    departmentId: manifest.departmentId,
    environment: manifest.environment,
    sourceProjectRef: manifest.source?.projectRef,
    destination: manifest.destination,
    objects: manifest.objects.map((object) => ({ ...object.source, ...object, bucket: object.source?.bucket, key: object.source?.key })),
    createdAt: manifest.createdAt,
  });
  if (manifest.manifestId !== rebuilt.manifestId) throw new Error("Manifest identity does not match its contents");
  const checks = [
    ["environment", manifest.environment],
    ["departmentId", manifest.departmentId],
    ["sourceProjectRef", manifest.source.projectRef],
    ["destinationBucket", manifest.destination.bucket],
    ["destinationRegion", manifest.destination.region],
    ["destinationOwner", manifest.destination.expectedOwner],
  ];
  for (const [name, actual] of checks) {
    if (expected[name] !== undefined && expected[name] !== actual) throw new Error(`Expected ${name} does not match manifest`);
  }
  return rebuilt;
}

export function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) (seen.has(value) ? duplicates : seen).add(value);
  return [...duplicates].sort();
}

export function buildReconciliationReport({ manifest, sourceObjects = [], destinationObjects = [] }) {
  validateManifest(manifest);
  const allowedPrefixes = [`attachments/${manifest.departmentId}/`, `department-assets/${manifest.departmentId}/`];
  const scopedSourceObjects = sourceObjects.filter((object) => typeof object.key === "string" && object.key.startsWith(`${manifest.departmentId}/`));
  const scopedDestinationObjects = destinationObjects.filter((object) => typeof object.key === "string" && allowedPrefixes.some((prefix) => object.key.startsWith(prefix)));
  const sourceDuplicates = duplicateValues(scopedSourceObjects.map((object) => `${object.bucket}/${object.key}`));
  const destinationDuplicates = duplicateValues(scopedDestinationObjects.map((object) => object.key));
  const sourceByKey = new Map(scopedSourceObjects.map((object) => [`${object.bucket}/${object.key}`, object]));
  const destinationByKey = new Map(scopedDestinationObjects.map((object) => [object.key, object]));
  const missingSource = [];
  const missingDestination = [];
  const mismatched = [];
  for (const object of manifest.objects) {
    const source = sourceByKey.get(`${object.source.bucket}/${object.source.key}`);
    const destination = destinationByKey.get(object.destinationKey);
    if (!source) missingSource.push(object.destinationKey);
    if (!destination) missingDestination.push(object.destinationKey);
    if (source && (source.bytes !== object.bytes || (object.sha256 && source.sha256 && source.sha256 !== object.sha256))) {
      mismatched.push({ key: object.destinationKey, side: "source", expectedBytes: object.bytes, actualBytes: source.bytes, expectedSha256: object.sha256 ?? null, actualSha256: source.sha256 ?? null });
    }
    if (destination && (destination.bytes !== object.bytes || (object.sha256 && destination.sha256 !== object.sha256))) {
      mismatched.push({ key: object.destinationKey, side: "destination", expectedBytes: object.bytes, actualBytes: destination.bytes, expectedSha256: object.sha256 ?? null, actualSha256: destination.sha256 ?? null });
    }
  }
  const expectedKeys = new Set(manifest.objects.map((object) => object.destinationKey));
  const orphans = scopedDestinationObjects
    .filter((object) => !expectedKeys.has(object.key))
    .map((object) => object.key)
    .sort();
  const report = {
    format: "tracepoint-storage-reconciliation/v1",
    manifestId: manifest.manifestId,
    departmentId: manifest.departmentId,
    counts: {
      expected: manifest.objects.length,
      missingSource: missingSource.length,
      missingDestination: missingDestination.length,
      duplicates: sourceDuplicates.length + destinationDuplicates.length,
      mismatched: mismatched.length,
      orphans: orphans.length,
    },
    missingSource: missingSource.sort(),
    missingDestination: missingDestination.sort(),
    duplicates: { source: sourceDuplicates, destination: destinationDuplicates },
    mismatched: mismatched.sort((a, b) => a.key.localeCompare(b.key) || a.side.localeCompare(b.side)),
    orphans,
  };
  return { ...report, clean: Object.entries(report.counts).filter(([key]) => key !== "expected").every(([, count]) => count === 0) };
}

export function newCheckpoint(manifest) {
  return { format: CHECKPOINT_FORMAT, manifestId: manifest.manifestId, departmentId: manifest.departmentId, completed: {} };
}

export function validateCheckpoint(checkpoint, manifest) {
  if (!checkpoint || checkpoint.format !== CHECKPOINT_FORMAT || checkpoint.manifestId !== manifest.manifestId || checkpoint.departmentId !== manifest.departmentId || !checkpoint.completed || Array.isArray(checkpoint.completed)) {
    throw new Error("Checkpoint does not belong to this manifest");
  }
  return checkpoint;
}

export async function loadCheckpoint(file, manifest) {
  try {
    return validateCheckpoint(JSON.parse(await readFile(file, "utf8")), manifest);
  } catch (error) {
    if (error?.code === "ENOENT") return newCheckpoint(manifest);
    throw error;
  }
}

export async function writeCheckpoint(file, checkpoint) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

function assertMigrationAdapters(source, destination) {
  for (const [adapter, methods] of [[source, ["read"]], [destination, ["read", "create"]]]) {
    for (const method of methods) if (typeof adapter?.[method] !== "function") throw new Error(`Migration adapter requires ${method}()`);
  }
}

export async function migrateDepartment({ manifest, source, destination, checkpoint = newCheckpoint(manifest), saveCheckpoint = async () => {}, execute = false, stopAfter = Infinity }) {
  validateManifest(manifest);
  validateCheckpoint(checkpoint, manifest);
  assertMigrationAdapters(source, destination);
  const results = [];
  let processed = 0;
  for (const object of manifest.objects) {
    if (processed >= stopAfter) break;
    const completed = checkpoint.completed[object.destinationKey];
    if (completed) {
      const destinationBytes = await destination.read(object.destinationKey);
      if (!(destinationBytes instanceof Uint8Array) || destinationBytes.byteLength !== completed.bytes || sha256(destinationBytes) !== completed.sha256) {
        throw new Error(`Checkpoint verification failed: ${object.destinationKey}`);
      }
      results.push({ key: object.destinationKey, bytes: completed.bytes, sha256: completed.sha256, status: "resumed" });
      processed += 1;
      continue;
    }
    const sourceBytes = await source.read(object.source);
    if (!(sourceBytes instanceof Uint8Array)) throw new Error(`Source object unavailable: ${object.destinationKey}`);
    const sourceSha256 = sha256(sourceBytes);
    if (sourceBytes.byteLength !== object.bytes || (object.sha256 && sourceSha256 !== object.sha256)) throw new Error(`Source changed after manifest creation: ${object.destinationKey}`);

    let destinationBytes = await destination.read(object.destinationKey);
    let status = "verified";
    if (destinationBytes === null) {
      status = execute ? "created" : "missing";
      if (execute) {
        await destination.create({
          key: object.destinationKey,
          bytes: sourceBytes,
          contentType: object.contentType,
          checksumSha256Base64: sha256(sourceBytes, "base64"),
          metadata: { department: manifest.departmentId, sourceSha256 },
        });
        destinationBytes = await destination.read(object.destinationKey);
      }
    }
    if (destinationBytes !== null) {
      if (!(destinationBytes instanceof Uint8Array) || destinationBytes.byteLength !== object.bytes || sha256(destinationBytes) !== sourceSha256) throw new Error(`Destination checksum mismatch; refusing overwrite: ${object.destinationKey}`);
      checkpoint.completed[object.destinationKey] = { bytes: object.bytes, sha256: sourceSha256 };
      await saveCheckpoint(checkpoint);
    }
    results.push({ key: object.destinationKey, bytes: object.bytes, sha256: sourceSha256, status });
    processed += 1;
  }
  return {
    format: "tracepoint-storage-copy-result/v1",
    manifestId: manifest.manifestId,
    departmentId: manifest.departmentId,
    dryRun: !execute,
    complete: Object.keys(checkpoint.completed).length === manifest.objects.length,
    counts: {
      expected: manifest.objects.length,
      processed: results.length,
      created: results.filter((result) => result.status === "created").length,
      verified: results.filter((result) => result.status === "verified").length,
      resumed: results.filter((result) => result.status === "resumed").length,
      missing: results.filter((result) => result.status === "missing").length,
    },
    objects: results,
  };
}
