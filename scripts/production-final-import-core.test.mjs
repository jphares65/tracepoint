import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildArtifact, APPROVED_RUN_IDS, ARTIFACT_BUCKET } from './source-production-final-capture-core.mjs';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import { FINAL_RDS_HOST, FINAL_RDS_INSTANCE, FINAL_RDS_RESOURCE_ID,
  planProductionFinalImport } from './production-final-import-core.mjs';

const target = { DBInstanceIdentifier: FINAL_RDS_INSTANCE, DbiResourceId: FINAL_RDS_RESOURCE_ID,
  Endpoint: { Address: FINAL_RDS_HOST, Port: 5432 }, DBName: 'tracepoint', DBInstanceStatus: 'available' };
const fenceChangedAt = '2026-09-28T12:00:00.000Z';
function capture(slot, capturedAtUtc) {
  const artifact = buildArtifact({ runId: APPROVED_RUN_IDS[slot], capturedAtUtc, fenceChangedAt,
    rowsByRelation: new Map(MIGRATION_RELATIONS.map(relation => [relation, []])), identities: [], objects: [] });
  const bytes = Buffer.from(artifact.payload);
  return { bucket: ARTIFACT_BUCKET, key: `migration/source/${APPROVED_RUN_IDS[slot]}/final-canonical.json`,
    versionId: `${slot}.verified`, byteSha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}
const first = capture('A', '2026-09-28T12:01:00.000Z');
const second = capture('B', '2026-09-28T12:03:03.000Z');

test('only quiescent capture B on the exact final RDS can be planned', () => {
  const plan = planProductionFinalImport({ first, second, target });
  assert.equal(plan.selectedArtifact.key, second.key);
  assert.equal(plan.target.resourceId, FINAL_RDS_RESOURCE_ID);
  assert.equal(plan.parity.status, 'FROZEN_SOURCE_QUIESCENT');
});

test('rehearsal target, wrong slot, changed bytes and too-short quiet interval fail closed', () => {
  assert.throws(() => planProductionFinalImport({ first, second, target: { ...target,
    DbiResourceId: 'db-WX6GX35AIJ546ZRCZIRQ545B3E' } }), /FINAL_IMPORT_RDS_RESOURCE_MISMATCH/);
  assert.throws(() => planProductionFinalImport({ first, second: { ...second, key: first.key }, target }),
    /FINAL_IMPORT_KEY_MISMATCH/);
  assert.throws(() => planProductionFinalImport({ first, second: { ...second,
    bytes: Buffer.from('{}') }, target }), /ARTIFACT_BYTE_HASH_MISMATCH/);
  assert.throws(() => planProductionFinalImport({ first, second, target,
    minimumQuietMs: 124_000 }), /QUIET_WINDOW_TOO_SHORT/);
});
