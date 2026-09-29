#!/usr/bin/env node
// Run only after the exact production old key has been retired under maintenance.
// Requests use zero-row reads or an attested absent-row PATCH; no row values print.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { PRODUCTION_EPOCH, extractProductionEpochKey, rejectedCredential,
  rejectedStorageCredentialAgainstInvalidControl } from './source-credential-epoch-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production', '--after-retirement'],
  'EXACT_PRODUCTION_ARGUMENTS_REQUIRED');
assert.equal(process.env.TRACEPOINT_CUTOVER_WINDOW_APPROVED, 'YES', 'CUTOVER_WINDOW_FLAG_REQUIRED');
process.env.AWS_PROFILE = 'tracepoint-production';
process.env.AWS_SDK_LOAD_CONFIG = '1';
const origin = `https://${PRODUCTION_EPOCH.projectRef}.supabase.co`;
const oldSecret = 'tracepoint/production/migration/source-supabase-rest';
const client = new SecretsManagerClient({ region: 'us-east-1', maxAttempts: 1 });
const absentId = '00000000-0000-4000-8000-000000000001';
const absentPath = `/rest/v1/fleet_vehicles?id=eq.${absentId}`;

async function keyFor(name) {
  const result = await client.send(new GetSecretValueCommand({ SecretId: name }));
  assert.equal(result.Name, name, 'SECRET_NAME_MISMATCH');
  assert.match(result.ARN ?? '', /^arn:aws:secretsmanager:us-east-1:193644343389:secret:/,
    'SECRET_ACCOUNT_MISMATCH');
  if (name !== oldSecret) return extractProductionEpochKey(result.SecretString,
    PRODUCTION_EPOCH.captureSecretName);
  const payload = JSON.parse(result.SecretString);
  assert.equal(payload.projectUrl, origin, 'OLD_SOURCE_PROJECT_MISMATCH');
  assert.match(payload.serviceRoleKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/,
    'OLD_MODERN_KEY_REQUIRED');
  return payload.serviceRoleKey;
}
async function request(key, method, path, body, label) {
  const response = await fetch(`${origin}${path}`, { method, redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(label ? { 'x-tracepoint-proof-holder': label } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = (await response.text()).slice(0, 4096);
  return { status: response.status, text };
}
let stage = 'identity';
try {
  const sts = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    ['sts', 'get-caller-identity', '--profile', 'tracepoint-production',
      '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8' });
  assert.equal(sts.status, 0, 'AWS_IDENTITY_UNAVAILABLE');
  assert.equal(JSON.parse(sts.stdout).Account, '193644343389', 'AWS_ACCOUNT_MISMATCH');
  stage = 'key-attestation';
  const [oldKey, captureKey] = await Promise.all([keyFor(oldSecret),
    keyFor(PRODUCTION_EPOCH.captureSecretName)]);
  assert.notEqual(oldKey, captureKey, 'OLD_CAPTURE_KEY_EQUAL');
  const readPath = '/rest/v1/feature_catalog?select=code&limit=0';
  stage = 'capture-control';
  const capture = await request(captureKey, 'GET', readPath);
  assert.equal(capture.status, 200, 'CAPTURE_KEY_READ_FAILED');
  stage = 'absent-row-control';
  const absent = await request(captureKey, 'GET', `${absentPath}&select=id`);
  assert.equal(absent.status, 200, 'ABSENT_ROW_READ_FAILED');
  assert.deepEqual(JSON.parse(absent.text), [], 'PROBE_ROW_NOT_ABSENT');
  stage = 'old-rest';
  const oldRead = await request(oldKey, 'GET', readPath);
  const oldWrite = await request(oldKey, 'PATCH', absentPath, { id: absentId });
  const unknownHolder = await request(oldKey, 'PATCH', absentPath,
    { id: absentId }, 'unknown-old-holder');
  assert.ok(rejectedCredential(oldRead.status), 'OLD_KEY_READ_STILL_AUTHORIZED');
  assert.ok(rejectedCredential(oldWrite.status), 'OLD_KEY_WRITE_STILL_AUTHORIZED');
  assert.ok(rejectedCredential(unknownHolder.status), 'UNKNOWN_OLD_HOLDER_STILL_AUTHORIZED');
  stage = 'old-auth';
  const auth = await request(oldKey, 'GET', '/auth/v1/admin/users?page=1&per_page=1');
  assert.ok(rejectedCredential(auth.status), 'OLD_KEY_AUTH_STILL_AUTHORIZED');
  stage = 'old-storage';
  const list = '/storage/v1/object/list/department-assets';
  const body = { prefix: '', limit: 1, offset: 0 };
  const oldStorage = await request(oldKey, 'POST', list, body);
  const captureStorage = await request(captureKey, 'POST', list, body);
  const invalidStorage = await request('invalid-cutover-probe-20260928', 'POST', list, body);
  let safeError = null;
  try {
    const parsed = JSON.parse(oldStorage.text);
    safeError = { code: parsed?.code, error: parsed?.error };
  } catch { /* HTTP status may suffice. */ }
  let invalidError = null;
  try {
    const parsed = JSON.parse(invalidStorage.text);
    invalidError = { code: parsed?.code, error: parsed?.error };
  } catch { /* Status and exact error shape are both required below. */ }
  const sameAsInvalidControl = oldStorage.status === 400 && invalidStorage.status === 400 &&
    safeError?.code === invalidError?.code && safeError?.error === invalidError?.error;
  assert.ok(rejectedStorageCredentialAgainstInvalidControl(oldStorage.status, safeError,
    captureStorage.status, invalidStorage.status, invalidError),
    'OLD_KEY_STORAGE_STILL_AUTHORIZED');
  assert.equal(captureStorage.status, 200, 'CAPTURE_STORAGE_CONTROL_FAILED');
  stage = 'postcheck';
  const after = await request(captureKey, 'GET', `${absentPath}&select=id`);
  assert.equal(after.status, 200, 'ABSENT_ROW_POSTCHECK_FAILED');
  assert.deepEqual(JSON.parse(after.text), [], 'PROBE_ROW_CHANGED');
  console.log(JSON.stringify({ status: 'PRODUCTION_OLD_EPOCH_REJECTED',
    projectRef: PRODUCTION_EPOCH.projectRef, oldRestRead: oldRead.status,
    oldRestWrite: oldWrite.status, unknownHolderWrite: unknownHolder.status,
    oldAuth: auth.status, oldStorage: oldStorage.status,
    invalidStorageControl: invalidStorage.status, storageMatchesInvalidControl: sameAsInvalidControl,
    captureRest: capture.status, captureStorage: captureStorage.status,
    authoritativeProbeRowUnchanged: true, credentialValuesLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PRODUCTION_OLD_EPOCH_REJECTION_UNPROVEN', stage,
    code: /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'PROBE_FAILED',
    keepMaintenanceAndFence: true }));
  process.exitCode = 2;
} finally { client.destroy(); }
