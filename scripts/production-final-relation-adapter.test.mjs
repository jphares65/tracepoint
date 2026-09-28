import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifact, APPROVED_RUN_IDS } from './source-production-final-capture-core.mjs';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import { finalImportOperations, snapshotFromArtifact } from './production-final-relation-adapter.mjs';

const rowsByRelation = new Map(MIGRATION_RELATIONS.map(relation => [relation, []]));
const patchIds = [
  '1d0e2994-4224-4237-8328-71020ba20027',
  'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0',
];
const patchKeys = [
  `${patchIds[0]}/patch-1787431778595.jpg`,
  `${patchIds[1]}/patch-1782439034425.png`,
];
rowsByRelation.set('departments', patchIds.map((id, index) => ({ id,
  patch_url: `https://izlkwggluhlhzlumtzes.supabase.co/storage/v1/object/public/department-assets/${patchKeys[index]}` })));
const artifact = JSON.parse(buildArtifact({ runId: APPROVED_RUN_IDS.B,
  capturedAtUtc: '2026-09-28T12:03:03.000Z', fenceChangedAt: '2026-09-28T12:00:00.000Z',
  rowsByRelation, identities: [], objects: patchKeys.map((sourceKey, index) => ({
    sourceBucket: 'department-assets', sourceKey,
    destinationKey: `department-assets/${sourceKey}`, departmentId: patchIds[index],
    bytes: 1, sha256: 'a'.repeat(64),
  })) }).payload);

test('capture B becomes a variable-count final snapshot without historical object fixtures', () => {
  const snapshot = snapshotFromArtifact(artifact);
  assert.equal(snapshot.finalCapture, true);
  assert.equal(snapshot.baseline.relationalRows, 2);
  assert.equal(snapshot.baseline.objects, 0);
  assert.equal(snapshot.rows.size, MIGRATION_RELATIONS.length);
  assert.deepEqual(snapshot.objectManifest, []);
  assert.ok(snapshot.rows.get('departments').every(row => row.patch_url === null));
});

test('missing or reordered relation contract fails before an import transaction', () => {
  assert.throws(() => snapshotFromArtifact({ ...artifact, tables: artifact.tables.slice(1) }),
    /FINAL_RELATION_CONTRACT_MISMATCH/);
});
test('paid-source origin is accepted only with the exact disposable proof RDS identity', () => {
  assert.ok(finalImportOperations('db-4HOQR2UMDO6A3W7IEJFDGGDKVQ',
    'reukdouvpshshvqnzsgw'));
  assert.throws(() => finalImportOperations('db-X4DYNS3TMVSAP7Z3RISDWEYDVE',
    'reukdouvpshshvqnzsgw'), /SOURCE_TARGET_PAIR_INVALID/);
  assert.throws(() => finalImportOperations('db-4HOQR2UMDO6A3W7IEJFDGGDKVQ',
    'izlkwggluhlhzlumtzes'), /SOURCE_TARGET_PAIR_INVALID/);
});
