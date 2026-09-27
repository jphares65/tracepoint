#!/usr/bin/env node
// Read-only cutover readiness gate. This never activates a source control.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_PROJECT = 'izlkwggluhlhzlumtzes';
export const SOURCE_FINGERPRINT = '36558b0730e3e96cad6426f38088a5b0';
export const WRITER_FAMILIES = Object.freeze([
  'applicationApi', 'serviceRole', 'authApi', 'storageApi', 'background', 'scheduledImportAdmin',
  'legacyVercel',
]);
export const ALWAYS_AUTHORITATIVE_CAPABLE = Object.freeze([
  'applicationApi', 'serviceRole', 'authApi', 'storageApi', 'legacyVercel',
]);

export function evaluateProductionCompositeReadiness(evidence) {
  assert.equal(evidence?.projectRef, SOURCE_PROJECT, 'PRODUCTION_PROJECT_REQUIRED');
  assert.equal(evidence?.accountId, '193644343389', 'PRODUCTION_ACCOUNT_REQUIRED');
  assert.equal(evidence?.region, 'us-east-1', 'PRODUCTION_REGION_REQUIRED');
  assert.equal(evidence?.relationFingerprint, SOURCE_FINGERPRINT, 'SOURCE_FINGERPRINT_DRIFT');
  const blockers = [];
  const requireProof = (ok, code) => { if (!ok) blockers.push(code); };
  requireProof(evidence.maintenance?.activationReviewed === true &&
    evidence.maintenance?.reversalReviewed === true, 'MAINTENANCE_INVERSE_UNPROVEN');
  requireProof(evidence.publicTables?.count === 87 &&
    evidence.publicTables?.ownerControlVerified === true &&
    evidence.publicTables?.triggerInstallAndAbortReviewed === true, 'PUBLIC_TRIGGER_LAYER_UNPROVEN');
  requireProof(evidence.capture?.slots?.A === '1d761bd7-04dd-43f3-b77a-2c41130e18c2' &&
    evidence.capture?.slots?.B === 'c7448ea9-4645-4e99-b988-3a05de12ac70' &&
    evidence.capture?.immutableVersioned === true && evidence.capture?.canonicalComparatorTested === true &&
    evidence.capture?.minimumQuietSeconds >= 60, 'DOUBLE_CAPTURE_NOT_READY');
  requireProof(evidence.s3WriterCredentials?.state === 'NO_SEPARATE_S3_WRITER_CREDENTIALS' &&
    evidence.s3WriterCredentials?.productionProjectVerified === true,
  'S3_WRITER_INVENTORY_OPEN');
  requireProof(evidence.legacyVercel?.projectId === 'prj_V03LJyQIc231luvZ9u0gcOAt4xK4' &&
    evidence.legacyVercel?.productionOrigin === 'https://tracepoint-amber.vercel.app' &&
    evidence.legacyVercel?.previewSourceProject === 'wztqqqashilusoppddxi' &&
    evidence.legacyVercel?.productionPauseAndResumeReviewed === true &&
    evidence.legacyVercel?.pauseAndResumeRehearsed === true &&
    evidence.legacyVercel?.pause503NegativeRehearsed === true &&
    evidence.legacyVercel?.previewProductionSourceExcluded === true,
  'LEGACY_VERCEL_WRITER_CONTROL_UNPROVEN');
  requireProof(evidence.unfence?.exactInverseReviewed === true &&
    evidence.unfence?.restoreVerificationDefined === true, 'UNFENCE_UNPROVEN');
  requireProof(evidence.unknownAutonomousWriters === false, 'UNKNOWN_AUTONOMOUS_WRITERS');
  const actual = Object.keys(evidence.writers ?? {}).sort();
  assert.deepEqual(actual, [...WRITER_FAMILIES].sort(), 'WRITER_FAMILY_INVENTORY_INCOMPLETE');
  for (const family of WRITER_FAMILIES) {
    const writer = evidence.writers[family];
    requireProof(writer?.inventoryComplete === true, `WRITER_INVENTORY_OPEN:${family}`);
    requireProof(typeof writer?.authoritativeMutationCapable === 'boolean', `WRITER_STATE_UNCLASSIFIED:${family}`);
    if (ALWAYS_AUTHORITATIVE_CAPABLE.includes(family))
      requireProof(writer?.authoritativeMutationCapable === true, `AUTHORITATIVE_WRITER_MISCLASSIFIED:${family}`);
    if (writer?.authoritativeMutationCapable === true) {
      requireProof(writer?.reversibleControlAvailable === true && writer?.inverseReviewed === true,
        `WRITER_CONTROL_UNPROVEN:${family}`);
      requireProof(writer?.realInterfaceNegativeRehearsed === true,
        `WRITER_NEGATIVE_UNPROVEN:${family}`);
    } else if (writer?.authoritativeMutationCapable === false) {
      requireProof(writer?.ephemeralOnlyProven === true && writer?.authoritativeFieldsUnaffected === true &&
        writer?.canonicalComparatorExclusionTested === true &&
        /^[0-9a-f]{64}$/.test(writer?.ephemeralEvidenceSha256 ?? ''),
      `WRITER_EPHEMERAL_PROOF_MISSING:${family}`);
    }
  }
  return { status: blockers.length ? 'PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED' :
    'PRODUCTION_COMPOSITE_PREFLIGHT_PASS', projectRef: SOURCE_PROJECT,
  relationFingerprint: SOURCE_FINGERPRINT, blockers };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 3, 'EXACT_EVIDENCE_FILE_REQUIRED');
    const result = evaluateProductionCompositeReadiness(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    if (result.blockers.length) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ status: 'PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED',
      code: error?.message ?? 'INVALID_EVIDENCE' }));
    process.exitCode = 2;
  }
}
