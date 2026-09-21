import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { MIGRATION_ARTIFACT_BUCKET, MIGRATION_ARTIFACT_KEY, MIGRATION_ARTIFACT_KMS_KEY_ARN, MIGRATION_RELATIONS, SOURCE_OBJECT_MANIFEST, assertReadOnlyRequest, assertSourceObjectRequest, canonical, relationUrl, sha256, sourceObjectUrl, usersUrl, validateInvocation, validateSourceSecret } from "./supabase-rest-ledger-core.mjs";

validateInvocation(process.env);
const rawSecret = process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
delete process.env.SOURCE_SUPABASE_REST_SECRET_JSON;
assert.ok(rawSecret, "Dedicated REST source credential was not injected");
const source = validateSourceSecret(JSON.parse(rawSecret));
// Do not retain a second plaintext reference once headers have been constructed.
const headers = Object.freeze({ apikey: source.serviceRoleKey, Authorization: `Bearer ${source.serviceRoleKey}`, Accept: "application/json" });
source.serviceRoleKey = undefined;

async function get(url, sourceLabel) {
  assertReadOnlyRequest("GET", url);
  const response = await fetch(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
  // Labels are fixed contract relation names only; response bodies remain unread
  // so malformed-query diagnosis cannot expose source records or credentials.
  if (!response.ok) throw new Error(`SOURCE_REST_GET_FAILED:${sourceLabel}:${response.status}`);
  return response.json();
}

async function allRows(relation) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await get(relationUrl(relation, offset), relation);
    assert.ok(Array.isArray(page), "Source relation response is not an array");
    rows.push(...page);
    if (page.length < 500) return rows;
    assert.ok(rows.length <= 1_000_000, "Source relation exceeds safe extraction bound");
  }
}

async function allUsers() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const payload = await get(usersUrl(page), 'admin-identities');
    assert.ok(Array.isArray(payload.users), "Admin identities response is invalid");
    users.push(...payload.users);
    if (payload.users.length < 200 || (payload.last_page && page >= payload.last_page)) return users;
    assert.ok(users.length <= 1_000_000, "Source identities exceed safe extraction bound");
  }
}

async function refreshObjects() {
  const objects = [];
  for (const object of SOURCE_OBJECT_MANIFEST) {
    const url = sourceObjectUrl(object);
    assertSourceObjectRequest("GET", url, object);
    const response = await fetch(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`SOURCE_OBJECT_GET_FAILED:${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(bytes.byteLength, object.bytes, "SOURCE_OBJECT_SIZE_MISMATCH");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), object.sha256, "SOURCE_OBJECT_SHA256_MISMATCH");
    objects.push(object);
  }
  return objects;
}

const rowsByRelation = new Map();
for (const relation of MIGRATION_RELATIONS) rowsByRelation.set(relation, await allRows(relation));
const users = await allUsers();
const objects = await refreshObjects();
const memberships = rowsByRelation.get("department_memberships") ?? [];
const capturedAtUtc = new Date().toISOString();
const tables = [...rowsByRelation].map(([name, rows]) => ({ name, rows: rows.length, canonicalDataSha256: sha256(rows) }));
const body = { format: "tracepoint-immutable-source-artifact/v1", runId: process.env.TRACEPOINT_MIGRATION_RUN_ID, authorizationReference: process.env.TRACEPOINT_MIGRATION_AUTHORIZATION_REFERENCE, capturedAtUtc, source: { provider: "supabase-rest-admin", readOnlyMethods: ["GET"], relationContract: [...MIGRATION_RELATIONS] }, tables, totalRelationalRows: tables.reduce((total, table) => total + table.rows, 0), identities: { count: users.length, canonicalDataSha256: sha256(users), rows: users }, memberships: { count: memberships.length, canonicalDataSha256: sha256(memberships) }, objects: { count: objects.length, totalBytes: objects.reduce((total, object) => total + object.bytes, 0), manifestSha256: sha256(objects), manifest: objects }, rows: Object.fromEntries(rowsByRelation) };
const masterSha256 = sha256(body);
const payload = canonical({ ...body, masterSha256 });
const s3 = new S3Client({ region: "us-east-1", maxAttempts: 1 });
try {
  await s3.send(new PutObjectCommand({ Bucket: MIGRATION_ARTIFACT_BUCKET, Key: MIGRATION_ARTIFACT_KEY, ExpectedBucketOwner: "193644343389", Body: payload, ContentType: "application/json", ServerSideEncryption: "aws:kms", SSEKMSKeyId: MIGRATION_ARTIFACT_KMS_KEY_ARN, ChecksumSHA256: createHash("sha256").update(payload).digest("base64"), IfNoneMatch: "*" }));
  console.log(JSON.stringify({ status: "SOURCE_ARTIFACT_CREATED", runId: body.runId, authorizationReference: body.authorizationReference, artifact: { bucket: MIGRATION_ARTIFACT_BUCKET, key: MIGRATION_ARTIFACT_KEY, masterSha256 }, tables, totalRelationalRows: body.totalRelationalRows, identities: { count: body.identities.count, canonicalDataSha256: body.identities.canonicalDataSha256 }, memberships: body.memberships, objects: { count: body.objects.count, totalBytes: body.objects.totalBytes, manifestSha256: body.objects.manifestSha256 }, sourceRecordsEmitted: false, targetClientsInitialized: false }));
} finally { s3.destroy(); }
