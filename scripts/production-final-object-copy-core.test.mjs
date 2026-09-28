import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ARTIFACT_KMS_KEY_ARN } from './source-production-final-capture-core.mjs';
import { copyProductionFinalObjects } from './production-final-object-copy-core.mjs';

const departmentId = '1d0e2994-4224-4237-8328-71020ba20027';
const bytes = Uint8Array.of(1, 2, 3);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const object = { sourceBucket: 'department-assets', sourceKey: `${departmentId}/patch-123.jpg`,
  destinationKey: `department-assets/${departmentId}/patch-123.jpg`,
  archiveKey: `migration/source/c7448ea9-4645-4e99-b988-3a05de12ac70/objects/department-assets/${departmentId}/patch-123.jpg`,
  archiveVersionId: 'archive.version', bytes: 3, sha256, contentType: 'image/jpeg', departmentId };

function client(extra = []) {
  const state = new Map([[object.archiveKey, { bytes, version: object.archiveVersionId,
    metadata: { 'tracepoint-department-id': departmentId } }],
    ...extra.map(key => [key, { bytes, version: 'extra.version' }])]);
  return { state, send: async command => {
    const name = command.constructor.name, input = command.input;
    if (name === 'GetBucketVersioningCommand') return { Status: 'Enabled' };
    if (name === 'GetPublicAccessBlockCommand') return { PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } };
    if (name === 'GetBucketEncryptionCommand') return { ServerSideEncryptionConfiguration: { Rules: [{
      ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: ARTIFACT_KMS_KEY_ARN } }] } };
    if (name === 'ListObjectsV2Command') return { Contents: [...state.keys()]
      .filter(key => key.startsWith(input.Prefix)).map(Key => ({ Key })) };
    if (name === 'GetObjectCommand') {
      const item = state.get(input.Key);
      assert.ok(item);
      return { VersionId: item.version, ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: ARTIFACT_KMS_KEY_ARN, ContentType: 'image/jpeg', Metadata: item.metadata,
        Body: { transformToByteArray: async () => item.bytes } };
    }
    if (name === 'PutObjectCommand') {
      assert.equal(input.IfNoneMatch, '*');
      assert.equal(input.ServerSideEncryption, 'aws:kms');
      if (state.has(input.Key)) throw Object.assign(new Error('precondition'), { name: 'PreconditionFailed' });
      state.set(input.Key, { bytes: input.Body, version: 'target.version', metadata: input.Metadata });
      return { VersionId: 'target.version' };
    }
    throw new Error(`Unexpected command ${name}`);
  } };
}

test('version-pinned archive bytes copy create-only into private KMS target and reconcile inventory', async () => {
  const s3 = client();
  const result = await copyProductionFinalObjects(s3, [object]);
  assert.equal(result.copiedOrVerified, 1);
  assert.equal(result.missing, 0);
  assert.ok(s3.state.has(object.destinationKey));
  assert.equal((await copyProductionFinalObjects(s3, [object])).results[0].status, 'existing-and-verified');
});

test('unexpected target object fails before any copy', async () => {
  const s3 = client([`department-assets/${departmentId}/unexpected.jpg`]);
  await assert.rejects(copyProductionFinalObjects(s3, [object]), /FINAL_OBJECT_TARGET_EXTRA_BEFORE_COPY/);
  assert.equal(s3.state.has(object.destinationKey), false);
});

test('archive byte mismatch fails without creating a target object', async () => {
  const s3 = client();
  s3.state.get(object.archiveKey).bytes = Uint8Array.of(9, 9, 9);
  await assert.rejects(copyProductionFinalObjects(s3, [object]), /FINAL_OBJECT_CONTENT_HASH_MISMATCH/);
  assert.equal(s3.state.has(object.destinationKey), false);
});

test('tenant metadata mismatch fails before target copy', async () => {
  const s3 = client();
  s3.state.get(object.archiveKey).metadata = { 'tracepoint-department-id': 'another-department' };
  await assert.rejects(copyProductionFinalObjects(s3, [object]), /FINAL_OBJECT_DEPARTMENT_METADATA_MISMATCH/);
  assert.equal(s3.state.has(object.destinationKey), false);
});
