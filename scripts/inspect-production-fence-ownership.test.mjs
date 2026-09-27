import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const probe = readFileSync(new URL('./inspect-production-fence-ownership.mjs', import.meta.url), 'utf8');
const activation = readFileSync(new URL('../supabase/production-cutover/20260927_activate_source_fence.sql', import.meta.url), 'utf8');

test('owner inventory is pinned, TLS-verified, and read-only', () => {
  assert.match(probe, /izlkwggluhlhzlumtzes/);
  assert.match(probe, /BEGIN READ ONLY/);
  assert.match(probe, /rejectUnauthorized: true/);
  assert.match(probe, /PRODUCTION_RELATION_FINGERPRINT_DRIFT/);
  assert.match(probe, /pg_has_role\('postgres', c\.relowner, 'MEMBER'\)/);
  assert.match(probe, /has_table_privilege\('postgres', c\.oid, 'TRIGGER'\)/);
  assert.doesNotMatch(probe, /INSERT INTO|UPDATE auth\.|DELETE FROM|ALTER TABLE/);
});

test('readiness requires public ownership, not managed Auth/Storage ownership', () => {
  assert.match(probe, /r\.schema_name === 'public' && !r\.postgres_member_of_owner/);
  assert.match(probe, /PUBLIC_TRIGGER_PREFLIGHT_BLOCKED/);
  assert.match(probe, /process\.exitCode = 2/);
  assert.match(activation, /PUBLIC-TABLE LAYER ONLY/);
  assert.doesNotMatch(activation, /OWNER_CONTROLLED_FENCE_NOT_PROVEN/);
});
