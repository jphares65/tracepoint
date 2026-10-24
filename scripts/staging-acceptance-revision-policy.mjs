import assert from 'node:assert/strict';

const requiredAcceptanceRevision = 194;

/** New acceptance runs stay pinned; cleanup of an owned prior fixture may follow later staging releases. */
export function assertStagingTaskRevision(taskDefinition, mode = 'acceptance') {
  assert.ok(mode === 'acceptance' || mode === 'recovery', 'Unsupported staging task revision policy.');
  const revisionText = String(taskDefinition ?? '').split(':').at(-1);
  assert.match(revisionText, /^[1-9][0-9]{0,5}$/, 'Staging task definition revision is invalid.');
  const revision = Number(revisionText);
  if (mode === 'acceptance') assert.equal(revision, requiredAcceptanceRevision, 'New acceptance runs are pinned to the Batch 3 staging task revision.');
  else assert.ok(revision >= requiredAcceptanceRevision, 'Recovery requires the Batch 3 staging schema baseline or later.');
  return revisionText;
}
