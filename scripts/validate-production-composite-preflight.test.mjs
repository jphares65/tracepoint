import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateProductionCompositeReadiness, REQUIRED_WRITER_PATHS } from './validate-production-composite-preflight.mjs';
import { REQUIRED_WRITER_PATHS as CAPTURE_WRITER_PATHS } from './source-production-final-capture-core.mjs';

const inventory = JSON.parse(readFileSync(new URL('../docs/production-composite-preflight-evidence-20260927.json', import.meta.url)));

test('preflight and final capture require the same exact writer paths', () => {
  assert.deepEqual(REQUIRED_WRITER_PATHS, CAPTURE_WRITER_PATHS);
});

function withSyntheticWriterPathProof(ready) {
  for (const name of REQUIRED_WRITER_PATHS) Object.assign(ready.writerPaths[name], {
    status: 'controlled', productionBindingVerified: true, rehearsalNegativePassed: true,
    restoreReviewed: true, control: `synthetic control for ${name}`,
    restore: `synthetic inverse for ${name}`, rehearsalEvidenceSha256: 'a'.repeat(64),
  });
}

function withSyntheticEpochProof(ready) {
  ready.credentialEpoch = {
    projectRef: 'izlkwggluhlhzlumtzes',
    captureSecretName: 'tracepoint/production/migration/source-production-epoch-capture-20260928',
    rollbackSecretName: 'tracepoint/production/migration/source-production-epoch-rollback-20260928',
    threeModernKeysDistinct: true, captureReaderExactArnVerified: true,
    captureReaderOldAndRollbackDenied: true, rollbackKeyUnassignedToRunningWriters: true,
    oldModernKeyIdPinned: true, legacyServiceKeyStatePinned: true,
    oldModernKeyRetirementReviewed: true, legacyServiceKeyDisableReviewed: true,
    oldCredentialsNegativeChecksDefined: true,
  };
  ready.rollbackDistribution = {
    projectRef: 'izlkwggluhlhzlumtzes',
    vercelProjectId: 'prj_V03LJyQIc231luvZ9u0gcOAt4xK4',
    productionEnvReplacementReviewed: true, newProductionDeploymentRequired: true,
    newDeploymentIdentityPinned: true, productionAliasAndWriteReadbackVerified: true,
    ecsExactSecretRevisionAndRestartReviewed: true,
    oldDeploymentCannotBeResumedWithRetiredKey: true,
    authStorageControlsRestoredBeforeTraffic: true, singleSourceAuthorityVerified: true,
  };
}

test('current production inventory blocks uncovered autonomous writers', () => {
  const result = evaluateProductionCompositeReadiness(inventory);
  assert.equal(result.status, 'PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED');
  assert.ok(result.blockers.includes('WRITER_STATE_UNCLASSIFIED:authApi'));
  assert.ok(result.blockers.includes('WRITER_STATE_UNCLASSIFIED:storageApi'));
  assert.ok(result.blockers.includes('ACTIVE_CREDENTIAL_INVENTORY_INCOMPLETE'));
  assert.ok(result.blockers.includes('UNKNOWN_ACTIVE_AUTONOMOUS_WRITERS'));
  assert.ok(!result.blockers.includes('CREDENTIAL_EPOCH_NOT_READY'));
  assert.ok(result.blockers.includes('FINAL_FROZEN_ARTIFACT_APPLY_NOT_READY'));
  assert.ok(result.blockers.includes('ROLLBACK_CREDENTIAL_DISTRIBUTION_UNPROVEN'));
  assert.ok(result.blockers.includes('AUTH_SERVICE_ADMIN_WRITERS_UNCONTROLLED'));
  assert.ok(!result.blockers.includes('LEGACY_VERCEL_WRITER_CONTROL_UNPROVEN'));
  assert.ok(result.blockers.includes('WRITER_INVENTORY_OPEN:legacyVercel'));
  assert.ok(result.blockers.includes('WRITER_PATH_CONTROL_UNPROVEN:externalCredentialHolders'));
  assert.ok(!result.blockers.includes('S3_WRITER_INVENTORY_OPEN'));
});

test('complete reversible controls and exact two-slot capture would pass', () => {
  const ready = structuredClone(inventory);
  ready.publicTables.triggerInstallAndAbortReviewed = true;
  ready.capture.immutableVersioned = true;
  ready.finalImport = { targetResourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE',
    sourceArtifactSlot: 'B', variableFrozenCountsSupported: true,
    exactArtifactVersionAndHashRequired: true, atomicRelationalApplyRehearsed: true,
    inTransactionFullReconciliationRehearsed: true,
    objectManifestAndReferenceReconciliationRehearsed: true,
    rollbackOnMismatchRehearsed: true };
  ready.unfence.exactInverseReviewed = true;
  ready.unfence.restoreVerificationDefined = true;
  ready.activeCredentialInventoryComplete = true;
  ready.unknownActiveAuthoritativeWriters = false;
  withSyntheticEpochProof(ready);
  withSyntheticWriterPathProof(ready);
  Object.assign(ready.legacyVercel, { productionPauseAndResumeReviewed: true,
    pauseAndResumeRehearsed: true, pause503NegativeRehearsed: true,
    previewProductionSourceExcluded: true });
  for (const writer of Object.values(ready.writers)) {
    writer.inventoryComplete = true;
    writer.authoritativeMutationCapable = true;
    writer.reversibleControlAvailable = true;
    writer.inverseReviewed = true;
    writer.realInterfaceNegativeRehearsed = true;
  }
  ready.writers.authApi.controls.serviceAdminWritersControlled = true;
  assert.equal(evaluateProductionCompositeReadiness(ready).status, 'PRODUCTION_COMPOSITE_PREFLIGHT_PASS');
  const blockedHistoricalPreview = structuredClone(ready);
  Object.assign(blockedHistoricalPreview.legacyVercel, {
    previewProductionSourceExcluded: false,
    previewProjectWideDenyReviewed: true,
    previewEnvironmentScopedDenyRehearsed: true,
    previewHistoricalNegativeTestDefined: true,
    previewControlReversible: true,
    previewNegativeEvidenceSha256: 'c'.repeat(64),
  });
  assert.equal(evaluateProductionCompositeReadiness(blockedHistoricalPreview).status,
    'PRODUCTION_COMPOSITE_PREFLIGHT_PASS');
  blockedHistoricalPreview.legacyVercel.previewHistoricalNegativeTestDefined = false;
  assert.ok(evaluateProductionCompositeReadiness(blockedHistoricalPreview).blockers.includes(
    'LEGACY_VERCEL_WRITER_CONTROL_UNPROVEN'));
  for (const change of [
    copy => { copy.maintenance.unmatchedHostFallbackIncluded = false; },
    copy => { copy.s3WriterCredentials.productionProjectVerified = false; },
    copy => { copy.writers.authApi.realInterfaceNegativeRehearsed = false; },
    copy => { copy.writers.authApi.controls.serviceAdminWritersControlled = false; },
    copy => { copy.writers.authApi.controls.existingTokenAuthWriteBlockedRehearsed = false; },
    copy => { copy.writers.authApi.authoritativeMutationCapable = false; },
    copy => { delete copy.writerPaths.externalCredentialHolders; },
    copy => { copy.writerPaths.storageElevated.rehearsalNegativePassed = false; },
    copy => { copy.capture.slots.B = copy.capture.slots.A; },
    copy => { copy.finalImport.atomicRelationalApplyRehearsed = false; },
    copy => { copy.legacyVercel.pause503NegativeRehearsed = false; },
    copy => { copy.credentialEpoch.captureReaderOldAndRollbackDenied = false; },
    copy => { copy.rollbackDistribution.newProductionDeploymentRequired = false; },
    copy => { copy.activeCredentialInventoryComplete = false; },
    copy => { copy.unknownActiveAuthoritativeWriters = true; },
    copy => { copy.relationFingerprint = 'wrong'; },
  ]) {
    const copy = structuredClone(ready);
    change(copy);
    if (copy.relationFingerprint === 'wrong') assert.throws(() => evaluateProductionCompositeReadiness(copy));
    else assert.equal(evaluateProductionCompositeReadiness(copy).status, 'PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED');
  }
});

test('an ephemeral-only writer requires positive field and comparator proof, not merely a label', () => {
  const ready = structuredClone(inventory);
  ready.publicTables.triggerInstallAndAbortReviewed = true;
  ready.capture.immutableVersioned = true;
  ready.finalImport = { targetResourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE',
    sourceArtifactSlot: 'B', variableFrozenCountsSupported: true,
    exactArtifactVersionAndHashRequired: true, atomicRelationalApplyRehearsed: true,
    inTransactionFullReconciliationRehearsed: true,
    objectManifestAndReferenceReconciliationRehearsed: true,
    rollbackOnMismatchRehearsed: true };
  ready.unfence.exactInverseReviewed = true;
  ready.unfence.restoreVerificationDefined = true;
  ready.activeCredentialInventoryComplete = true;
  ready.unknownActiveAuthoritativeWriters = false;
  withSyntheticEpochProof(ready);
  withSyntheticWriterPathProof(ready);
  Object.assign(ready.legacyVercel, { productionPauseAndResumeReviewed: true,
    pauseAndResumeRehearsed: true, pause503NegativeRehearsed: true,
    previewProductionSourceExcluded: true });
  for (const writer of Object.values(ready.writers)) Object.assign(writer, {
    inventoryComplete: true, authoritativeMutationCapable: true,
    reversibleControlAvailable: true, inverseReviewed: true, realInterfaceNegativeRehearsed: true,
  });
  ready.writers.authApi.controls.serviceAdminWritersControlled = true;
  const auth = ready.writers.authApi;
  auth.authoritativeMutationCapable = false;
  assert.ok(evaluateProductionCompositeReadiness(ready).blockers.includes('AUTHORITATIVE_WRITER_MISCLASSIFIED:authApi'));
  const scheduled = ready.writers.scheduledImportAdmin;
  scheduled.authoritativeMutationCapable = false;
  assert.ok(evaluateProductionCompositeReadiness(ready).blockers.includes('WRITER_EPHEMERAL_PROOF_MISSING:scheduledImportAdmin'));
  Object.assign(auth, { ephemeralOnlyProven: true, authoritativeFieldsUnaffected: true,
    canonicalComparatorExclusionTested: true, ephemeralEvidenceSha256: 'a'.repeat(64) });
  Object.assign(scheduled, { ephemeralOnlyProven: true, authoritativeFieldsUnaffected: true,
    canonicalComparatorExclusionTested: true, ephemeralEvidenceSha256: 'b'.repeat(64) });
  assert.ok(evaluateProductionCompositeReadiness(ready).blockers.includes('AUTHORITATIVE_WRITER_MISCLASSIFIED:authApi'));
  auth.authoritativeMutationCapable = true;
  assert.equal(evaluateProductionCompositeReadiness(ready).status, 'PRODUCTION_COMPOSITE_PREFLIGHT_PASS');
});
