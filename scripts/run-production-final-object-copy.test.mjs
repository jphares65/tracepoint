import test from 'node:test';
import assert from 'node:assert/strict';
import { FINAL_RDS_HOST, FINAL_RDS_RESOURCE_ID } from './production-final-import-core.mjs';
import { validateFinalObjectCopyEnvironment, verifyFinalObjectReferences } from './run-production-final-object-copy.mjs';

const env = {
  TRACEPOINT_FINAL_OBJECT_COPY_EXECUTE: 'capture-b-objects-to-final-s3-v1',
  TRACEPOINT_EXPECTED_AWS_ACCOUNT: '193644343389',
  TRACEPOINT_TARGET_RESOURCE_ID: FINAL_RDS_RESOURCE_ID,
  TARGET_PGHOST: FINAL_RDS_HOST,
  TRACEPOINT_FINAL_CAPTURE_A_VERSION_ID: 'a.version',
  TRACEPOINT_FINAL_CAPTURE_A_BYTE_SHA256: 'a'.repeat(64),
  TRACEPOINT_FINAL_CAPTURE_B_VERSION_ID: 'b.version',
  TRACEPOINT_FINAL_CAPTURE_B_BYTE_SHA256: 'b'.repeat(64),
  TRACEPOINT_FINAL_OBJECT_ARCHIVE_B_VERSION_ID: 'archive.version',
  TRACEPOINT_FINAL_OBJECT_ARCHIVE_B_BYTE_SHA256: 'c'.repeat(64),
  TARGET_DATABASE_SECRET_JSON: JSON.stringify({ host: FINAL_RDS_HOST, port: 5432,
    dbname: 'tracepoint', username: 'test', password: 'test-only' }),
};

test('object copier requires capture B sidecar and exact final database', () => {
  const result = validateFinalObjectCopyEnvironment(env);
  assert.match(result.archive.key, /object-archive\.json$/);
  assert.throws(() => validateFinalObjectCopyEnvironment({ ...env,
    TRACEPOINT_FINAL_OBJECT_ARCHIVE_B_VERSION_ID: '' }), /FINAL_OBJECT_ARCHIVE_VERSION_REQUIRED/);
  assert.throws(() => validateFinalObjectCopyEnvironment({ ...env,
    TARGET_DATABASE_SECRET_JSON: JSON.stringify({ host: 'rehearsal.invalid', port: 5432,
      dbname: 'tracepoint', username: 'test', password: 'test-only' }) }),
  /FINAL_OBJECT_SECRET_HOST_UNAPPROVED/);
});

test('reference reconciliation rejects a stale Supabase patch URL on the target', async () => {
  const departmentId = '1d0e2994-4224-4237-8328-71020ba20027';
  const source = { id: departmentId,
    patch_url: `https://izlkwggluhlhzlumtzes.supabase.co/storage/v1/object/public/department-assets/${departmentId}/patch-123.jpg` };
  const manifest = [{ sourceBucket: 'department-assets', sourceKey: `${departmentId}/patch-123.jpg`,
    destinationKey: `department-assets/${departmentId}/patch-123.jpg`, departmentId }];
  const artifact = { rows: Object.fromEntries([
    ['departments', [source]], ['profiles', []], ['equipment_assets', []],
    ['training_certifications', []], ['fleet_vehicle_documents', []],
    ['attachments', []], ['drill_documents', []], ['range_packets', []],
  ]) };
  const client = { query: async sql => ({ rows: sql.includes('"departments"') ? [{ row: source }] : [] }) };
  await assert.rejects(verifyFinalObjectReferences(client, artifact, manifest),
    /FINAL_OBJECT_REFERENCE_STALE_SOURCE:departments/);
});
