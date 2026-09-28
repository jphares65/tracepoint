import assert from 'node:assert/strict';
import { MIGRATION_RELATIONS } from './supabase-rest-ledger-core.mjs';
import { validateImmutableArtifact } from './immutable-source-artifact-validator.mjs';
import { compareFrozenCaptures, parseAndVerifyArtifact } from './source-frozen-capture-parity-core.mjs';
import { APPROVED_RUN_IDS, ARTIFACT_BUCKET, SOURCE_PROJECT_REF } from './source-production-final-capture-core.mjs';

export const FINAL_RDS_INSTANCE = 'tracepoint-production-final-cutover-20260926';
export const FINAL_RDS_RESOURCE_ID = 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE';
export const FINAL_RDS_HOST = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
export const FINAL_DATABASE = 'tracepoint';
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^[A-Za-z0-9._-]+$/;

function pinnedCapture(spec, slot) {
  assert.equal(spec?.bucket, ARTIFACT_BUCKET, `FINAL_IMPORT_BUCKET_MISMATCH:${slot}`);
  assert.equal(spec?.key, `migration/source/${APPROVED_RUN_IDS[slot]}/final-canonical.json`,
    `FINAL_IMPORT_KEY_MISMATCH:${slot}`);
  assert.match(spec?.versionId ?? '', VERSION, `FINAL_IMPORT_VERSION_MISSING:${slot}`);
  assert.match(spec?.byteSha256 ?? '', SHA256, `FINAL_IMPORT_BYTE_HASH_MISSING:${slot}`);
  assert.ok(spec?.bytes instanceof Uint8Array, `FINAL_IMPORT_BYTES_MISSING:${slot}`);
  const artifact = parseAndVerifyArtifact(spec.bytes, spec.byteSha256, SOURCE_PROJECT_REF);
  assert.equal(artifact.runId, APPROVED_RUN_IDS[slot], `FINAL_IMPORT_RUN_MISMATCH:${slot}`);
  const memberships = artifact.rows.department_memberships;
  validateImmutableArtifact(artifact, { expectedSha256: artifact.masterSha256,
    expectedRunId: APPROVED_RUN_IDS[slot],
    expectedAuthorizationReference: 'TP-PRODUCTION-FINAL-SOURCE-20260927',
    expectations: { relationalRows: artifact.totalRelationalRows,
      identities: artifact.identities.count, memberships: memberships.length,
      activeMemberships: memberships.filter(row => row.is_active === true).length,
      inactiveMemberships: memberships.filter(row => row.is_active !== true).length,
      platformAdmins: artifact.rows.platform_admins.length,
      objects: artifact.objects.count, objectBytes: artifact.objects.totalBytes } });
  return artifact;
}

/** Pure, read-only gate. Never accepts the September 23 rehearsal RDS target. */
export function planProductionFinalImport({ first, second, target, minimumQuietMs = 60_000 }) {
  const a = pinnedCapture(first, 'A');
  const b = pinnedCapture(second, 'B');
  const parity = compareFrozenCaptures(a, b, SOURCE_PROJECT_REF, minimumQuietMs);
  assert.equal(parity.status, 'FROZEN_SOURCE_QUIESCENT', 'FINAL_IMPORT_SOURCE_CHANGED');
  assert.equal(target?.DBInstanceIdentifier, FINAL_RDS_INSTANCE, 'FINAL_IMPORT_RDS_INSTANCE_MISMATCH');
  assert.equal(target?.DbiResourceId, FINAL_RDS_RESOURCE_ID, 'FINAL_IMPORT_RDS_RESOURCE_MISMATCH');
  assert.equal(target?.Endpoint?.Address, FINAL_RDS_HOST, 'FINAL_IMPORT_RDS_HOST_MISMATCH');
  assert.equal(target?.Endpoint?.Port, 5432, 'FINAL_IMPORT_RDS_PORT_MISMATCH');
  assert.equal(target?.DBName, FINAL_DATABASE, 'FINAL_IMPORT_DATABASE_MISMATCH');
  assert.equal(target?.DBInstanceStatus, 'available', 'FINAL_IMPORT_RDS_UNAVAILABLE');
  assert.deepEqual(b.tables.map(table => table.name), [...MIGRATION_RELATIONS], 'FINAL_IMPORT_RELATION_SET_MISMATCH');
  return Object.freeze({ sourceProjectRef: SOURCE_PROJECT_REF,
    selectedArtifact: Object.freeze({ bucket: second.bucket, key: second.key,
      versionId: second.versionId, byteSha256: second.byteSha256, masterSha256: b.masterSha256 }),
    target: Object.freeze({ instance: FINAL_RDS_INSTANCE, resourceId: FINAL_RDS_RESOURCE_ID,
      host: FINAL_RDS_HOST, database: FINAL_DATABASE }),
    parity: Object.freeze(parity), relationalRows: b.totalRelationalRows,
    identities: b.identities.count, memberships: b.memberships.count,
    objects: b.objects.count, objectBytes: b.objects.totalBytes });
}
