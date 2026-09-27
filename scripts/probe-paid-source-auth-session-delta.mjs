#!/usr/bin/env node
// Paid source rehearsal only. Emits field names/booleans, never user values or credentials.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const origin = 'https://reukdouvpshshvqnzsgw.supabase.co';
const email = 'source-session-classification-20260927@example.invalid';
const key = process.env.TRACEPOINT_PAID_SOURCE_KEY;
assert.match(key ?? '', /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'PAID_SOURCE_KEY_REQUIRED');
delete process.env.TRACEPOINT_PAID_SOURCE_KEY;

async function call(method, path, body, bearer = key) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'PAID_PROJECT_ONLY');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { apikey: key, authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function changedPaths(before, after, prefix = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return [prefix];
    return before.flatMap((value, index) => changedPaths(value, after[index], `${prefix}[${index}]`));
  }
  if (before && after && typeof before === 'object' && typeof after === 'object')
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .flatMap(name => changedPaths(before[name], after[name], prefix ? `${prefix}.${name}` : name));
  return [prefix];
}

async function run() {
  const fence = await call('POST', '/rest/v1/rpc/tracepoint_source_rehearsal_fence_status', {});
  assert.equal(fence.status, 200, 'PAID_FENCE_READ_FAILED');
  assert.equal(fence.body?.frozen, false, 'PAID_FENCE_MUST_BE_OFF_FOR_FIXTURE_SETUP');
  const inventory = await call('GET', '/auth/v1/admin/users?page=1&per_page=200');
  assert.equal(inventory.status, 200, 'PAID_AUTH_INVENTORY_FAILED');
  assert.ok(Array.isArray(inventory.body?.users) && inventory.body.users.length < 200, 'PAID_AUTH_INVENTORY_UNBOUNDED');
  assert.equal(inventory.body.users.filter(user => user.email === email).length, 0, 'PROBE_IDENTITY_PREEXISTS');
  const password = `Tp!${randomBytes(36).toString('base64url')}9a`;
  let id;
  try {
    const created = await call('POST', '/auth/v1/admin/users', { email, password, email_confirm: true });
    assert.ok(created.status >= 200 && created.status < 300, `PROBE_CREATE_FAILED:${created.status}`);
    id = created.body?.id ?? created.body?.user?.id;
    assert.match(id ?? '', /^[0-9a-f-]{36}$/i, 'PROBE_ID_MISSING');
    const beforeResult = await call('GET', `/auth/v1/admin/users/${id}`);
    assert.equal(beforeResult.status, 200, 'PROBE_BEFORE_READ_FAILED');
    const before = beforeResult.body?.user ?? beforeResult.body;
    const login = await call('POST', '/auth/v1/token?grant_type=password', { email, password });
    assert.equal(login.status, 200, `PROBE_LOGIN_FAILED:${login.status}`);
    assert.ok(typeof login.body?.access_token === 'string', 'PROBE_TOKEN_MISSING');
    const afterResult = await call('GET', `/auth/v1/admin/users/${id}`);
    assert.equal(afterResult.status, 200, 'PROBE_AFTER_READ_FAILED');
    const after = afterResult.body?.user ?? afterResult.body;
    const changed = changedPaths(before, after);
    console.log(JSON.stringify({ result: 'PAID_AUTH_SIGNIN_FIELD_DELTA_OBSERVED', project: 'reukdouvpshshvqnzsgw',
      fenceFrozen: false, changedFieldPaths: changed, userValuesLogged: false, credentialsLogged: false }));
  } finally {
    if (id) {
      const deleted = await call('DELETE', `/auth/v1/admin/users/${id}`);
      assert.ok(deleted.status >= 200 && deleted.status < 300, `PROBE_CLEANUP_FAILED:${deleted.status}`);
      const after = await call('GET', '/auth/v1/admin/users?page=1&per_page=200');
      assert.equal(after.status, 200, 'PROBE_CLEANUP_READ_FAILED');
      assert.equal(after.body.users.filter(user => user.email === email).length, 0, 'PROBE_IDENTITY_REMAINS');
    }
  }
}

run().catch(error => {
  const message = String(error?.message ?? 'UNKNOWN');
  console.error(/^(?:[A-Z_]+|PROBE_(?:CREATE|LOGIN|CLEANUP)_FAILED:\d{3})$/.test(message)
    ? message : 'PAID_AUTH_SESSION_PROBE_FAILED');
  process.exitCode = 1;
});
