// Fixed, AWS-local comparison only. Never prints source rows or object keys.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = 'tracepoint-production-private-193644343389';
const ARTIFACTS = Object.freeze([
  {
    key: 'migration/source-rehearsal/89b71be8-ce63-4a31-a6b8-56f3b56eeba3/final-canonical.json',
    versionId: 'timUK0CE5VbylsiyH7Y_Maur9ly7sDil',
    byteSha256: '9489c048369f49d4d231eca9b12cf9309a9d3cf3cc217a63f9428352ae01d4f6',
    masterSha256: '4fbc63cfcb24ab791616e803f60fe57a8a5da8f10dc1733dd7231c83d8db354b',
  },
  {
    key: 'migration/source-rehearsal/f823a021-46ab-4c00-8465-63cd46192c93/final-canonical.json',
    versionId: 'lFRg96kOSsomvrL6PY4rDjjuruifiZwn',
    byteSha256: 'e51df222bfd22e97ab1163f1ebc478c135822bfeb02dd29cf49cff0f2f0c131d',
    masterSha256: '7b66b2942b470d6acbc13d0dac0372feb855ecb4791c36e7b1b1e74337ff2f9d',
  },
]);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const s3 = new S3Client({ region: 'us-east-1', maxAttempts: 1 });

async function readPinned(spec) {
  const result = await s3.send(new GetObjectCommand({
    Bucket: BUCKET, Key: spec.key, VersionId: spec.versionId,
    ExpectedBucketOwner: '193644343389',
  }));
  assert.equal(result.VersionId, spec.versionId, 'VERSION_MISMATCH');
  const bytes = await result.Body.transformToByteArray();
  assert.equal(sha256(bytes), spec.byteSha256, 'BYTE_HASH_MISMATCH');
  const artifact = JSON.parse(Buffer.from(bytes).toString('utf8'));
  assert.equal(artifact.masterSha256, spec.masterSha256, 'MASTER_HASH_MISMATCH');
  assert.equal(artifact.format, 'tracepoint-immutable-source-artifact/v1', 'FORMAT_MISMATCH');
  assert.equal(artifact.source.projectRef, 'reukdouvpshshvqnzsgw', 'SOURCE_PROJECT_MISMATCH');
  assert.equal(artifact.tables.length, 90, 'RELATION_CONTRACT_COUNT_MISMATCH');
  assert.equal(artifact.totalRelationalRows, 167, 'ROW_COUNT_MISMATCH');
  assert.equal(artifact.identities.count, 1, 'IDENTITY_COUNT_MISMATCH');
  assert.equal(artifact.memberships.count, 1, 'MEMBERSHIP_COUNT_MISMATCH');
  assert.equal(artifact.objects.count, 1, 'OBJECT_COUNT_MISMATCH');
  assert.equal(artifact.objects.totalBytes, 68, 'OBJECT_BYTES_MISMATCH');
  return artifact;
}

(async () => {
  const [prior, frozen] = await Promise.all(ARTIFACTS.map(readPinned));
  const priorTables = new Map(prior.tables.map(table => [table.name, table]));
  const changedRelations = frozen.tables.filter(table => {
    const earlier = priorTables.get(table.name);
    return !earlier || earlier.rows !== table.rows || earlier.canonicalDataSha256 !== table.canonicalDataSha256;
  }).map(table => table.name).sort();
  const identityChanged = prior.identities.canonicalDataSha256 !== frozen.identities.canonicalDataSha256;
  const membershipsChanged = prior.memberships.canonicalDataSha256 !== frozen.memberships.canonicalDataSha256;
  const objectsChanged = prior.objects.manifestSha256 !== frozen.objects.manifestSha256;
  const equivalent = changedRelations.length === 0 && !identityChanged && !membershipsChanged && !objectsChanged;
  console.log(JSON.stringify({
    status: equivalent ? 'FROZEN_CAPTURE_BASELINE_EQUIVALENT' : 'FROZEN_CAPTURE_BASELINE_MISMATCH',
    changedRelations, identityChanged, membershipsChanged, objectsChanged,
    relationContracts: 90, relationalRows: 167, identities: 1, memberships: 1, objects: 1,
    sourceRowPayloadsLogged: false,
  }));
  assert.ok(equivalent, 'FROZEN_CAPTURE_BASELINE_MISMATCH');
})().catch(error => {
  console.error(JSON.stringify({ status: 'FAILED', code: /^[A-Z_]+$/.test(String(error.message)) ? error.message : 'READ_ONLY_COMPARE_FAILED' }));
  process.exitCode = 1;
}).finally(() => s3.destroy());
