import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GetBucketEncryptionCommand, GetBucketVersioningCommand, GetObjectCommand,
  GetPublicAccessBlockCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { ARTIFACT_BUCKET, ARTIFACT_KMS_KEY_ARN } from './source-production-final-capture-core.mjs';

const ACCOUNT = '193644343389';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function keysUnder(s3, prefix) {
  const keys = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: ARTIFACT_BUCKET, Prefix: prefix,
      ExpectedBucketOwner: ACCOUNT, ...(token ? { ContinuationToken: token } : {}) }));
    keys.push(...(page.Contents ?? []).map(item => item.Key));
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

async function readAndVerify(s3, key, expected, versionId) {
  const response = await s3.send(new GetObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: key,
    ExpectedBucketOwner: ACCOUNT, ChecksumMode: 'ENABLED',
    ...(versionId ? { VersionId: versionId } : {}) }));
  if (versionId) assert.equal(response.VersionId, versionId, 'FINAL_OBJECT_VERSION_CHANGED');
  assert.equal(response.ServerSideEncryption, 'aws:kms', 'FINAL_OBJECT_ENCRYPTION_MISMATCH');
  assert.equal(response.SSEKMSKeyId, ARTIFACT_KMS_KEY_ARN, 'FINAL_OBJECT_KMS_MISMATCH');
  assert.equal(response.ContentType, expected.contentType, 'FINAL_OBJECT_CONTENT_TYPE_MISMATCH');
  if (expected.departmentId) assert.equal(response.Metadata?.['tracepoint-department-id'],
    expected.departmentId, 'FINAL_OBJECT_DEPARTMENT_METADATA_MISMATCH');
  const bytes = await response.Body.transformToByteArray();
  assert.equal(bytes.length, expected.bytes, 'FINAL_OBJECT_SIZE_MISMATCH');
  assert.equal(sha256(bytes), expected.sha256, 'FINAL_OBJECT_CONTENT_HASH_MISMATCH');
  return bytes;
}

/** Idempotent, create-only copy of version-pinned capture B object bytes. */
export async function copyProductionFinalObjects(s3, mapped, excludedDestinationKeys = []) {
  assert.ok(Array.isArray(mapped), 'FINAL_OBJECT_MANIFEST_REQUIRED');
  assert.equal(new Set(mapped.map(item => item.destinationKey)).size, mapped.length,
    'FINAL_OBJECT_DESTINATION_DUPLICATE');
  assert.equal(new Set(excludedDestinationKeys).size, excludedDestinationKeys.length,
    'FINAL_OBJECT_EXCLUSION_DUPLICATE');
  const [versioning, publicBlock, encryption] = await Promise.all([
    s3.send(new GetBucketVersioningCommand({ Bucket: ARTIFACT_BUCKET, ExpectedBucketOwner: ACCOUNT })),
    s3.send(new GetPublicAccessBlockCommand({ Bucket: ARTIFACT_BUCKET, ExpectedBucketOwner: ACCOUNT })),
    s3.send(new GetBucketEncryptionCommand({ Bucket: ARTIFACT_BUCKET, ExpectedBucketOwner: ACCOUNT })),
  ]);
  assert.equal(versioning.Status, 'Enabled', 'FINAL_OBJECT_BUCKET_UNVERSIONED');
  for (const field of ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'])
    assert.equal(publicBlock.PublicAccessBlockConfiguration?.[field], true, `FINAL_OBJECT_PUBLIC_ACCESS:${field}`);
  assert.ok(encryption.ServerSideEncryptionConfiguration?.Rules?.some(rule =>
    rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm === 'aws:kms' &&
    rule.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID === ARTIFACT_KMS_KEY_ARN),
  'FINAL_OBJECT_BUCKET_KMS_MISMATCH');
  const expected = new Set(mapped.map(item => item.destinationKey));
  const excluded = new Set(excludedDestinationKeys);
  assert.ok([...excluded].every(key => key.startsWith('department-assets/') && !expected.has(key)),
    'FINAL_OBJECT_EXCLUSION_UNAPPROVED');
  const current = [...await keysUnder(s3, 'department-assets/'), ...await keysUnder(s3, 'attachments/')];
  assert.ok(current.every(key => expected.has(key) || excluded.has(key)),
    'FINAL_OBJECT_TARGET_EXTRA_BEFORE_COPY');
  const results = [];
  for (const object of mapped) {
    assert.ok(object.destinationKey.startsWith('department-assets/') ||
      object.destinationKey.startsWith('attachments/'), 'FINAL_OBJECT_DESTINATION_UNAPPROVED');
    assert.equal(object.sourceKey.split('/')[0], object.departmentId, 'FINAL_OBJECT_TENANT_MISMATCH');
    const bytes = await readAndVerify(s3, object.archiveKey, object, object.archiveVersionId);
    let created = true;
    try {
      await s3.send(new PutObjectCommand({ Bucket: ARTIFACT_BUCKET, Key: object.destinationKey,
        ExpectedBucketOwner: ACCOUNT, Body: bytes, ContentLength: bytes.length,
        ContentType: object.contentType, ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: ARTIFACT_KMS_KEY_ARN,
        ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
        Metadata: { 'tracepoint-department-id': object.departmentId }, IfNoneMatch: '*' }));
    } catch (error) {
      if (error?.name !== 'PreconditionFailed' && error?.$metadata?.httpStatusCode !== 412) throw error;
      created = false;
    }
    await readAndVerify(s3, object.destinationKey, object);
    results.push({ status: created ? 'created-and-verified' : 'existing-and-verified',
      bytes: object.bytes, sha256: object.sha256 });
  }
  const after = [...await keysUnder(s3, 'department-assets/'), ...await keysUnder(s3, 'attachments/')];
  assert.deepEqual(after.filter(key => !excluded.has(key)).sort(), [...expected].sort(),
    'FINAL_OBJECT_TARGET_INVENTORY_MISMATCH');
  return { copiedOrVerified: results.length, bytes: results.reduce((sum, item) => sum + item.bytes, 0),
    missing: 0, extra: 0, excludedExisting: after.filter(key => excluded.has(key)).length, results };
}
