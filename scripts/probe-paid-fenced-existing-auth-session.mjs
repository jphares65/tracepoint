#!/usr/bin/env node
// Interactive, exact-project rehearsal probe. Never prints credentials or row data.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const origin = 'https://reukdouvpshshvqnzsgw.supabase.co';
const email = 'source-fenced-session-20260927@example.invalid';
const key = process.env.TRACEPOINT_PAID_SOURCE_KEY;
assert.match(key ?? '', /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'PAID_SOURCE_KEY_REQUIRED');
delete process.env.TRACEPOINT_PAID_SOURCE_KEY;

async function call(method, path, body) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'PAID_PROJECT_ONLY');
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function fenceIs(expected) {
  const result = await call('POST', '/rest/v1/rpc/tracepoint_source_rehearsal_fence_status', {});
  assert.equal(result.status, 200, 'FENCE_STATUS_UNAVAILABLE');
  assert.equal(result.body?.frozen, expected, expected ? 'FENCE_NOT_ON' : 'FENCE_NOT_OFF');
}

async function lookup() {
  const result = await call('GET', '/auth/v1/admin/users?page=1&per_page=200');
  assert.equal(result.status, 200, 'AUTH_INVENTORY_UNAVAILABLE');
  assert.ok(Array.isArray(result.body?.users) && result.body.users.length < 200,
    'AUTH_INVENTORY_UNBOUNDED');
  const matches = result.body.users.filter(user => user.email === email);
  assert.ok(matches.length <= 1, 'DUPLICATE_PROBE_IDENTITY');
  return matches[0]?.id;
}

function changedPaths(before, after, prefix = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length)
      return [prefix];
    return before.flatMap((value, index) => changedPaths(value, after[index], `${prefix}[${index}]`));
  }
  if (before && after && typeof before === 'object' && typeof after === 'object')
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .flatMap(name => changedPaths(before[name], after[name], prefix ? `${prefix}.${name}` : name));
  return [prefix];
}

async function readUser(id) {
  const result = await call('GET', `/auth/v1/admin/users/${id}`);
  assert.equal(result.status, 200, 'AUTH_USER_READ_FAILED');
  return result.body?.user ?? result.body;
}

async function cleanup() {
  await fenceIs(false);
  const id = await lookup();
  if (id) {
    const result = await call('DELETE', `/auth/v1/admin/users/${id}`);
    assert.ok(result.status >= 200 && result.status < 300, 'PROBE_CLEANUP_FAILED');
  }
  assert.equal(await lookup(), undefined, 'PROBE_IDENTITY_REMAINS');
  console.log('PAID_AUTH_PROBE_CLEANUP_PASS');
}

async function run() {
  if (process.argv[2] === '--cleanup') return cleanup();
  if (process.argv[2] === '--provider-admin-bypass') {
    await fenceIs(false);
    const adminEmail = 'source-provider-admin-probe-20260927@example.invalid';
    const inventory = await call('GET', '/auth/v1/admin/users?page=1&per_page=200');
    assert.equal(inventory.status, 200, 'ADMIN_INVENTORY_UNAVAILABLE');
    assert.ok(!inventory.body?.users?.some(user => user.email === adminEmail),
      'ADMIN_PROBE_IDENTITY_PREEXISTS');
    const created = await call('POST', '/auth/v1/admin/users', {
      email: adminEmail, password: `Tp!${randomBytes(36).toString('base64url')}9a`,
      email_confirm: true,
    });
    const id = created.body?.id ?? created.body?.user?.id;
    try {
      assert.ok(created.status >= 200 && created.status < 300,
        `ADMIN_CREATE_STATUS_${created.status}`);
      assert.match(id ?? '', /^[0-9a-f-]{36}$/i, 'ADMIN_PROBE_ID_MISSING');
      console.log(JSON.stringify({ result: 'PAID_DISABLED_PROVIDER_ADMIN_CREATE',
        status: created.status, created: true, valuesLogged: false }));
    } finally {
      if (id) {
        const removed = await call('DELETE', `/auth/v1/admin/users/${id}`);
        assert.ok(removed.status >= 200 && removed.status < 300,
          'ADMIN_PROBE_CLEANUP_FAILED');
      }
    }
    return;
  }
  const mode = process.argv[2];
  assert.ok(['--interactive', '--provider-interactive'].includes(mode),
    'EXPECTED_INTERACTIVE_OR_CLEANUP');
  await fenceIs(false);
  assert.equal(await lookup(), undefined, 'PROBE_IDENTITY_PREEXISTS');
  const password = `Tp!${randomBytes(36).toString('base64url')}9a`;
  const created = await call('POST', '/auth/v1/admin/users',
    { email, password, email_confirm: true });
  assert.ok(created.status >= 200 && created.status < 300, 'PROBE_CREATE_FAILED');
  const id = created.body?.id ?? created.body?.user?.id;
  assert.match(id ?? '', /^[0-9a-f-]{36}$/i, 'PROBE_ID_MISSING');
  console.log('PAID_AUTH_PROBE_FIXTURE_READY');
  const input = createInterface({ input: process.stdin, terminal: false });
  let probed = false;
  for await (const line of input) {
    if (line.trim() === 'baseline' && mode === '--provider-interactive' && !probed) {
      await fenceIs(false);
      const login = await call('POST', '/auth/v1/token?grant_type=password', { email, password });
      assert.equal(login.status, 200, 'BASELINE_LOGIN_FAILED');
      assert.ok(typeof login.body?.access_token === 'string', 'BASELINE_TOKEN_MISSING');
      console.log(JSON.stringify({ result: 'PAID_EMAIL_PROVIDER_BASELINE_PASS',
        status: login.status, tokenIssued: true, valuesLogged: false }));
    } else if (line.trim() === 'login' && !probed) {
      await fenceIs(mode === '--interactive');
      assert.equal(await lookup(), id, 'PROBE_IDENTITY_CHANGED');
      const before = await readUser(id);
      const login = await call('POST', '/auth/v1/token?grant_type=password', { email, password });
      const after = await readUser(id);
      console.log(JSON.stringify({ result: mode === '--interactive' ?
        'PAID_FENCED_EXISTING_USER_SIGNIN' : 'PAID_DISABLED_PROVIDER_EXISTING_USER_SIGNIN',
        project: 'reukdouvpshshvqnzsgw', status: login.status,
        tokenIssued: login.status === 200 && typeof login.body?.access_token === 'string',
        changedAdminFieldPaths: changedPaths(before, after), valuesLogged: false }));
      probed = true;
    } else if (line.trim() === 'cleanup') {
      await cleanup();
      input.close();
      process.stdin.pause();
      return;
    } else {
      throw new Error('UNEXPECTED_PROBE_COMMAND');
    }
  }
  throw new Error('PROBE_INPUT_CLOSED_BEFORE_CLEANUP');
}

run().catch(error => {
  const code = String(error?.message ?? 'UNKNOWN');
  console.error(/^[A-Z_]+$/.test(code) ? code : 'PAID_AUTH_FENCE_PROBE_FAILED');
  process.exitCode = 1;
});
