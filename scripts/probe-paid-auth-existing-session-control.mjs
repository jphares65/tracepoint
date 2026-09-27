#!/usr/bin/env node
// Isolated synthetic user only. Test whether disabling Email also blocks an
// already-issued user token from changing authoritative user metadata.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const PROJECT = 'reukdouvpshshvqnzsgw';
const ORIGIN = `https://${PROJECT}.supabase.co`;
const SECRET = 'tracepoint/production/migration/source-rehearsal-only-20260925';
const PUBLIC_KEY = process.env.TRACEPOINT_SOURCE_REHEARSAL_PUBLISHABLE_KEY;
const EMAIL = 'jphares+auth-existing-session-fence-20260927@tracepointhq.com';
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
async function waitForOperator() {
  const input = createInterface({ input: process.stdin, terminal: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { input.close(); reject(new Error('PROVIDER_TOGGLE_TIMEOUT')); }, 180_000);
    input.once('line', () => { clearTimeout(timer); input.close(); resolve(); });
  });
}

let key, userId;
try {
  assert.match(PUBLIC_KEY ?? '', /^sb_publishable_[A-Za-z0-9_-]{20,}$/);
  assert.equal(aws(['sts', 'get-caller-identity', '--query', 'Account']), '193644343389');
  key = aws(['secretsmanager', 'get-secret-value', '--secret-id', SECRET, '--query', 'SecretString']);
  assert.match(key, /^sb_secret_[A-Za-z0-9_-]{20,}$/);
  const pre = await call(key, 'GET', '/auth/v1/admin/users?page=1&per_page=200');
  assert.equal(pre.status, 200);
  assert.equal((await pre.json()).users.filter(user => user.email?.toLowerCase() === EMAIL).length, 0);
  const password = `Tp!${randomBytes(32).toString('base64url')}9`;
  const created = await call(key, 'POST', '/auth/v1/admin/users',
    { email: EMAIL, password, email_confirm: true, user_metadata: { fence_probe: 'before' } });
  assert.ok(created.ok, `CREATE_FAILED:${created.status}`);
  const newUser = await created.json();
  userId = newUser.id ?? newUser.user?.id;
  assert.match(userId ?? '', /^[0-9a-f-]{36}$/i);
  const signedIn = await call(PUBLIC_KEY, 'POST', '/auth/v1/token?grant_type=password', { email: EMAIL, password });
  assert.equal(signedIn.status, 200, 'SYNTHETIC_SIGNIN_FAILED');
  const token = (await signedIn.json()).access_token;
  assert.ok(typeof token === 'string' && token.length > 50);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.role, 'authenticated', 'USER_TOKEN_REQUIRED');
  console.log('PAID_AUTH_EXISTING_SESSION_READY_FOR_EMAIL_PROVIDER_DISABLE');
  await waitForOperator();
  const attempt = await call(PUBLIC_KEY, 'PUT', '/auth/v1/user',
    { data: { fence_probe: 'after' } }, token);
  const status = attempt.status;
  await attempt.arrayBuffer();
  const inspect = await call(key, 'GET', `/auth/v1/admin/users/${userId}`);
  assert.equal(inspect.status, 200);
  const inspected = await inspect.json();
  const metadata = inspected.user_metadata ?? inspected.user?.user_metadata;
  console.log(JSON.stringify({ projectRef: PROJECT, userTokenRole: 'authenticated',
    requestApiKeyClass: 'publishable',
    emailProviderDisabledByOperator: true, updateUserStatus: status,
    authoritativeUserMetadataChanged: metadata?.fence_probe === 'after',
    syntheticUserOnly: true, credentialValuesEmitted: false }));
} catch (error) {
  console.error(/^\w+(?::\d{3})?$/.test(error?.message ?? '') ? error.message : 'PAID_AUTH_USER_FENCE_PROBE_FAILED');
  process.exitCode = 2;
} finally {
  if (key && userId) {
    const removed = await call(key, 'DELETE', `/auth/v1/admin/users/${userId}`).catch(() => null);
    console.log(JSON.stringify({ syntheticUserCleanupStatus: removed?.status ?? 'REQUEST_FAILED' }));
    if (!removed?.ok) process.exitCode = 2;
  }
}
