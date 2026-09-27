import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rejected } from './probe-paid-source-auth-storage-fence.mjs';

const source = readFileSync(new URL('./probe-paid-source-auth-storage-fence.mjs', import.meta.url), 'utf8');

test('paid-source writer probe is pinned and does not expose credential values', () => {
  assert.match(source, /https:\/\/reukdouvpshshvqnzsgw\.supabase\.co/);
  assert.match(source, /tracepoint\/production\/migration\/source-rehearsal-only-20260925/);
  assert.match(source, /193644343389/);
  assert.match(source, /SOURCE_PROJECT_MISMATCH/);
  assert.match(source, /AUTH_PROBE_PREEXISTS/);
  assert.match(source, /STORAGE_PROBE_PREEXISTS/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*\bkey\b/);
});

test('fence-on HTTP classification accepts only denied requests', () => {
  for (const status of [400, 401, 403, 409, 500, 503]) assert.equal(rejected(status), true);
  for (const status of [200, 201, 204, 302, 399, 600]) assert.equal(rejected(status), false);
});

test('paid-source SQL fence transitions are exact-project and reversible', () => {
  const off = readFileSync(new URL('../supabase/source-rehearsal/20260927_composite_fence_off.sql', import.meta.url), 'utf8');
  const on = readFileSync(new URL('../supabase/source-rehearsal/20260927_composite_fence_on.sql', import.meta.url), 'utf8');
  for (const sql of [off, on]) {
    assert.match(sql, /acb5b501-2309-4a9e-a504-f36c08728fa9/);
    assert.match(sql, /tracepoint-source-rehearsal-20260925/);
    assert.match(sql, /pg_trigger/);
    assert.match(sql, /cron\.job/);
    assert.match(sql, /BEGIN;/);
    assert.match(sql, /COMMIT;/);
    assert.doesNotMatch(sql, /DROP\s+(?:TABLE|FUNCTION|TRIGGER)|DELETE\s+FROM/i);
  }
  assert.match(off, /frozen = false/);
  assert.match(on, /frozen = true/);
});
