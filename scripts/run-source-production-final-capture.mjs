import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import {
  ARTIFACT_BUCKET, ARTIFACT_KMS_KEY_ARN, FENCE_ATTESTATION_KEY, SOURCE_ORIGIN, STORAGE_BUCKETS,
  attestCompositeEvidence, attestFrozen, buildArtifact, classifyStorageEntry, objectPath, relationUrl,
  sourceRequest, validateCaptureEnvironment,
} from './source-production-final-capture-core.mjs';

// Execute only from the production-pinned capture job after the source fence gate.
const { slot, runId, key } = validateCaptureEnvironment(process.env);
const evidenceVersion = process.env.TRACEPOINT_COMPOSITE_FENCE_VERSION_ID;
const evidenceSha256 = process.env.TRACEPOINT_COMPOSITE_FENCE_SHA256;
assert.match(evidenceVersion ?? '', /^[A-Za-z0-9._-]+$/, 'COMPOSITE_EVIDENCE_VERSION_REQUIRED');
assert.match(evidenceSha256 ?? '', /^[0-9a-f]{64}$/, 'COMPOSITE_EVIDENCE_HASH_REQUIRED');
const secret = process.env.SOURCE_PRODUCTION_SERVICE_KEY;
delete process.env.SOURCE_PRODUCTION_SERVICE_KEY;
delete process.env.SOURCE_PRODUCTION_PROJECT_URL;
const headers = Object.freeze({ apikey: secret, Accept: 'application/json' });

async function request(method, url, label, body) {
  sourceRequest(method, url);
  const response = await fetch(url, { method,
    headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`PRODUCTION_SOURCE_READ_FAILED:${label}:${response.status}`);
  return response;
}

async function frozenState() {
  return (await request('POST', `${SOURCE_ORIGIN}/rest/v1/rpc/tracepoint_source_production_fence_status`,
    'fence-status', {})).json();
}

async function relationRows(relation) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await (await request('GET', relationUrl(relation, offset), relation)).json();
    assert.ok(Array.isArray(page), `INVALID_RELATION_RESPONSE:${relation}`);
    rows.push(...page);
    assert.ok(rows.length <= 1_000_000, 'RELATION_SIZE_BOUND_EXCEEDED');
    if (page.length < 500) return rows;
  }
}

async function allIdentities() {
  const users = [];
  for (let page = 1; ; page += 1) {
    const result = await (await request('GET',
      `${SOURCE_ORIGIN}/auth/v1/admin/users?page=${page}&per_page=200`, 'auth-identities')).json();
    assert.ok(Array.isArray(result.users), 'INVALID_AUTH_RESPONSE');
    users.push(...result.users);
    assert.ok(users.length <= 1_000_000, 'IDENTITY_SIZE_BOUND_EXCEEDED');
    if (result.users.length < 200 || (result.last_page && page >= result.last_page)) return users;
  }
}

async function storageEntries(bucket, prefix, offset) {
  const response = await request('POST', `${SOURCE_ORIGIN}/storage/v1/object/list/${bucket}`,
    `storage-list:${bucket}`, { prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
  const entries = await response.json();
  assert.ok(Array.isArray(entries), 'INVALID_STORAGE_LIST_RESPONSE');
  return entries;
}

async function allObjects(departmentIds) {
  const objects = [];
  for (const bucket of STORAGE_BUCKETS) {
    const queue = [''];
    const seenPrefixes = new Set();
    while (queue.length) {
      const prefix = queue.shift();
      assert.ok(!seenPrefixes.has(prefix), 'DUPLICATE_STORAGE_FOLDER');
      seenPrefixes.add(prefix);
      assert.ok(seenPrefixes.size <= 10_000, 'STORAGE_FOLDER_BOUND_EXCEEDED');
      for (let offset = 0; ; offset += 100) {
        const entries = await storageEntries(bucket, prefix, offset);
        for (const entry of entries) {
          const item = classifyStorageEntry(prefix, entry);
          if (item.kind === 'folder') { queue.push(item.prefix); continue; }
          const response = await request('GET', objectPath(bucket, item.key), `storage-object:${bucket}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          const departmentId = bucket === 'department-assets' ? item.key.split('/')[0] : null;
          if (departmentId !== null) assert.ok(departmentIds.has(departmentId), 'STORAGE_TENANT_MISMATCH');
          objects.push({ sourceBucket: bucket, sourceKey: item.key, destinationKey: `${bucket}/${item.key}`,
            bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
            contentType: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream', departmentId });
          assert.ok(objects.length <= 100_000, 'STORAGE_OBJECT_BOUND_EXCEEDED');
        }
        if (entries.length < 100) break;
      }
    }
  }
  return objects.sort((a, b) => a.destinationKey.localeCompare(b.destinationKey));
}

const s3 = new S3Client({ region: 'us-east-1', maxAttempts: 1 });
async function compositeEvidence(fenceChangedAt) {
  const result = await s3.send(new GetObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: FENCE_ATTESTATION_KEY,
    VersionId: evidenceVersion, ExpectedBucketOwner: '193644343389' }));
  assert.equal(result.VersionId, evidenceVersion, 'COMPOSITE_EVIDENCE_VERSION_MISMATCH');
  const bytes = await result.Body.transformToByteArray();
  assert.equal(createHash('sha256').update(bytes).digest('hex'), evidenceSha256, 'COMPOSITE_EVIDENCE_HASH_MISMATCH');
  attestCompositeEvidence(JSON.parse(Buffer.from(bytes).toString('utf8')), fenceChangedAt);
}

const firstFreeze = attestFrozen(await frozenState());
await compositeEvidence(firstFreeze);
const rowsByRelation = new Map();
for (const relation of MIGRATION_RELATIONS) rowsByRelation.set(relation, await relationRows(relation));
const identities = await allIdentities();
const departmentIds = new Set(rowsByRelation.get('departments').map(row => row.id));
const objects = await allObjects(departmentIds);
const secondFreeze = attestFrozen(await frozenState());
assert.equal(secondFreeze, firstFreeze, 'PRODUCTION_FENCE_CHANGED_DURING_CAPTURE');
await compositeEvidence(secondFreeze);
const artifact = buildArtifact({ runId, capturedAtUtc: new Date().toISOString(),
  fenceChangedAt: firstFreeze, rowsByRelation, identities, objects });
try {
  const put = await s3.send(new PutObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: key,
    ExpectedBucketOwner: '193644343389', Body: artifact.payload,
    ContentType: 'application/json', ServerSideEncryption: 'aws:kms', SSEKMSKeyId: ARTIFACT_KMS_KEY_ARN,
    ChecksumSHA256: createHash('sha256').update(artifact.payload).digest('base64'), IfNoneMatch: '*' }));
  assert.ok(put.VersionId, 'ARTIFACT_VERSION_REQUIRED');
  const readback = await s3.send(new GetObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: key,
    VersionId: put.VersionId, ExpectedBucketOwner: '193644343389' }));
  const bytes = await readback.Body.transformToByteArray();
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.byteSha256, 'ARTIFACT_READBACK_HASH_MISMATCH');
  console.log(JSON.stringify({ status: 'PRODUCTION_FROZEN_SOURCE_CAPTURE_CREATED', slot, bucket: ARTIFACT_BUCKET,
    key, versionId: put.VersionId, byteSha256: artifact.byteSha256, masterSha256: artifact.masterSha256,
    relationContracts: artifact.body.tables.length, totalRelationalRows: artifact.body.totalRelationalRows,
    identities: artifact.body.identities.count, memberships: artifact.body.memberships.count,
    objects: artifact.body.objects.count, objectBytes: artifact.body.objects.totalBytes,
    sourceProjectRef: 'izlkwggluhlhzlumtzes', fenceStable: true,
    compositeEvidenceKey: FENCE_ATTESTATION_KEY, compositeEvidenceVersion: evidenceVersion,
    compositeEvidenceSha256: evidenceSha256, rowPayloadsLogged: false }));
} finally { s3.destroy(); }
