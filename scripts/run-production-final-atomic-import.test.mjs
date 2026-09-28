import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_RUN_IDS, ARTIFACT_BUCKET, ARTIFACT_KMS_KEY_ARN } from './source-production-final-capture-core.mjs';
import { FINAL_RDS_HOST, FINAL_RDS_RESOURCE_ID } from './production-final-import-core.mjs';
import { loadPinnedCapture, validateFinalImportEnvironment } from './run-production-final-atomic-import.mjs';

const env = {
  TRACEPOINT_FINAL_IMPORT_EXECUTE: 'capture-b-to-final-rds-v1',
  TRACEPOINT_EXPECTED_AWS_ACCOUNT: '193644343389',
  TRACEPOINT_EXPECTED_AWS_REGION: 'us-east-1',
  TRACEPOINT_TARGET_RESOURCE_ID: FINAL_RDS_RESOURCE_ID,
  TARGET_PGHOST: FINAL_RDS_HOST,
  TRACEPOINT_FINAL_CAPTURE_A_VERSION_ID: 'A.version',
  TRACEPOINT_FINAL_CAPTURE_A_BYTE_SHA256: 'a'.repeat(64),
  TRACEPOINT_FINAL_CAPTURE_B_VERSION_ID: 'B.version',
  TRACEPOINT_FINAL_CAPTURE_B_BYTE_SHA256: 'b'.repeat(64),
  TARGET_DATABASE_SECRET_JSON: JSON.stringify({ host: FINAL_RDS_HOST, port: 5432,
    dbname: 'tracepoint', username: 'test_migrator', password: 'test-only' }),
};

test('requires both immutable versions, hashes and exact final target before any client', () => {
  const result = validateFinalImportEnvironment(env);
  assert.equal(result.slots.B.key, `migration/source/${APPROVED_RUN_IDS.B}/final-canonical.json`);
  assert.equal(result.slots.B.bucket, ARTIFACT_BUCKET);
  assert.throws(() => validateFinalImportEnvironment({ ...env, TRACEPOINT_TARGET_RESOURCE_ID: 'wrong' }),
    /FINAL_IMPORT_RESOURCE_REQUIRED/);
  assert.throws(() => validateFinalImportEnvironment({ ...env, TRACEPOINT_FINAL_CAPTURE_B_VERSION_ID: '' }),
    /FINAL_IMPORT_B_VERSION_REQUIRED/);
  assert.throws(() => validateFinalImportEnvironment({ ...env, TARGET_DATABASE_SECRET_JSON:
    JSON.stringify({ host: 'rehearsal.invalid', port: 5432, dbname: 'tracepoint', username: 'x', password: 'y' }) }),
  /FINAL_IMPORT_SECRET_HOST_UNAPPROVED/);
});

test('S3 retrieval pins version, bucket owner and KMS key', async () => {
  const spec = validateFinalImportEnvironment(env).slots.B;
  let command;
  const s3 = { send: async request => { command = request; return {
    VersionId: spec.versionId, ServerSideEncryption: 'aws:kms', SSEKMSKeyId: ARTIFACT_KMS_KEY_ARN,
    Body: { transformToByteArray: async () => Uint8Array.of(1, 2) },
  }; } };
  const loaded = await loadPinnedCapture(s3, spec);
  assert.deepEqual([...loaded.bytes], [1, 2]);
  assert.equal(command.input.ExpectedBucketOwner, '193644343389');
  assert.equal(command.input.VersionId, spec.versionId);
  await assert.rejects(loadPinnedCapture({ send: async () => ({ VersionId: 'wrong',
    ServerSideEncryption: 'aws:kms', SSEKMSKeyId: ARTIFACT_KMS_KEY_ARN }) }, spec),
  /FINAL_IMPORT_S3_VERSION_CHANGED/);
});
