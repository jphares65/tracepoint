import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifact, APPROVED_RUN_IDS } from './source-production-final-capture-core.mjs';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import { finalImportOperations, snapshotFromArtifact } from './production-final-relation-adapter.mjs';

const rowsByRelation = new Map(MIGRATION_RELATIONS.map(relation => [relation, []]));
const artifact = JSON.parse(buildArtifact({ runId: APPROVED_RUN_IDS.B,
  capturedAtUtc: '2026-09-28T12:03:03.000Z', fenceChangedAt: '2026-09-28T12:00:00.000Z',
  rowsByRelation, identities: [], objects: [] }).payload);

test('capture B becomes a variable-count final snapshot without historical object fixtures', () => {
  const snapshot = snapshotFromArtifact(artifact);
  assert.equal(snapshot.finalCapture, true);
  assert.equal(snapshot.baseline.relationalRows, 0);
  assert.equal(snapshot.baseline.objects, 0);
  assert.equal(snapshot.rows.size, MIGRATION_RELATIONS.length);
  assert.deepEqual(snapshot.objectManifest, []);
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
