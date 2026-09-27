import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const origin = 'https://reukdouvpshshvqnzsgw.supabase.co';
const secretId = 'tracepoint/production/migration/source-rehearsal-only-20260925';
const probeEmail = 'jphares+source-fence-probe-20260927@tracepointhq.com';
const probeKey = 'source-fence-probe-20260927.txt';
const vehicleId = '4fe22291-4da8-4e98-acbe-e12be4a943ad';
const departmentId = 'acb5b501-2309-4a9e-a504-f36c08728fa9';

function awsValue(args) {
  try {
    return execFileSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
      [...args, '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'text'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim();
  } catch {
    throw new Error('AWS_REHEARSAL_ACCESS_FAILED');
  }
}

async function request(key, method, path, body, contentType = 'application/json') {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin, 'SOURCE_PROJECT_MISMATCH');
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { 'content-type': contentType }) },
    body,
  });
  return response;
}

async function authUsers(key) {
  const response = await request(key, 'GET', '/auth/v1/admin/users?page=1&per_page=200');
  assert.equal(response.status, 200, 'AUTH_INVENTORY_FAILED');
  const result = await response.json();
  assert.ok(Array.isArray(result.users) && result.users.length < 200, 'AUTH_INVENTORY_UNBOUNDED');
  return result.users.filter(user => user.email?.toLowerCase() === probeEmail).length;
}

async function storageObjects(key) {
  const response = await request(key, 'POST', '/storage/v1/object/list/tracepoint-attachments',
    JSON.stringify({ prefix: '', limit: 100, offset: 0 }));
  assert.equal(response.status, 200, 'STORAGE_INVENTORY_FAILED');
  const result = await response.json();
  assert.ok(Array.isArray(result) && result.length < 100, 'STORAGE_INVENTORY_UNBOUNDED');
  return result.filter(item => item.name === probeKey).length;
}

export function rejected(status) { return status >= 400 && status < 600; }

async function run() {
  const phase = process.argv[2];
  assert.ok(phase === '--on' || phase === '--off', 'PHASE_REQUIRED');
  assert.equal(awsValue(['sts', 'get-caller-identity', '--query', 'Account']), '193644343389', 'AWS_ACCOUNT_MISMATCH');
  const key = awsValue(['secretsmanager', 'get-secret-value', '--secret-id', secretId, '--query', 'SecretString']);
  assert.match(key, /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'SOURCE_KEY_INVALID');
  const state = await request(key, 'POST', '/rest/v1/rpc/tracepoint_source_rehearsal_fence_status', '{}');
  assert.equal(state.status, 200, 'FENCE_ATTESTATION_FAILED');
  assert.equal((await state.json()).frozen, phase === '--on', 'SOURCE_FENCE_PHASE_MISMATCH');
  assert.equal(await authUsers(key), 0, 'AUTH_PROBE_PREEXISTS');
  assert.equal(await storageObjects(key), 0, 'STORAGE_PROBE_PREEXISTS');

  if (phase === '--off') {
    const auth = await request(key, 'POST', '/auth/v1/admin/users',
      JSON.stringify({ email: probeEmail, email_confirm: true }));
    const authStatus = auth.status;
    const authBody = await auth.json().catch(() => null);
    assert.ok(authStatus >= 200 && authStatus < 300, `AUTH_POSITIVE_FAILED:${authStatus}`);
    const userId = authBody?.id ?? authBody?.user?.id;
    assert.match(userId ?? '', /^[0-9a-f-]{36}$/i, 'AUTH_POSITIVE_ID_MISSING');
    assert.equal(await authUsers(key), 1, 'AUTH_POSITIVE_NOT_PERSISTED');
    const authDelete = await request(key, 'DELETE', `/auth/v1/admin/users/${userId}`);
    assert.ok(authDelete.status >= 200 && authDelete.status < 300, `AUTH_CLEANUP_FAILED:${authDelete.status}`);
    assert.equal(await authUsers(key), 0, 'AUTH_CLEANUP_NOT_PERSISTED');

    const storage = await request(key, 'POST', `/storage/v1/object/tracepoint-attachments/${probeKey}`,
      'TracePoint paid-source fence probe', 'text/plain');
    const storageStatus = storage.status;
    await storage.arrayBuffer();
    assert.ok(storageStatus >= 200 && storageStatus < 300, `STORAGE_POSITIVE_FAILED:${storageStatus}`);
    assert.equal(await storageObjects(key), 1, 'STORAGE_POSITIVE_NOT_PERSISTED');
    const storageDelete = await request(key, 'DELETE', `/storage/v1/object/tracepoint-attachments/${probeKey}`);
    assert.ok(storageDelete.status >= 200 && storageDelete.status < 300, `STORAGE_CLEANUP_FAILED:${storageDelete.status}`);
    assert.equal(await storageObjects(key), 0, 'STORAGE_CLEANUP_NOT_PERSISTED');

    const path = `/rest/v1/fleet_vehicles?id=eq.${vehicleId}&department_id=eq.${departmentId}&select=id`;
    const rest = await request(key, 'PATCH', path, JSON.stringify({ id: vehicleId }));
    const restStatus = rest.status;
    await rest.arrayBuffer();
    assert.ok(restStatus >= 200 && restStatus < 300, `REST_POSITIVE_FAILED:${restStatus}`);
    const vehicle = await request(key, 'GET', path);
    assert.equal(vehicle.status, 200, 'REST_POSITIVE_READ_FAILED');
    assert.equal((await vehicle.json()).length, 1, 'REST_POSITIVE_ROW_CHANGED');
    console.log(JSON.stringify({ result: 'PAID_SOURCE_WRITER_POSITIVES_PASS', sourceProject: 'reukdouvpshshvqnzsgw',
      authStatus, storageStatus, restStatus, authProbeRowsAfterCleanup: 0, storageProbeObjectsAfterCleanup: 0,
      credentialsLogged: false }));
    return;
  }

  // Admin createUser does not send an invitation. If this succeeds, leave the
  // exact synthetic identity for controlled cleanup after the fence is off.
  const auth = await request(key, 'POST', '/auth/v1/admin/users',
    JSON.stringify({ email: probeEmail, email_confirm: true }));
  const authStatus = auth.status;
  await auth.arrayBuffer();
  const authAfter = await authUsers(key);
  if (!rejected(authStatus) || authAfter !== 0) {
    throw new Error(`AUTH_FENCE_GAP:${authStatus}:${authAfter}`);
  }

  const storage = await request(key, 'POST', `/storage/v1/object/tracepoint-attachments/${probeKey}`,
    'TracePoint paid-source fence probe', 'text/plain');
  const storageStatus = storage.status;
  await storage.arrayBuffer();
  const storageAfter = await storageObjects(key);
  if (!rejected(storageStatus) || storageAfter !== 0) {
    throw new Error(`STORAGE_FENCE_GAP:${storageStatus}:${storageAfter}`);
  }
  console.log(JSON.stringify({ result: 'PAID_SOURCE_AUTH_STORAGE_FENCE_PASS', sourceProject: 'reukdouvpshshvqnzsgw',
    authStatus, storageStatus, authProbeRows: 0, storageProbeObjects: 0, credentialsLogged: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(error => {
    const safe = /^(?:PHASE_REQUIRED|AWS_REHEARSAL_ACCESS_FAILED|AWS_ACCOUNT_MISMATCH|SOURCE_KEY_INVALID|FENCE_ATTESTATION_FAILED|SOURCE_FENCE_PHASE_MISMATCH|AUTH_INVENTORY_FAILED|AUTH_INVENTORY_UNBOUNDED|STORAGE_INVENTORY_FAILED|STORAGE_INVENTORY_UNBOUNDED|AUTH_PROBE_PREEXISTS|STORAGE_PROBE_PREEXISTS|AUTH_POSITIVE_FAILED:\d{3}|AUTH_POSITIVE_ID_MISSING|AUTH_POSITIVE_NOT_PERSISTED|AUTH_CLEANUP_FAILED:\d{3}|AUTH_CLEANUP_NOT_PERSISTED|STORAGE_POSITIVE_FAILED:\d{3}|STORAGE_POSITIVE_NOT_PERSISTED|STORAGE_CLEANUP_FAILED:\d{3}|STORAGE_CLEANUP_NOT_PERSISTED|REST_POSITIVE_FAILED:\d{3}|REST_POSITIVE_READ_FAILED|REST_POSITIVE_ROW_CHANGED|AUTH_FENCE_GAP:\d{3}:\d+|STORAGE_FENCE_GAP:\d{3}:\d+)$/;
    console.error(safe.test(error?.message ?? '') ? error.message : 'PAID_SOURCE_AUTH_STORAGE_PROBE_FAILED');
    process.exitCode = 1;
  });
}
