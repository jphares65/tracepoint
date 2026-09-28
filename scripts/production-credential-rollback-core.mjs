import assert from 'node:assert/strict';
import { validateProductionSecret } from './production-publication-core.mjs';

export const PRODUCTION_APPLICATION_SECRET = 'tracepoint/production/application';
export const PRODUCTION_MIGRATION_REST_SECRET = 'tracepoint/production/migration/source-supabase-rest';
export const PRODUCTION_ROLLBACK_SECRET = 'tracepoint/production/migration/source-production-epoch-rollback-20260928';

export function replaceBridgeElevatedKey(existing, expectedOldKey, rollbackKey) {
  validateProductionSecret(existing);
  assert.equal(existing.SUPABASE_SECRET_KEY, expectedOldKey, 'BRIDGE_OLD_EPOCH_MISMATCH');
  assert.match(rollbackKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'ROLLBACK_MODERN_KEY_REQUIRED');
  assert.notEqual(rollbackKey, expectedOldKey, 'ROLLBACK_KEY_NOT_DISTINCT');
  const next = { ...existing, SUPABASE_SECRET_KEY: rollbackKey };
  validateProductionSecret(next);
  assert.deepEqual(Object.keys(next).sort(), Object.keys(existing).sort(), 'BRIDGE_SECRET_SHAPE_CHANGED');
  for (const name of Object.keys(existing).filter(key => key !== 'SUPABASE_SECRET_KEY'))
    assert.equal(next[name], existing[name], `BRIDGE_SECRET_FIELD_CHANGED:${name}`);
  return next;
}

export function replaceMigrationRestKey(existing, expectedOldKey, rollbackKey) {
  assert.equal(existing?.projectUrl, 'https://izlkwggluhlhzlumtzes.supabase.co', 'MIGRATION_SOURCE_MISMATCH');
  assert.equal(existing?.serviceRoleKey, expectedOldKey, 'MIGRATION_OLD_EPOCH_MISMATCH');
  assert.match(rollbackKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'ROLLBACK_MODERN_KEY_REQUIRED');
  assert.notEqual(rollbackKey, expectedOldKey, 'ROLLBACK_KEY_NOT_DISTINCT');
  const next = { ...existing, serviceRoleKey: rollbackKey };
  assert.deepEqual(Object.keys(next).sort(), Object.keys(existing).sort(), 'MIGRATION_SECRET_SHAPE_CHANGED');
  for (const name of Object.keys(existing).filter(key => key !== 'serviceRoleKey'))
    assert.equal(next[name], existing[name], `MIGRATION_SECRET_FIELD_CHANGED:${name}`);
  return next;
}
