import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceBridgeElevatedKey, replaceMigrationRestKey } from './production-credential-rollback-core.mjs';

const oldKey = `sb_secret_${'o'.repeat(25)}`;
const newKey = `sb_secret_${'n'.repeat(25)}`;
const bridge = {
  CONFIGURATION_ENVIRONMENT: 'production', NEXT_PUBLIC_SITE_URL: 'https://tracepointhq.com',
  NEXT_PUBLIC_SUPABASE_URL: 'https://izlkwggluhlhzlumtzes.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key', SUPABASE_SECRET_KEY: oldKey,
  BREVO_API_KEY: 'synthetic', NOTIFICATION_DISPATCH_SECRET: 'n'.repeat(32),
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

test('bridge rollback changes only the elevated key and rejects old-key drift', () => {
  const result = replaceBridgeElevatedKey(bridge, oldKey, newKey);
  assert.equal(result.SUPABASE_SECRET_KEY, newKey);
  assert.deepEqual({ ...result, SUPABASE_SECRET_KEY: oldKey }, bridge);
  assert.throws(() => replaceBridgeElevatedKey(bridge, newKey, oldKey));
  assert.throws(() => replaceBridgeElevatedKey(bridge, oldKey, oldKey));
  assert.throws(() => replaceBridgeElevatedKey(bridge, oldKey, 'sb_publishable_invalid'));
});

test('migration REST rollback changes only the exact production source key', () => {
  const existing = { projectUrl: 'https://izlkwggluhlhzlumtzes.supabase.co', serviceRoleKey: oldKey };
  const result = replaceMigrationRestKey(existing, oldKey, newKey);
  assert.deepEqual(result, { ...existing, serviceRoleKey: newKey });
  assert.throws(() => replaceMigrationRestKey({ ...existing,
    projectUrl: 'https://reukdouvpshshvqnzsgw.supabase.co' }, oldKey, newKey));
  assert.throws(() => replaceMigrationRestKey(existing, newKey, oldKey));
});
