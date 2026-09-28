import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildArtifact, APPROVED_RUN_IDS, ARTIFACT_BUCKET } from './source-production-final-capture-core.mjs';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import { FINAL_RDS_HOST, FINAL_RDS_INSTANCE, FINAL_RDS_RESOURCE_ID } from './production-final-import-core.mjs';
import { runAttestedAtomicImport, runProductionFinalAtomicImport } from './production-final-atomic-import-core.mjs';

const target = { DBInstanceIdentifier: FINAL_RDS_INSTANCE, DbiResourceId: FINAL_RDS_RESOURCE_ID,
  Endpoint: { Address: FINAL_RDS_HOST, Port: 5432 }, DBName: 'tracepoint', DBInstanceStatus: 'available' };
function capture(slot, capturedAtUtc) {
  const artifact = buildArtifact({ runId: APPROVED_RUN_IDS[slot], capturedAtUtc,
    fenceChangedAt: '2026-09-28T12:00:00.000Z',
    rowsByRelation: new Map(MIGRATION_RELATIONS.map(relation => [relation, []])), identities: [], objects: [] });
  const bytes = Buffer.from(artifact.payload);
  return { bucket: ARTIFACT_BUCKET, key: `migration/source/${APPROVED_RUN_IDS[slot]}/final-canonical.json`,
    versionId: `${slot}.verified`, byteSha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}
const first = capture('A', '2026-09-28T12:01:00.000Z');
const second = capture('B', '2026-09-28T12:03:03.000Z');
function harness(overrides = {}) {
  const calls = [];
  const options = { first, second, target, client: { query: async sql => { calls.push(sql); return { rows: [] }; } },
    readBaseline: async () => ({ targetResourceId: FINAL_RDS_RESOURCE_ID, customerRows: 0, authUsers: 0, migrationLineage: 99 }),
    applyRelations: async () => ({ relationalRows: 0, identities: 0, memberships: 0 }),
    reconcileInTransaction: async () => ({ passed: true, relationContracts: 90, relationalRows: 0, identities: 0, memberships: 0 }),
    verifyCommitted: async () => ({ passed: true }), verifyRollback: async () => ({ restored: true }), ...overrides };
  return { calls, options };
}

test('commits only after full in-transaction reconciliation and verifies post-commit', async () => {
  const { calls, options } = harness({ applyRelations: async (_client, { plan: selected, artifact }) => {
    assert.equal(artifact.runId, APPROVED_RUN_IDS.B);
    assert.equal(artifact.masterSha256, selected.selectedArtifact.masterSha256);
    return { relationalRows: 0, identities: 0, memberships: 0 };
  } });
  const result = await runProductionFinalAtomicImport(options);
  assert.equal(result.status, 'FINAL_RELATIONAL_IMPORT_COMMITTED');
  assert.deepEqual(calls, ['begin', "set local tracepoint.migration_mode = 'on'", 'commit']);
});

test('reconciliation failure rolls back and checks the original target baseline', async () => {
  const { calls, options } = harness({ reconcileInTransaction: async () => ({ passed: false }),
    verifyRollback: async (_client, baseline) => { assert.equal(baseline.customerRows, 0); return { restored: true }; } });
  await assert.rejects(runProductionFinalAtomicImport(options), /FINAL_IMPORT_RECONCILIATION_FAILED/);
  assert.equal(calls.at(-1), 'rollback');
});

test('wrong target or dirty baseline cannot begin a transaction', async () => {
  const wrong = harness({ target: { ...target, DbiResourceId: 'wrong' } });
  await assert.rejects(runProductionFinalAtomicImport(wrong.options), /FINAL_IMPORT_RDS_RESOURCE_MISMATCH/);
  assert.deepEqual(wrong.calls, []);
  const dirty = harness({ readBaseline: async () => ({ targetResourceId: FINAL_RDS_RESOURCE_ID, customerRows: 1, authUsers: 0, migrationLineage: 99 }) });
  await assert.rejects(runProductionFinalAtomicImport(dirty.options), /FINAL_IMPORT_TARGET_NOT_CLEAN/);
  assert.deepEqual(dirty.calls, []);
  const tampered = harness({ second: { ...second, bytes: Buffer.from('{}') } });
  await assert.rejects(runProductionFinalAtomicImport(tampered.options), /ARTIFACT_BYTE_HASH_MISMATCH/);
  assert.deepEqual(tampered.calls, []);
});

test('commit ambiguity never reports success or invokes rollback verification', async () => {
  let rollbackChecked = false;
  const { options } = harness({ client: { query: async sql => { if (sql === 'commit') throw new Error('network lost'); } },
    verifyRollback: async () => { rollbackChecked = true; return { restored: true }; } });
  await assert.rejects(runProductionFinalAtomicImport(options), /FINAL_IMPORT_COMMIT_OUTCOME_UNKNOWN/);
  assert.equal(rollbackChecked, false);
});

test('shared transaction body rejects a proof target or artifact mismatch before mutation', async () => {
  const { calls, options } = harness();
  const plan = { target: { resourceId: 'db-ISOLATED123' },
    parity: { status: 'FROZEN_SOURCE_QUIESCENT' },
    selectedArtifact: { versionId: 'B.verified', byteSha256: 'b'.repeat(64),
      masterSha256: 'c'.repeat(64) }, relationalRows: 0, identities: 0, memberships: 0 };
  await assert.rejects(runAttestedAtomicImport({ ...options, plan,
    artifact: { masterSha256: 'different' }, expectedTargetResourceId: 'db-ISOLATED123' }),
  /FINAL_IMPORT_ARTIFACT_MISMATCH/);
  await assert.rejects(runAttestedAtomicImport({ ...options, plan,
    artifact: { masterSha256: 'c'.repeat(64) }, expectedTargetResourceId: FINAL_RDS_RESOURCE_ID }),
  /FINAL_IMPORT_PLAN_TARGET_MISMATCH/);
  assert.deepEqual(calls, []);
});
