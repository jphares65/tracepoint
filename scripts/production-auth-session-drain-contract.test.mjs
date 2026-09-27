import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/production-cutover/20260927_drain_auth_sessions.sql', import.meta.url), 'utf8');

test('live Auth drain is source-pinned and requires the composite fence', () => {
  assert.match(sql, /izlkwggluhlhzlumtzes/);
  assert.match(sql, /36558b0730e3e96cad6426f38088a5b0/);
  assert.match(sql, /PRODUCTION_COMPOSITE_FENCE_NOT_ACTIVE/);
  assert.match(sql, /tracepoint_cutover\.write_fence_state/);
  assert.match(sql, /tracepoint_write_fence_dml/);
  assert.match(sql, /tracepoint_write_fence_truncate/);
  assert.match(sql, /tracepoint-notification-email-dispatch/);
});

test('drain deletes sessions and refresh tokens only, with exact after-counts', () => {
  const executable = sql.replace(/--[^\n]*/g, '');
  assert.match(executable, /DELETE FROM auth\.sessions;/);
  assert.match(executable, /DELETE FROM auth\.refresh_tokens;/);
  assert.doesNotMatch(executable, /(?:DELETE\s+FROM|UPDATE|TRUNCATE)\s+auth\.users\b/i);
  assert.match(executable, /sessions_deleted <> sessions_before/);
  assert.match(executable, /count\(\*\) FROM auth\.sessions\) <> 0/);
  assert.match(executable, /count\(\*\) FROM auth\.refresh_tokens\) <> 0/);
  assert.match(executable, /RAISE EXCEPTION 'PRODUCTION_AUTH_SESSION_DRAIN_INCOMPLETE'/);
});
