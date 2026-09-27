#!/usr/bin/env node
// Isolated paid-project synthetic session only. Coordinates a guarded SQL
// session revocation and Email provider toggle; never emits credentials.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const PROJECT = 'reukdouvpshshvqnzsgw';
const ORIGIN = `https://${PROJECT}.supabase.co`;
const SECRET = 'tracepoint/production/migration/source-rehearsal-only-20260925';
const PUBLIC_KEY = process.env.TRACEPOINT_SOURCE_REHEARSAL_PUBLISHABLE_KEY;
const EMAIL = 'jphares+auth-db-session-fence-20260927@tracepointhq.com';

function aws(args) {
  return execFileSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...args, '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'text'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim();
}
async function call(key, method, path, body, bearer = key) {
  const url = new URL(path, ORIGIN);
  assert.equal(url.origin, ORIGIN);
  return fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function waitForOperator(label) {
  console.log(label);
  const input = createInterface({ input: process.stdin, terminal: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { input.close(); reject(new Error('OPERATOR_STEP_TIMEOUT')); }, 900_000);
    input.once('line', () => { clearTimeout(timer); input.close(); resolve(); });
  });
}
let key, userId;
try {
  assert.match(PUBLIC_KEY ?? '', /^sb_publishable_[A-Za-z0-9_-]{20,}$/);
  assert.equal(aws(['sts', 'get-caller-identity', '--query', 'Account']), '193644343389');
  key = aws(['secretsmanager', 'get-secret-value', '--secret-id', SECRET, '--query', 'SecretString']);
  assert.match(key, /^sb_secret_[A-Za-z0-9_-]{20,}$/);
  const before = await call(key, 'GET', '/auth/v1/admin/users?page=1&per_page=200');
  assert.equal(before.status, 200);
  assert.equal((await before.json()).users.filter(user => user.email?.toLowerCase() === EMAIL).length, 0);
  const password = `Tp!${randomBytes(32).toString('base64url')}9`;
  const created = await call(key, 'POST', '/auth/v1/admin/users',
    { email: EMAIL, password, email_confirm: true, user_metadata: { db_fence_probe: 'before' } });
  assert.equal(created.status, 200, 'SYNTHETIC_CREATE_FAILED');
  const newUser = await created.json();
  userId = newUser.id ?? newUser.user?.id;
  assert.match(userId ?? '', /^[0-9a-f-]{36}$/i);
  const signIn = await call(PUBLIC_KEY, 'POST', '/auth/v1/token?grant_type=password', { email: EMAIL, password });
  assert.equal(signIn.status, 200, 'SYNTHETIC_SIGNIN_FAILED');
  const session = await signIn.json();
  assert.ok(typeof session.access_token === 'string' && typeof session.refresh_token === 'string');
  const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.sub, userId);
  assert.equal(claims.role, 'authenticated');
  const baseline = await call(PUBLIC_KEY, 'PUT', '/auth/v1/user',
    { data: { db_fence_probe: 'baseline' } }, session.access_token);
  assert.equal(baseline.status, 200, 'BASELINE_USER_WRITE_FAILED');
  await baseline.arrayBuffer();

  await waitForOperator('PAID_AUTH_DB_SESSION_READY_FOR_EMAIL_DISABLE_AND_EXACT_SYNTHETIC_SESSION_REVOCATION');
  const newSignIn = await call(PUBLIC_KEY, 'POST', '/auth/v1/token?grant_type=password', { email: EMAIL, password });
  const newSignInStatus = newSignIn.status;
  await newSignIn.arrayBuffer();
  const refresh = await call(PUBLIC_KEY, 'POST', '/auth/v1/token?grant_type=refresh_token',
    { refresh_token: session.refresh_token });
  const refreshStatus = refresh.status;
  await refresh.arrayBuffer();
  const update = await call(PUBLIC_KEY, 'PUT', '/auth/v1/user',
    { data: { db_fence_probe: 'fence_failed' } }, session.access_token);
  const oldTokenUpdateStatus = update.status;
  await update.arrayBuffer();
  const inspect = await call(key, 'GET', `/auth/v1/admin/users/${userId}`);
  assert.equal(inspect.status, 200, 'CAPTURE_READ_FAILED');
  const inspected = await inspect.json();
  const metadata = inspected.user_metadata ?? inspected.user?.user_metadata;
  const authoritativeUnchanged = metadata?.db_fence_probe === 'baseline';
  console.log(JSON.stringify({ projectRef: PROJECT, syntheticUserOnly: true,
    newSignInStatus, refreshStatus, oldTokenUpdateStatus,
    authoritativeUnchanged, captureReadStatus: inspect.status,
    credentialValuesEmitted: false }));
  assert.ok(newSignInStatus >= 400 && refreshStatus >= 400 && oldTokenUpdateStatus >= 400 && authoritativeUnchanged,
    'COMPOSITE_AUTH_FENCE_FAILED');

  await waitForOperator('PAID_AUTH_DB_SESSION_READY_FOR_EMAIL_RESTORE');
  const restoredSignIn = await call(PUBLIC_KEY, 'POST', '/auth/v1/token?grant_type=password', { email: EMAIL, password });
  assert.equal(restoredSignIn.status, 200, 'RESTORED_SIGNIN_FAILED');
  const restoredSession = await restoredSignIn.json();
  const restoredWrite = await call(PUBLIC_KEY, 'PUT', '/auth/v1/user',
    { data: { db_fence_probe: 'restored' } }, restoredSession.access_token);
  assert.equal(restoredWrite.status, 200, 'RESTORED_AUTH_WRITE_FAILED');
  await restoredWrite.arrayBuffer();
  console.log(JSON.stringify({ restorationSignInStatus: restoredSignIn.status,
    restorationUserWriteStatus: restoredWrite.status, syntheticUserOnly: true }));
} catch (error) {
  console.error(/^[A-Z_]+(?::\d{3})?$/.test(error?.message ?? '') ? error.message : 'PAID_AUTH_DB_SESSION_PROBE_FAILED');
  process.exitCode = 2;
} finally {
  if (key && userId) {
    const removed = await call(key, 'DELETE', `/auth/v1/admin/users/${userId}`).catch(() => null);
    console.log(JSON.stringify({ syntheticUserCleanupStatus: removed?.status ?? 'REQUEST_FAILED' }));
    if (!removed?.ok) process.exitCode = 2;
  }
}
