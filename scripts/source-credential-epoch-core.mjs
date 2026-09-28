import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const SOURCE_CREDENTIALS = Object.freeze([
  Object.freeze({ name: 'tracepoint/production/migration/source-supabase-rest', projectRef: 'izlkwggluhlhzlumtzes' }),
  Object.freeze({ name: 'tracepoint/production/migration/source-rehearsal-only-20260925', projectRef: 'reukdouvpshshvqnzsgw' }),
]);

export const PRODUCTION_EPOCH = Object.freeze({
  projectRef: 'izlkwggluhlhzlumtzes',
  captureKeyName: 'tracepoint_epoch_production_capture_20260928',
  rollbackKeyName: 'tracepoint_epoch_production_rollback_20260928',
  captureSecretName: 'tracepoint/production/migration/source-production-epoch-capture-20260928',
  rollbackSecretName: 'tracepoint/production/migration/source-production-epoch-rollback-20260928',
});

export function classifySourceSecret(secretString, expectedProjectRef) {
  assert.ok(expectedProjectRef === 'reukdouvpshshvqnzsgw' ||
    expectedProjectRef === 'izlkwggluhlhzlumtzes', 'UNAPPROVED_SOURCE_PROJECT');
  if (
    /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(secretString)) return 'modern_secret';
  const value = JSON.parse(secretString);
  const projectUrl = value.projectUrl ?? value.NEXT_PUBLIC_SUPABASE_URL;
  assert.equal(projectUrl, `https://${expectedProjectRef}.supabase.co`, 'SOURCE_PROJECT_MISMATCH');
  const key = value.serviceRoleKey ?? value.SUPABASE_SECRET_KEY;
  assert.equal(typeof key, 'string', 'SOURCE_ELEVATED_KEY_MISSING');
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) return 'modern_secret';
  if (/^eyJ[A-Za-z0-9_.-]{40,}$/.test(key)) return 'legacy_service_role_candidate';
  throw new Error('SOURCE_ELEVATED_KEY_FORMAT_UNRECOGNIZED');
}

export function fingerprintSourceSecret(secretString, expectedProjectRef) {
  classifySourceSecret(secretString, expectedProjectRef);
  const value = secretString.startsWith('sb_secret_') ? secretString :
    (JSON.parse(secretString).serviceRoleKey ?? JSON.parse(secretString).SUPABASE_SECRET_KEY);
  return createHash('sha256').update(value).digest('hex');
}

export function assertDistinctEpochKeys(keys) {
  assert.equal(keys.length, 3, 'THREE_EPOCH_KEYS_REQUIRED');
  assert.ok(keys.every(key => /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)), 'MODERN_SECRET_REQUIRED');
  assert.equal(new Set(keys).size, 3, 'EPOCH_KEYS_NOT_DISTINCT');
}

export function rejectedCredential(status) { return status === 401 || status === 403; }

export function rejectedStorageCredential(oldStatus, oldError, liveStatus) {
  return rejectedCredential(oldStatus) || (oldStatus === 400 && liveStatus === 200
    && oldError?.code === 'AccessDenied' && oldError?.error === 'Unauthorized');
}
