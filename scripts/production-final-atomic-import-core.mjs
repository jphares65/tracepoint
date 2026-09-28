import assert from 'node:assert/strict';
import { FINAL_RDS_HOST, FINAL_RDS_INSTANCE, FINAL_RDS_RESOURCE_ID,
  planProductionFinalImport } from './production-final-import-core.mjs';
import { parseAndVerifyArtifact } from './source-frozen-capture-parity-core.mjs';
import { SOURCE_PROJECT_REF } from './source-production-final-capture-core.mjs';

/**
 * Transaction boundary for the final, capture-B-only relational apply.
 * The caller must supply the reviewed relation importer and full reconciler;
 * this boundary deliberately cannot turn an unimplemented importer into a GO.
 */
export async function runProductionFinalAtomicImport({ first, second, target, client, readBaseline,
  applyRelations, reconcileInTransaction, verifyCommitted, verifyRollback }) {
  // Revalidate the actual immutable bytes and RDS control-plane response at
  // the mutation boundary; a caller-supplied summary is not sufficient.
  const plan = planProductionFinalImport({ first, second, target });
  const artifact = parseAndVerifyArtifact(second.bytes, plan.selectedArtifact.byteSha256, SOURCE_PROJECT_REF);
  assert.equal(plan?.target?.instance, FINAL_RDS_INSTANCE, 'FINAL_IMPORT_TARGET_INSTANCE_REQUIRED');
  assert.equal(plan?.target?.resourceId, FINAL_RDS_RESOURCE_ID, 'FINAL_IMPORT_TARGET_RESOURCE_REQUIRED');
  assert.equal(plan?.target?.host, FINAL_RDS_HOST, 'FINAL_IMPORT_TARGET_HOST_REQUIRED');
  assert.equal(plan?.parity?.status, 'FROZEN_SOURCE_QUIESCENT', 'FINAL_IMPORT_QUIESCENCE_REQUIRED');
  assert.match(plan?.selectedArtifact?.versionId ?? '', /^[A-Za-z0-9._-]+$/, 'FINAL_IMPORT_VERSION_REQUIRED');
  assert.match(plan?.selectedArtifact?.byteSha256 ?? '', /^[0-9a-f]{64}$/, 'FINAL_IMPORT_BYTE_HASH_REQUIRED');
  for (const [name, value] of Object.entries({ readBaseline, applyRelations,
    reconcileInTransaction, verifyCommitted, verifyRollback })) {
    assert.equal(typeof value, 'function', `FINAL_IMPORT_${name.toUpperCase()}_REQUIRED`);
  }
  assert.equal(typeof client?.query, 'function', 'FINAL_IMPORT_CLIENT_REQUIRED');

  const baseline = await readBaseline(client);
  assert.equal(baseline?.targetResourceId, FINAL_RDS_RESOURCE_ID, 'FINAL_IMPORT_BASELINE_TARGET_MISMATCH');
  assert.equal(baseline?.customerRows, 0, 'FINAL_IMPORT_TARGET_NOT_CLEAN');
  assert.equal(baseline?.authUsers, 0, 'FINAL_IMPORT_TARGET_IDENTITIES_NOT_CLEAN');
  assert.equal(baseline?.migrationLineage, 99, 'FINAL_IMPORT_SCHEMA_LINEAGE_MISMATCH');

  await client.query('begin');
  let transactionOpen = true;
  try {
    await client.query("set local tracepoint.migration_mode = 'on'");
    const applied = await applyRelations(client, { plan, artifact });
    assert.equal(applied?.relationalRows, plan.relationalRows, 'FINAL_IMPORT_APPLIED_COUNT_MISMATCH');
    assert.equal(applied?.identities, plan.identities, 'FINAL_IMPORT_APPLIED_IDENTITY_MISMATCH');
    assert.equal(applied?.memberships, plan.memberships, 'FINAL_IMPORT_APPLIED_MEMBERSHIP_MISMATCH');
    const reconciliation = await reconcileInTransaction(client, { plan, artifact });
    assert.equal(reconciliation?.passed, true, 'FINAL_IMPORT_RECONCILIATION_FAILED');
    assert.equal(reconciliation?.relationContracts, 90, 'FINAL_IMPORT_RECONCILIATION_INCOMPLETE');
    assert.equal(reconciliation?.relationalRows, plan.relationalRows, 'FINAL_IMPORT_RECONCILED_COUNT_MISMATCH');
    assert.equal(reconciliation?.identities, plan.identities, 'FINAL_IMPORT_RECONCILED_IDENTITY_MISMATCH');
    assert.equal(reconciliation?.memberships, plan.memberships, 'FINAL_IMPORT_RECONCILED_MEMBERSHIP_MISMATCH');
    // A failed COMMIT has an unknown outcome until independently attested.
    try { await client.query('commit'); transactionOpen = false; }
    catch { transactionOpen = false; throw new Error('FINAL_IMPORT_COMMIT_OUTCOME_UNKNOWN'); }
    const committed = await verifyCommitted(client, plan);
    assert.equal(committed?.passed, true, 'FINAL_IMPORT_POST_COMMIT_VERIFY_FAILED');
    return Object.freeze({ status: 'FINAL_RELATIONAL_IMPORT_COMMITTED',
      artifactVersionId: plan.selectedArtifact.versionId,
      artifactByteSha256: plan.selectedArtifact.byteSha256,
      targetResourceId: FINAL_RDS_RESOURCE_ID,
      relationalRows: plan.relationalRows, identities: plan.identities,
      memberships: plan.memberships, reconciliation });
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('rollback'); }
      catch { throw new Error('FINAL_IMPORT_ROLLBACK_OUTCOME_UNKNOWN', { cause: error }); }
      const rollback = await verifyRollback(client, baseline);
      assert.equal(rollback?.restored, true, 'FINAL_IMPORT_ROLLBACK_NOT_VERIFIED');
    }
    throw error;
  }
}
