import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MIGRATION_RELATIONS, RELATION_ORDER_COLUMNS, canonical, sha256 } from './supabase-rest-ledger-core.mjs';

export const SOURCE_PROJECT_REF = 'izlkwggluhlhzlumtzes';
export const SOURCE_ORIGIN = `https://${SOURCE_PROJECT_REF}.supabase.co`;
export const SOURCE_SECRET_NAME = 'tracepoint/production/migration/source-production-epoch-capture-20260928';
export const ARTIFACT_BUCKET = 'tracepoint-production-private-193644343389';
export const ARTIFACT_KMS_KEY_ARN = 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55';
export const FENCE_ATTESTATION_KEY = 'migration/source/composite-fence-20260927/attestation.json';
export const STORAGE_BUCKETS = Object.freeze(['department-assets', 'tracepoint-attachments']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const APPROVED_RUN_IDS = Object.freeze({
  A: '1d761bd7-04dd-43f3-b77a-2c41130e18c2',
  B: 'c7448ea9-4645-4e99-b988-3a05de12ac70',
});
export const REQUIRED_WRITER_PATHS = Object.freeze([
  'publicAwsBridge', 'vercelProduction', 'vercelPreview', 'authExistingSession',
  'authNewSession', 'authServiceAdmin', 'storageAuthenticated', 'storageElevated',
  'storageS3', 'postgrestDirect', 'rpcFunctions', 'pgCron',
  'notificationBackground', 'adminImport', 'awsSourceRestHolders',
  'awsAppSecretReaders', 'externalCredentialHolders',
]);

export function validateCaptureEnvironment(env) {
  assert.equal(env.TRACEPOINT_SOURCE_PRODUCTION_PROJECT_REF, SOURCE_PROJECT_REF, 'PRODUCTION_PROJECT_REF_REQUIRED');
  assert.equal(env.TRACEPOINT_EXPECTED_AWS_ACCOUNT, '193644343389', 'EXACT_AWS_ACCOUNT_REQUIRED');
  assert.equal(env.SOURCE_PRODUCTION_PROJECT_URL, SOURCE_ORIGIN, 'PRODUCTION_SOURCE_URL_REQUIRED');
  const slot = env.TRACEPOINT_SOURCE_PRODUCTION_CAPTURE_SLOT;
  assert.ok(slot === 'A' || slot === 'B', 'CAPTURE_SLOT_REQUIRED');
  assert.match(env.TRACEPOINT_SOURCE_PRODUCTION_RUN_ID ?? '', UUID, 'RUN_UUID_REQUIRED');
  assert.equal(env.TRACEPOINT_SOURCE_PRODUCTION_RUN_ID, APPROVED_RUN_IDS[slot], 'EXACT_FINAL_CAPTURE_RUN_REQUIRED');
  assert.match(env.SOURCE_PRODUCTION_SERVICE_KEY ?? '', /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'PRODUCTION_CAPTURE_EPOCH_KEY_REQUIRED');
  return Object.freeze({ slot, runId: env.TRACEPOINT_SOURCE_PRODUCTION_RUN_ID,
    key: `migration/source/${env.TRACEPOINT_SOURCE_PRODUCTION_RUN_ID}/final-canonical.json` });
}

export function sourceRequest(method, url) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, SOURCE_ORIGIN, 'PRODUCTION_SOURCE_ONLY');
  assert.equal(parsed.protocol, 'https:', 'HTTPS_REQUIRED');
  const relation = parsed.pathname.slice('/rest/v1/'.length);
  const readPath = (parsed.pathname.startsWith('/rest/v1/') && MIGRATION_RELATIONS.includes(relation))
    || parsed.pathname === '/auth/v1/admin/users'
    || STORAGE_BUCKETS.some(bucket => parsed.pathname.startsWith(`/storage/v1/object/authenticated/${bucket}/`));
  const postReadPath = parsed.pathname === '/rest/v1/rpc/tracepoint_source_production_fence_status'
    || STORAGE_BUCKETS.some(bucket => parsed.pathname === `/storage/v1/object/list/${bucket}`);
  assert.ok((method === 'GET' && readPath) || (method === 'POST' && postReadPath), 'CAPTURE_READ_PATH_ONLY');
  return parsed;
}

export function relationUrl(relation, offset, limit = 500) {
  assert.ok(MIGRATION_RELATIONS.includes(relation), 'UNAPPROVED_RELATION');
  assert.ok(Number.isInteger(offset) && offset >= 0 && Number.isInteger(limit) && limit > 0 && limit <= 1000, 'INVALID_PAGE');
  const order = RELATION_ORDER_COLUMNS[relation] ?? ['id'];
  assert.ok(order.every(column => /^[a-z][a-z0-9_]*$/.test(column)), 'INVALID_ORDER_CONTRACT');
  return `${SOURCE_ORIGIN}/rest/v1/${relation}?select=*&order=${order.map(column => `${column}.asc`).join(',')}&offset=${offset}&limit=${limit}`;
}

export function objectPath(bucket, key) {
  assert.ok(STORAGE_BUCKETS.includes(bucket), 'UNAPPROVED_BUCKET');
  assert.ok(typeof key === 'string' && key.length > 0 && key.length < 1024, 'INVALID_OBJECT_KEY');
  const parts = key.split('/');
  assert.ok(parts.every(part => part && part !== '.' && part !== '..'), 'UNSAFE_OBJECT_KEY');
  return `${SOURCE_ORIGIN}/storage/v1/object/authenticated/${bucket}/${parts.map(encodeURIComponent).join('/')}`;
}

export function classifyStorageEntry(prefix, entry) {
  assert.ok(entry && typeof entry.name === 'string' && entry.name.length > 0 && !entry.name.includes('/'), 'UNSAFE_STORAGE_ENTRY');
  const fullKey = `${prefix}${entry.name}`;
  assert.ok(fullKey.split('/').every(part => part && part !== '.' && part !== '..'), 'UNSAFE_STORAGE_PATH');
  return entry.id == null ? { kind: 'folder', prefix: `${fullKey}/` } : { kind: 'object', key: fullKey };
}

export function attestFrozen(value) {
  assert.equal(value?.frozen, true, 'PRODUCTION_FENCE_NOT_ACTIVE');
  assert.equal(value?.database, 'postgres', 'SOURCE_DATABASE_MISMATCH');
  assert.equal(Number(value?.relation_count), 122, 'SOURCE_RELATION_COUNT_DRIFT');
  assert.equal(Number(value?.public_trigger_count), 174, 'PUBLIC_FENCE_TRIGGER_COUNT_DRIFT');
  assert.equal(value?.dispatcher_paused, true, 'SOURCE_DISPATCHER_NOT_PAUSED');
  assert.ok(Number.isFinite(Date.parse(value?.changed_at)), 'FENCE_TIMESTAMP_MISSING');
  return value.changed_at;
}

export function attestCompositeEvidence(value, fenceChangedAt, now = Date.now()) {
  assert.equal(value?.format, 'tracepoint-production-composite-fence/v3', 'COMPOSITE_EVIDENCE_FORMAT');
  assert.equal(value?.projectRef, SOURCE_PROJECT_REF, 'COMPOSITE_SOURCE_MISMATCH');
  assert.equal(value?.relationFingerprint, '36558b0730e3e96cad6426f38088a5b0', 'COMPOSITE_CATALOG_MISMATCH');
  assert.equal(value?.fenceChangedAt, fenceChangedAt, 'COMPOSITE_FENCE_TIMESTAMP_MISMATCH');
  assert.equal(value?.maintenance503, true, 'MAINTENANCE_BARRIER_NOT_ATTESTED');
  assert.equal(value?.publicTriggers, 174, 'PUBLIC_FENCE_NOT_ATTESTED');
  assert.equal(value?.s3WriterCredentials, 'NO_SEPARATE_S3_WRITER_CREDENTIALS', 'S3_WRITER_GATE_OPEN');
  const epoch = value?.credentialEpoch ?? {};
  assert.equal(epoch.captureSecretName, SOURCE_SECRET_NAME, 'CAPTURE_EPOCH_SECRET_MISMATCH');
  assert.equal(epoch.oldModernKeyRejected, true, 'OLD_MODERN_KEY_NOT_RETIRED');
  assert.equal(epoch.legacyServiceKeyDisabled, true, 'LEGACY_SERVICE_KEY_STILL_ACTIVE');
  assert.equal(epoch.captureKeyReads, true, 'CAPTURE_EPOCH_READ_UNPROVEN');
  assert.equal(epoch.rollbackKeyUnassignedToWriters, true, 'ROLLBACK_KEY_EXPOSED_TO_WRITER');
  assert.match(epoch.oldCredentialNegativeEvidenceSha256 ?? '', /^[0-9a-f]{64}$/,
    'OLD_EPOCH_NEGATIVE_EVIDENCE_UNPINNED');
  assert.equal(value?.legacyVercel?.projectId, 'prj_V03LJyQIc231luvZ9u0gcOAt4xK4',
    'LEGACY_VERCEL_PROJECT_MISMATCH');
  assert.equal(value?.legacyVercel?.productionOrigin, 'https://tracepoint-amber.vercel.app',
    'LEGACY_VERCEL_ORIGIN_MISMATCH');
  assert.equal(value?.legacyVercel?.paused503, true, 'LEGACY_VERCEL_PRODUCTION_NOT_PAUSED');
  const previewSafe = value?.legacyVercel?.previewProductionSourceExcluded === true ||
    (value?.legacyVercel?.previewAllDeploymentsBlocked === true &&
      value?.legacyVercel?.previewProjectWideDenyActive === true &&
      /^[0-9a-f]{64}$/.test(value?.legacyVercel?.previewNegativeEvidenceSha256 ?? ''));
  assert.equal(previewSafe, true, 'LEGACY_VERCEL_PREVIEW_SOURCE_UNPROVEN');
  const families = ['applicationApi', 'serviceRole', 'authApi', 'storageApi', 'background',
    'scheduledImportAdmin', 'legacyVercel'];
  assert.deepEqual(Object.keys(value?.writers ?? {}).sort(), families.sort(), 'WRITER_INVENTORY_INCOMPLETE');
  for (const family of families) {
    const entry = value.writers[family];
    assert.equal(typeof entry?.authoritativeMutationCapable, 'boolean', `WRITER_STATE_UNCLASSIFIED:${family}`);
    if (['applicationApi', 'serviceRole', 'authApi', 'storageApi', 'legacyVercel'].includes(family))
      assert.equal(entry.authoritativeMutationCapable, true, `AUTHORITATIVE_WRITER_MISCLASSIFIED:${family}`);
    if (entry.authoritativeMutationCapable) {
      assert.equal(entry.blocked, true, `WRITER_NOT_BLOCKED:${family}`);
      assert.equal(entry.directNegativePassed, true, `WRITER_NEGATIVE_MISSING:${family}`);
      assert.ok(typeof entry.reversibleControl === 'string' && entry.reversibleControl.length > 0,
        `WRITER_RESTORE_CONTROL_MISSING:${family}`);
      assert.match(entry.negativeEvidenceSha256 ?? '', /^[0-9a-f]{64}$/,
        `WRITER_NEGATIVE_EVIDENCE_UNPINNED:${family}`);
      assert.match(entry.restoreProcedureSha256 ?? '', /^[0-9a-f]{64}$/,
        `WRITER_RESTORE_PROCEDURE_UNPINNED:${family}`);
    } else {
      assert.equal(entry.ephemeralOnlyProven, true, `WRITER_EPHEMERAL_PROOF_MISSING:${family}`);
      assert.equal(entry.authoritativeFieldsUnaffected, true, `WRITER_AUTHORITY_EFFECT_UNPROVEN:${family}`);
      assert.equal(entry.canonicalComparatorExclusionTested, true, `WRITER_COMPARATOR_EXCLUSION_UNPROVEN:${family}`);
      assert.match(entry.ephemeralEvidenceSha256 ?? '', /^[0-9a-f]{64}$/,
        `WRITER_EPHEMERAL_EVIDENCE_UNPINNED:${family}`);
    }
  }
  assert.deepEqual(Object.keys(value?.writerPaths ?? {}).sort(), [...REQUIRED_WRITER_PATHS].sort(),
    'WRITER_PATH_INVENTORY_INCOMPLETE');
  for (const name of REQUIRED_WRITER_PATHS) {
    const path = value.writerPaths[name];
    if (name === 'storageS3' && path?.status === 'absent') {
      assert.equal(path.recheckedAtFreeze, true, 'S3_WRITER_ABSENCE_NOT_RECHECKED');
      assert.match(path.absenceEvidenceSha256 ?? '', /^[0-9a-f]{64}$/, 'S3_WRITER_ABSENCE_UNPINNED');
      continue;
    }
    assert.equal(path?.status, 'blocked', `WRITER_PATH_NOT_BLOCKED:${name}`);
    assert.equal(path.directNegativePassed, true, `WRITER_PATH_NEGATIVE_MISSING:${name}`);
    assert.match(path.negativeEvidenceSha256 ?? '', /^[0-9a-f]{64}$/,
      `WRITER_PATH_NEGATIVE_UNPINNED:${name}`);
    assert.match(path.restoreProcedureSha256 ?? '', /^[0-9a-f]{64}$/,
      `WRITER_PATH_RESTORE_UNPINNED:${name}`);
  }
  const observed = Date.parse(value?.observedAtUtc);
  assert.ok(Number.isFinite(observed) && observed <= now && now - observed <= 300_000,
    'COMPOSITE_EVIDENCE_STALE');
  return true;
}

export function buildArtifact({ runId, capturedAtUtc, fenceChangedAt, rowsByRelation, identities, objects }) {
  assert.match(runId, UUID);
  assert.ok(Number.isFinite(Date.parse(capturedAtUtc)));
  assert.ok(Number.isFinite(Date.parse(fenceChangedAt)));
  assert.deepEqual([...rowsByRelation.keys()], [...MIGRATION_RELATIONS], 'COMPLETE_RELATION_SET_REQUIRED');
  assert.ok(Array.isArray(identities) && Array.isArray(objects));
  const tables = [...rowsByRelation].map(([name, rows]) => ({ name, rows: rows.length, canonicalDataSha256: sha256(rows) }));
  const memberships = rowsByRelation.get('department_memberships');
  const body = {
    format: 'tracepoint-immutable-source-artifact/v1', runId,
    authorizationReference: 'TP-PRODUCTION-FINAL-SOURCE-20260927', capturedAtUtc,
    source: { provider: 'supabase-rest-admin', projectRef: SOURCE_PROJECT_REF, projectUrl: SOURCE_ORIGIN,
      readOnlyMethods: ['GET', 'POST:fixed-read-only-rpc-and-storage-list'], fenceChangedAt,
      relationContract: [...MIGRATION_RELATIONS] },
    tables, totalRelationalRows: tables.reduce((sum, table) => sum + table.rows, 0),
    identities: { count: identities.length, canonicalDataSha256: sha256(identities), rows: identities },
    memberships: { count: memberships.length, canonicalDataSha256: sha256(memberships) },
    objects: { count: objects.length, totalBytes: objects.reduce((sum, item) => sum + item.bytes, 0),
      manifestSha256: sha256(objects), manifest: objects },
    rows: Object.fromEntries(rowsByRelation),
  };
  const masterSha256 = sha256(body);
  const payload = canonical({ ...body, masterSha256 });
  return { body, payload, masterSha256, byteSha256: createHash('sha256').update(payload).digest('hex') };
}
