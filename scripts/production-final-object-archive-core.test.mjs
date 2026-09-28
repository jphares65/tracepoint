import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_RUN_IDS } from './source-production-final-capture-core.mjs';
import { validateFinalObjectArchive } from './production-final-object-archive-core.mjs';

const departmentId = '1d0e2994-4224-4237-8328-71020ba20027';
const object = { sourceBucket: 'department-assets', sourceKey: `${departmentId}/patch-123.jpg`,
  destinationKey: `department-assets/${departmentId}/patch-123.jpg`,
  bytes: 3, sha256: 'a'.repeat(64), contentType: 'image/jpeg', departmentId };
const archiveKey = `migration/source/${APPROVED_RUN_IDS.B}/objects/${object.sourceBucket}/${object.sourceKey}`;
const artifact = { runId: APPROVED_RUN_IDS.B, masterSha256: 'b'.repeat(64),
  objects: { manifest: [object] } };
const archive = { format: 'tracepoint-final-object-archive/v1', runId: APPROVED_RUN_IDS.B,
  artifactMasterSha256: artifact.masterSha256,
  objects: [{ sourceBucket: object.sourceBucket, sourceKey: object.sourceKey,
    archiveKey, archiveVersionId: 'version-1', bytes: 3, sha256: object.sha256 }] };

test('capture B object archive maps only the same tenant, bytes, hash and immutable version', () => {
  const mapped = validateFinalObjectArchive(archive, artifact);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].archiveVersionId, 'version-1');
});

test('wrong capture, missing archive, hash drift and tenant drift fail closed', () => {
  assert.throws(() => validateFinalObjectArchive({ ...archive, runId: APPROVED_RUN_IDS.A }, artifact),
    /FINAL_OBJECT_ARCHIVE_NOT_CAPTURE_B/);
  assert.throws(() => validateFinalObjectArchive({ ...archive, objects: [] }, artifact),
    /FINAL_OBJECT_ARCHIVE_COUNT_MISMATCH/);
  assert.throws(() => validateFinalObjectArchive({ ...archive, objects: [{ ...archive.objects[0], sha256: 'c'.repeat(64) }] }, artifact),
    /FINAL_OBJECT_ARCHIVE_HASH_MISMATCH/);
  assert.throws(() => validateFinalObjectArchive(archive, { ...artifact, objects: { manifest: [{ ...object,
    departmentId: 'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0' }] } }),
  /FINAL_OBJECT_DEPARTMENT_KEY_MISMATCH/);
});

test('Supabase attachment bucket maps to the existing AWS-native attachments prefix', () => {
  const attachment = { ...object, sourceBucket: 'tracepoint-attachments',
    sourceKey: `${departmentId}/firearm/record/photo.jpg`,
    destinationKey: `attachments/${departmentId}/firearm/record/photo.jpg` };
  const attachmentArchive = { ...archive, objects: [{ ...archive.objects[0],
    sourceBucket: attachment.sourceBucket, sourceKey: attachment.sourceKey,
    archiveKey: `migration/source/${APPROVED_RUN_IDS.B}/objects/tracepoint-attachments/${attachment.sourceKey}` }] };
  assert.equal(validateFinalObjectArchive(attachmentArchive, { ...artifact,
    objects: { manifest: [attachment] } })[0].destinationKey, attachment.destinationKey);
  assert.throws(() => validateFinalObjectArchive(attachmentArchive, { ...artifact,
    objects: { manifest: [{ ...attachment, destinationKey: `tracepoint-attachments/${attachment.sourceKey}` }] } }),
  /FINAL_OBJECT_DESTINATION_MISMATCH/);
});

test('only an explicitly excluded agency patch may be absent; other objects remain mandatory', () => {
  assert.deepEqual(validateFinalObjectArchive({ ...archive, objects: [] }, artifact,
    [object.destinationKey]), []);
  assert.deepEqual(validateFinalObjectArchive(archive, artifact,
    [object.destinationKey]), []);
  assert.throws(() => validateFinalObjectArchive({ ...archive, objects: [] }, artifact,
    ['department-assets/unrelated']), /FINAL_OBJECT_EXCLUSION_NOT_IN_SOURCE/);
  const attachment = { ...object, sourceBucket: 'tracepoint-attachments',
    destinationKey: `attachments/${object.sourceKey}` };
  assert.throws(() => validateFinalObjectArchive({ ...archive, objects: [] },
    { ...artifact, objects: { manifest: [attachment] } }, [attachment.destinationKey]),
  /FINAL_OBJECT_EXCLUSION_NOT_AGENCY_PATCH/);
});
