#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  UUID,
  buildReconciliationReport,
  createDepartmentManifest,
  loadCheckpoint,
  migrateDepartment,
  sha256,
  validateManifest,
  writeCheckpoint,
} from "./storage-migration-core.mjs";

const MAX_OBJECTS = 1_000_000;
const MAX_OBJECT_BYTES = 25 * 1024 * 1024;
const PAGE_SIZE = 100;

function usage() {
  return `Usage:
  node scripts/storage-migration.mjs inventory --department UUID --environment NAME --source-project-ref REF --destination-bucket NAME --destination-region REGION --destination-owner ACCOUNT --output FILE [--checksum]
  node scripts/storage-migration.mjs copy --manifest FILE --checkpoint FILE [--execute --acknowledge-source-read --acknowledge-s3-write]
  node scripts/storage-migration.mjs reconcile --manifest FILE [--checkpoint FILE]
  node scripts/storage-migration.mjs report --manifest FILE --source-snapshot FILE --destination-snapshot FILE

Dry-run is the default. No command deletes or overwrites objects. Provider commands require explicit
TRACEPOINT_MIGRATION_ENVIRONMENT, TRACEPOINT_MIGRATION_SUPABASE_URL, and
TRACEPOINT_MIGRATION_SUPABASE_SERVICE_ROLE_KEY values. Copy execution additionally requires
TRACEPOINT_STORAGE_MIGRATION_APPROVAL=<manifestId>.`;
}

export function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const values = {};
  const flags = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const next = tokens[index + 1];
    if (next && !next.startsWith("--")) {
      if (values[token] !== undefined) throw new Error(`Duplicate argument: ${token}`);
      values[token] = next;
      index += 1;
    } else {
      if (flags.has(token)) throw new Error(`Duplicate flag: ${token}`);
      flags.add(token);
    }
  }
  return { command, values, flags };
}

function required(values, name) {
  const value = values[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function projectRefFromUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TRACEPOINT_MIGRATION_SUPABASE_URL must be an HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("TRACEPOINT_MIGRATION_SUPABASE_URL must be a bare HTTPS project URL");
  const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname);
  if (!match) throw new Error("TRACEPOINT_MIGRATION_SUPABASE_URL must use the expected Supabase project hostname");
  return match[1];
}

export function assertEnvironmentSafeguards({ environment, sourceProjectRef, destinationOwner, execute = false, flags = new Set(), env = process.env, manifestId }) {
  if (!environment || env.TRACEPOINT_MIGRATION_ENVIRONMENT !== environment) throw new Error("TRACEPOINT_MIGRATION_ENVIRONMENT must exactly match the requested environment");
  if (!sourceProjectRef || projectRefFromUrl(env.TRACEPOINT_MIGRATION_SUPABASE_URL ?? "") !== sourceProjectRef) throw new Error("Supabase project URL does not match the expected source project ref");
  if (!/^\d{12}$/.test(destinationOwner ?? "")) throw new Error("An explicit 12-digit destination owner is required");
  if (!env.TRACEPOINT_MIGRATION_SUPABASE_SERVICE_ROLE_KEY) throw new Error("TRACEPOINT_MIGRATION_SUPABASE_SERVICE_ROLE_KEY is required");
  if (execute) {
    if (!flags.has("--acknowledge-source-read") || !flags.has("--acknowledge-s3-write")) throw new Error("Copy execution requires both source-read and S3-write acknowledgements");
    if (!manifestId || env.TRACEPOINT_STORAGE_MIGRATION_APPROVAL !== manifestId) throw new Error("TRACEPOINT_STORAGE_MIGRATION_APPROVAL must exactly match the manifest ID");
  }
}

async function writeJsonAtomic(file, value) {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, absolute);
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

function sourceClient(env) {
  return createClient(env.TRACEPOINT_MIGRATION_SUPABASE_URL, env.TRACEPOINT_MIGRATION_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function listSupabaseBucket(client, bucket, departmentId) {
  const objects = [];
  const pending = [departmentId];
  const visited = new Set();
  while (pending.length) {
    const directory = pending.pop();
    if (visited.has(directory)) throw new Error("Source inventory contains a directory cycle");
    visited.add(directory);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const result = await client.storage.from(bucket).list(directory, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
      if (result.error) throw new Error(`Source inventory failed for ${bucket}`);
      for (const item of result.data ?? []) {
        if (!item.name || item.name === "." || item.name === ".." || item.name.includes("/") || item.name.includes("\\")) throw new Error("Source inventory returned an unsafe name");
        const key = `${directory}/${item.name}`;
        if (item.id) {
          const bytes = Number(item.metadata?.size);
          if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_OBJECT_BYTES) throw new Error(`Source object size is outside the migration bound: ${key}`);
          objects.push({ bucket, key, bytes, contentType: item.metadata?.mimetype || "application/octet-stream", ...(item.updated_at ? { updatedAt: item.updated_at } : {}), ...(item.metadata?.eTag ? { etag: item.metadata.eTag } : {}) });
          if (objects.length > MAX_OBJECTS) throw new Error("Source inventory exceeds the object-count safety bound");
        } else {
          pending.push(key);
        }
      }
      if ((result.data ?? []).length < PAGE_SIZE) break;
    }
  }
  return objects;
}

async function readSourceObject(client, source, expectedBytes) {
  const result = await client.storage.from(source.bucket).download(source.key);
  if (result.error || !result.data) throw new Error(`Source download failed: ${source.bucket}/${source.key}`);
  if (result.data.size !== expectedBytes || result.data.size > MAX_OBJECT_BYTES) throw new Error(`Source size changed: ${source.bucket}/${source.key}`);
  return new Uint8Array(await result.data.arrayBuffer());
}

function createS3Adapter(client, manifest) {
  const base = { Bucket: manifest.destination.bucket, ExpectedBucketOwner: manifest.destination.expectedOwner };
  return {
    async read(key) {
      try {
        const output = await client.send(new GetObjectCommand({ ...base, Key: key, ChecksumMode: "ENABLED" }));
        if (!output.Body || !Number.isSafeInteger(output.ContentLength) || output.ContentLength > MAX_OBJECT_BYTES) {
          output.Body?.destroy?.();
          throw new Error(`Destination size is outside the migration bound: ${key}`);
        }
        return new Uint8Array(await output.Body.transformToByteArray());
      } catch (error) {
        if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async create({ key, bytes, contentType, checksumSha256Base64, metadata }) {
      try {
        await client.send(new PutObjectCommand({
          ...base,
          Key: key,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: contentType,
          ChecksumSHA256: checksumSha256Base64,
          IfNoneMatch: "*",
          Metadata: metadata,
        }));
      } catch (error) {
        if (error?.name !== "PreconditionFailed" && error?.$metadata?.httpStatusCode !== 412) throw error;
      }
    },
  };
}

async function listS3Department(client, manifest) {
  const objects = [];
  for (const Prefix of [`attachments/${manifest.departmentId}/`, `department-assets/${manifest.departmentId}/`]) {
    let ContinuationToken;
    do {
      const output = await client.send(new ListObjectsV2Command({
        Bucket: manifest.destination.bucket,
        ExpectedBucketOwner: manifest.destination.expectedOwner,
        Prefix,
        ContinuationToken,
      }));
      for (const object of output.Contents ?? []) {
        if (!object.Key || !Number.isSafeInteger(object.Size)) throw new Error("Destination inventory returned incomplete metadata");
        objects.push({ key: object.Key, bytes: object.Size });
        if (objects.length > MAX_OBJECTS) throw new Error("Destination inventory exceeds the object-count safety bound");
      }
      ContinuationToken = output.IsTruncated ? output.NextContinuationToken : undefined;
      if (output.IsTruncated && !ContinuationToken) throw new Error("Destination inventory pagination token is missing");
    } while (ContinuationToken);
  }
  return objects;
}

async function hydrateChecksums(objects, read) {
  const hydrated = [];
  for (const object of objects) {
    const bytes = await read(object);
    if (!(bytes instanceof Uint8Array)) throw new Error(`Object disappeared during checksum inventory: ${object.key ?? "unknown"}`);
    hydrated.push({ ...object, sha256: sha256(bytes) });
  }
  return hydrated;
}

async function inventoryCommand(parsed, env) {
  const departmentId = required(parsed.values, "--department");
  if (!UUID.test(departmentId)) throw new Error("--department must be a UUID");
  const environment = required(parsed.values, "--environment");
  const sourceProjectRef = required(parsed.values, "--source-project-ref");
  const destination = {
    bucket: required(parsed.values, "--destination-bucket"),
    region: required(parsed.values, "--destination-region"),
    expectedOwner: required(parsed.values, "--destination-owner"),
  };
  assertEnvironmentSafeguards({ environment, sourceProjectRef, destinationOwner: destination.expectedOwner, flags: parsed.flags, env });
  const client = sourceClient(env);
  let objects = [
    ...(await listSupabaseBucket(client, "tracepoint-attachments", departmentId)),
    ...(await listSupabaseBucket(client, "department-assets", departmentId)),
  ];
  if (parsed.flags.has("--checksum")) objects = await hydrateChecksums(objects, (object) => readSourceObject(client, object, object.bytes));
  const manifest = createDepartmentManifest({ departmentId, environment, sourceProjectRef, destination, objects });
  await writeJsonAtomic(required(parsed.values, "--output"), manifest);
  return { command: "inventory", readOnly: true, checksumContentReads: parsed.flags.has("--checksum"), manifestId: manifest.manifestId, objects: manifest.objects.length };
}

async function loadGuardedManifest(parsed, env) {
  const manifest = validateManifest(await readJson(required(parsed.values, "--manifest")));
  assertEnvironmentSafeguards({
    environment: manifest.environment,
    sourceProjectRef: manifest.source.projectRef,
    destinationOwner: manifest.destination.expectedOwner,
    execute: parsed.flags.has("--execute"),
    flags: parsed.flags,
    env,
    manifestId: manifest.manifestId,
  });
  return manifest;
}

async function copyCommand(parsed, env) {
  const manifest = await loadGuardedManifest(parsed, env);
  if (manifest.objects.some((object) => !object.sha256)) throw new Error("Copy requires a checksum-complete manifest created with --checksum");
  const checkpointFile = required(parsed.values, "--checkpoint");
  const checkpoint = await loadCheckpoint(checkpointFile, manifest);
  const supabase = sourceClient(env);
  const s3 = new S3Client({ region: manifest.destination.region, maxAttempts: 5 });
  const manifestBySource = new Map(manifest.objects.map((object) => [`${object.source.bucket}/${object.source.key}`, object]));
  try {
    return await migrateDepartment({
      manifest,
      source: { read: (source) => {
        const object = manifestBySource.get(`${source.bucket}/${source.key}`);
        if (!object) throw new Error("Source object is outside the manifest");
        return readSourceObject(supabase, source, object.bytes);
      } },
      destination: createS3Adapter(s3, manifest),
      checkpoint,
      saveCheckpoint: (value) => writeCheckpoint(checkpointFile, value),
      execute: parsed.flags.has("--execute"),
    });
  } finally {
    s3.destroy();
  }
}

async function reconcileCommand(parsed, env) {
  const manifest = await loadGuardedManifest(parsed, env);
  if (manifest.objects.some((object) => !object.sha256)) throw new Error("Reconciliation requires a checksum-complete manifest");
  const supabase = sourceClient(env);
  const s3 = new S3Client({ region: manifest.destination.region, maxAttempts: 5 });
  try {
    const adapter = createS3Adapter(s3, manifest);
    const sourceInventory = [
      ...(await listSupabaseBucket(supabase, "tracepoint-attachments", manifest.departmentId)),
      ...(await listSupabaseBucket(supabase, "department-assets", manifest.departmentId)),
    ];
    const sourceObjects = await hydrateChecksums(sourceInventory, (object) => readSourceObject(supabase, object, object.bytes));
    const destinationInventory = await listS3Department(s3, manifest);
    const destinationObjects = await hydrateChecksums(destinationInventory, (object) => adapter.read(object.key));
    return buildReconciliationReport({ manifest, sourceObjects, destinationObjects });
  } finally {
    s3.destroy();
  }
}

async function reportCommand(parsed) {
  const manifest = validateManifest(await readJson(required(parsed.values, "--manifest")));
  const sourceObjects = await readJson(required(parsed.values, "--source-snapshot"));
  const destinationObjects = await readJson(required(parsed.values, "--destination-snapshot"));
  if (!Array.isArray(sourceObjects) || !Array.isArray(destinationObjects)) throw new Error("Snapshot files must contain arrays");
  return buildReconciliationReport({ manifest, sourceObjects, destinationObjects });
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (!argv.length || argv.includes("--help")) return { help: usage() };
  const parsed = parseArguments(argv);
  if (parsed.command === "inventory") return inventoryCommand(parsed, env);
  if (parsed.command === "copy") return copyCommand(parsed, env);
  if (parsed.command === "reconcile") return reconcileCommand(parsed, env);
  if (parsed.command === "report") return reportCommand(parsed);
  throw new Error(`Unknown command: ${parsed.command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((result) => {
    if (result.help) process.stdout.write(`${result.help}\n`);
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.dryRun && !result.complete) process.exitCode = 2;
    if (result.clean === false) process.exitCode = 2;
  }).catch((error) => {
    process.stderr.write(`Storage migration stopped safely: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
