import assert from 'node:assert/strict';
import { canonical } from './supabase-rest-ledger-core.mjs';
import { APPROVED_RUN_IDS, STORAGE_BUCKETS } from './source-production-final-capture-core.mjs';

const VERSION = /^[A-Za-z0-9._-]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Attest the immutable in-AWS object copies associated with final capture B. */
export function validateFinalObjectArchive(archive, artifact) {
  assert.equal(archive?.format, 'tracepoint-final-object-archive/v1', 'FINAL_OBJECT_ARCHIVE_FORMAT');
  assert.equal(archive?.runId, APPROVED_RUN_IDS.B, 'FINAL_OBJECT_ARCHIVE_NOT_CAPTURE_B');
  assert.equal(artifact?.runId, APPROVED_RUN_IDS.B, 'FINAL_OBJECT_ARTIFACT_NOT_CAPTURE_B');
  assert.equal(archive?.artifactMasterSha256, artifact.masterSha256, 'FINAL_OBJECT_ARCHIVE_ARTIFACT_MISMATCH');
  assert.ok(Array.isArray(archive.objects), 'FINAL_OBJECT_ARCHIVE_ENTRIES_MISSING');
  assert.equal(archive.objects.length, artifact.objects.manifest.length, 'FINAL_OBJECT_ARCHIVE_COUNT_MISMATCH');
  const archiveByKey = new Map();
  for (const entry of archive.objects) {
    assert.ok(STORAGE_BUCKETS.includes(entry.sourceBucket), 'FINAL_OBJECT_BUCKET_UNAPPROVED');
    assert.ok(typeof entry.sourceKey === 'string' && entry.sourceKey.length > 0 &&
      entry.sourceKey.split('/').every(part => part && part !== '.' && part !== '..'), 'FINAL_OBJECT_KEY_UNSAFE');
    assert.equal(entry.archiveKey,
      `migration/source/${APPROVED_RUN_IDS.B}/objects/${entry.sourceBucket}/${entry.sourceKey}`,
    'FINAL_OBJECT_ARCHIVE_KEY_MISMATCH');
    assert.match(entry.archiveVersionId ?? '', VERSION, 'FINAL_OBJECT_VERSION_MISSING');
    assert.match(entry.sha256 ?? '', SHA256, 'FINAL_OBJECT_HASH_MISSING');
    assert.equal(archiveByKey.has(entry.archiveKey), false, 'FINAL_OBJECT_ARCHIVE_DUPLICATE');
    archiveByKey.set(entry.archiveKey, entry);
  }
  const mapped = artifact.objects.manifest.map(object => {
    assert.ok(STORAGE_BUCKETS.includes(object.sourceBucket), 'FINAL_OBJECT_SOURCE_BUCKET_UNAPPROVED');
    const destinationPrefix = object.sourceBucket === 'tracepoint-attachments' ? 'attachments' : object.sourceBucket;
    assert.equal(object.destinationKey, `${destinationPrefix}/${object.sourceKey}`,
      'FINAL_OBJECT_DESTINATION_MISMATCH');
    const archiveKey = `migration/source/${APPROVED_RUN_IDS.B}/objects/${object.sourceBucket}/${object.sourceKey}`;
    const entry = archiveByKey.get(archiveKey);
    assert.ok(entry, 'FINAL_OBJECT_ARCHIVE_ENTRY_MISSING');
    assert.equal(entry.bytes, object.bytes, 'FINAL_OBJECT_ARCHIVE_SIZE_MISMATCH');
    assert.equal(entry.sha256, object.sha256, 'FINAL_OBJECT_ARCHIVE_HASH_MISMATCH');
    assert.equal(object.sourceKey.split('/')[0], object.departmentId,
      'FINAL_OBJECT_DEPARTMENT_KEY_MISMATCH');
    return { ...object, archiveKey, archiveVersionId: entry.archiveVersionId };
  });
  assert.equal(new Set(mapped.map(item => item.destinationKey)).size, mapped.length,
    'FINAL_OBJECT_DESTINATION_DUPLICATE');
  assert.equal(canonical([...archiveByKey.keys()].sort()), canonical(mapped.map(item => item.archiveKey).sort()),
    'FINAL_OBJECT_ARCHIVE_EXTRA');
  return mapped;
}
