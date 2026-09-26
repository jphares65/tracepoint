import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const region = 'us-east-1';
const account = '193644343389';
const secretId = 'tracepoint/production/migration/source-rehearsal-only-20260925';
const origin = 'https://reukdouvpshshvqnzsgw.supabase.co';
const vehicleId = '4fe22291-4da8-4e98-acbe-e12be4a943ad';
const departmentId = 'acb5b501-2309-4a9e-a504-f36c08728fa9';

function awsValue(args) {
  try {
    return execFileSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
      [...args, '--profile', 'tracepoint-production', '--region', region, '--output', 'text'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim();
  } catch {
    // Never print a CLI exception: it can include captured secret stdout.
    throw new Error('AWS_REHEARSAL_CREDENTIAL_READ_FAILED');
  }
}

export function classifyFenceResponse(status, body) {
  return status >= 400 && body?.code === '55000' ? 'FENCE_REJECTED' : 'FENCE_NOT_PROVEN';
}

async function request(key, method, path, body) {
  const url = new URL(path, origin);
  assert.equal(url.origin, origin);
  const response = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const parsed = await response.json().catch(() => null);
  return { status: response.status, body: parsed };
}

async function frozenState(key) {
  const result = await request(key, 'POST', '/rest/v1/rpc/tracepoint_source_rehearsal_fence_status', {});
  assert.equal(result.status, 200, 'SOURCE_FENCE_ATTESTATION_FAILED');
  assert.equal(result.body?.frozen, true, 'SOURCE_NOT_FROZEN');
  assert.equal(result.body?.database, 'postgres', 'SOURCE_DATABASE_MISMATCH');
  assert.ok(Number.isFinite(Date.parse(result.body?.changed_at)), 'SOURCE_FENCE_TIMESTAMP_MISSING');
  return result.body.changed_at;
}

async function run() {
  const identity = awsValue(['sts', 'get-caller-identity', '--query', 'Account']);
  assert.equal(identity, account, 'AWS_ACCOUNT_MISMATCH');
  const key = awsValue(['secretsmanager', 'get-secret-value', '--secret-id', secretId, '--query', 'SecretString']);
  assert.match(key ?? '', /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'SOURCE_KEY_INVALID');

  const beforeFence = await frozenState(key);
  const exactPath = `/rest/v1/fleet_vehicles?id=eq.${vehicleId}&department_id=eq.${departmentId}&select=id`;
  const before = await request(key, 'GET', exactPath);
  assert.equal(before.status, 200, 'SYNTHETIC_VEHICLE_READ_FAILED');
  assert.equal(before.body?.length, 1, 'SYNTHETIC_VEHICLE_NOT_UNIQUE');

  // Updating the immutable identifier to itself has no intended business-field effect.
  // A successful response is a fence failure and must never be treated as PASS.
  const attempt = await request(key, 'PATCH', exactPath, { id: vehicleId });
  const classification = classifyFenceResponse(attempt.status, attempt.body);
  const afterFence = await frozenState(key);
  const after = await request(key, 'GET', exactPath);
  assert.equal(after.status, 200, 'SYNTHETIC_VEHICLE_POSTCHECK_FAILED');
  assert.equal(after.body?.length, 1, 'SYNTHETIC_VEHICLE_POSTCHECK_MISMATCH');
  assert.equal(afterFence, beforeFence, 'SOURCE_FENCE_STATE_CHANGED');
  assert.equal(classification, 'FENCE_REJECTED', `SOURCE_REST_FENCE_FAILED:${attempt.status}`);
  console.log(JSON.stringify({ result: 'PAID_SOURCE_REST_SERVICE_ROLE_FENCE_PASS', status: attempt.status,
    postgresCode: '55000', sourceProject: 'reukdouvpshshvqnzsgw', fenceStable: true, rowPayloadsLogged: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(error => {
    // Never print SDK/fetch error objects: they can include request headers.
    const safe = /^(?:AWS_ACCOUNT_MISMATCH|SOURCE_KEY_INVALID|SOURCE_FENCE_ATTESTATION_FAILED|SOURCE_NOT_FROZEN|SOURCE_DATABASE_MISMATCH|SOURCE_FENCE_TIMESTAMP_MISSING|SYNTHETIC_VEHICLE_READ_FAILED|SYNTHETIC_VEHICLE_NOT_UNIQUE|SYNTHETIC_VEHICLE_POSTCHECK_FAILED|SYNTHETIC_VEHICLE_POSTCHECK_MISMATCH|SOURCE_FENCE_STATE_CHANGED|SOURCE_REST_FENCE_FAILED:\d{3})$/;
    console.error(safe.test(error?.message ?? '') ? error.message : 'PAID_SOURCE_REST_FENCE_PROBE_FAILED');
    process.exitCode = 1;
  });
}
