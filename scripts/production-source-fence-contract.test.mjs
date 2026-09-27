import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const activation = readFileSync(new URL('../supabase/production-cutover/20260927_activate_source_fence.sql', import.meta.url), 'utf8');
const abort = readFileSync(new URL('../supabase/production-cutover/20260927_abort_source_fence.sql', import.meta.url), 'utf8');

test('production public-table fence and abort pin the full catalog but never alter managed Auth/Storage tables', () => {
  for (const sql of [activation, abort]) {
    assert.match(sql, /36558b0730e3e96cad6426f38088a5b0/);
    assert.match(sql, /public','auth','storage/);
    assert.match(sql, /174/);
    assert.match(sql, /PRODUCTION_SOURCE_.*DRIFT|PRODUCTION_SOURCE_FENCE_INSTALL_INCOMPLETE/);
    assert.doesNotMatch(sql, /reukdouvpshshvqnzsgw|wztqqqashilusoppddxi/);
  }
  assert.match(activation, /izlkwggluhlhzlumtzes/);
  assert.match(activation, /PRODUCTION_COMPOSITE_PREFLIGHT_BLOCKED/);
  assert.match(activation, /WHERE n\.nspname='public' AND c\.relkind IN/);
  assert.match(abort, /WHERE n\.nspname='public' AND c\.relkind IN/);
  assert.doesNotMatch(activation, /FOR r IN[\s\S]*?WHERE n\.nspname IN \('public','auth','storage'\) AND c\.relkind/);
});

test('activation protects public DML and truncate before commit, and pauses only pinned dispatcher', () => {
  assert.match(activation, /BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(activation, /BEFORE TRUNCATE/);
  assert.match(activation, /ENABLE ALWAYS TRIGGER tracepoint_write_fence_dml/);
  assert.match(activation, /ENABLE ALWAYS TRIGGER tracepoint_write_fence_truncate/);
  assert.match(activation, /ERRCODE='55000'/);
  assert.match(activation, /tracepoint-notification-email-dispatch/);
  assert.match(activation, /cron\.alter_job\(jobid, active := false\)/);
  assert.match(activation, /INSERT INTO tracepoint_cutover\.write_fence_state VALUES \(1, true/);
  assert.ok(activation.indexOf('PRODUCTION_SOURCE_FENCE_INSTALL_INCOMPLETE') < activation.lastIndexOf('COMMIT;'));
});

test('abort checks exact frozen state and job hash, removes only owned objects, then restores dispatcher', () => {
  assert.match(abort, /md5\(j\.command\)=s\.command_md5/);
  assert.match(abort, /DROP TRIGGER tracepoint_write_fence_dml/);
  assert.match(abort, /DROP TRIGGER tracepoint_write_fence_truncate/);
  assert.match(abort, /cron\.alter_job\(j\.jobid, active := true\)/);
  assert.match(abort, /DROP FUNCTION public\.tracepoint_source_production_fence_status/);
  assert.doesNotMatch(abort, /CASCADE|DROP SCHEMA public|DROP SCHEMA auth|DROP SCHEMA storage/);
});
