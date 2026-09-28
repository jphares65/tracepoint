#!/usr/bin/env node
// Exact paid-project probe. Never prints key values, response bodies, or customer rows.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { assertDistinctEpochKeys, rejectedCredential, rejectedStorageCredential } from './source-credential-epoch-core.mjs';

const ACCOUNT = '193644343389';
const PROJECT = 'reukdouvpshshvqnzsgw';
const ORIGIN = `https://${PROJECT}.supabase.co`;
const OLD = 'tracepoint/production/migration/source-rehearsal-only-20260925';
const CAPTURE = 'tracepoint/production/migration/source-rehearsal-epoch-capture-20260927';
const ROLLBACK = 'tracepoint/production/migration/source-rehearsal-epoch-rollback-20260927';
const VEHICLE = '4fe22291-4da8-4e98-acbe-e12be4a943ad';
const DEPARTMENT = 'acb5b501-2309-4a9e-a504-f36c08728fa9';
const ROW_PATH = `/rest/v1/fleet_vehicles?id=eq.${VEHICLE}&department_id=eq.${DEPARTMENT}&select=*`;
// A credential-negative write probe must not touch the known synthetic row even if
// retirement unexpectedly failed. A live key returns a non-authentication status.
const ABSENT_ROW_PATH = `/rest/v1/fleet_vehicles?id=eq.00000000-0000-0000-0000-000000000000&department_id=eq.${DEPARTMENT}`;
const UUID = /^[0-9a-f-]{36}$/i;

const phase = process.argv[2];
assert.ok(phase === '--phase=prepared' || phase === '--phase=retired', 'PHASE_REQUIRED');
assert.equal(process.argv.length, 3, 'UNEXPECTED_ARGUMENT');
process.env.AWS_PROFILE = 'tracepoint-production';
process.env.AWS_SDK_LOAD_CONFIG = '1';
const secrets = new SecretsManagerClient({ region: 'us-east-1', maxAttempts: 1 });
let stage = 'identity';
const statuses = {};

async function readKey(name) {
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: name }));
  const raw = result.SecretString ?? '';
  let key = raw;
  if (raw.startsWith('{')) {
    const envelope = JSON.parse(raw);
    assert.ok(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'SINGLE_KEY_ENVELOPE_REQUIRED');
    const fields = Object.values(envelope);
    assert.equal(fields.length, 1, 'SINGLE_KEY_ENVELOPE_REQUIRED');
    key = fields[0];
  }
  assert.match(key, /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'MODERN_SECRET_REQUIRED');
  return key;
}

async function request(key, method, path, body, userAgent = 'tracepoint-epoch-proof') {
  const url = new URL(path, ORIGIN);
  assert.equal(url.origin, ORIGIN, 'PROJECT_TARGET_MISMATCH');
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { apikey: key, authorization: `Bearer ${key}`, 'user-agent': userAgent,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const status = response.status;
  const text = await response.text();
  return { status, text };
}

function canonicalHash(text) {
  const value = JSON.parse(text);
  assert.ok(Array.isArray(value) && value.length === 1 && UUID.test(value[0]?.id), 'SYNTHETIC_ROW_NOT_UNIQUE');
  assert.equal(value[0].department_id, DEPARTMENT, 'SYNTHETIC_TENANT_MISMATCH');
  return createHash('sha256').update(JSON.stringify(value[0])).digest('hex');
}

try {
  const account = execFileSync('aws', ['sts', 'get-caller-identity', '--profile', 'tracepoint-production',
    '--region', 'us-east-1', '--query', 'Account', '--output', 'text'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  assert.equal(account, ACCOUNT, 'AWS_ACCOUNT_MISMATCH');
  stage = 'secrets';
  const [oldKey, captureKey, rollbackKey] = await Promise.all([readKey(OLD), readKey(CAPTURE), readKey(ROLLBACK)]);
  assertDistinctEpochKeys([oldKey, captureKey, rollbackKey]);
  stage = 'capture-read';
  const before = await request(captureKey, 'GET', ROW_PATH);
  assert.equal(before.status, 200, 'CAPTURE_KEY_READ_FAILED');
  const rowHash = canonicalHash(before.text);
  stage = 'rollback-read';
  const rollbackRead = await request(rollbackKey, 'GET', ROW_PATH);
  assert.equal(rollbackRead.status, 200, 'ROLLBACK_KEY_PAID_PROJECT_READ_FAILED');
  assert.equal(canonicalHash(rollbackRead.text), rowHash, 'ROLLBACK_KEY_PROJECT_MISMATCH');

  if (phase === '--phase=prepared') {
    stage = 'old-prepared-read';
    const old = await request(oldKey, 'GET', ROW_PATH);
    assert.equal(old.status, 200, 'OLD_KEY_PREPARED_READ_FAILED');
    assert.equal(canonicalHash(old.text), rowHash, 'OLD_CAPTURE_READ_MISMATCH');
    console.log(JSON.stringify({ status: 'PAID_CREDENTIAL_EPOCH_PREPARED', projectRef: PROJECT,
      oldKeyActive: true, captureKeyActive: true, rollbackKeyActive: true,
      rollbackKeyDistinct: true, rowUnchanged: true,
      keyValuesLogged: false }));
  } else {
    stage = 'old-retired-read';
    const old = await request(oldKey, 'GET', ROW_PATH);
    statuses.oldRead = old.status;
    stage = 'unknown-holder-read';
    const unknownHolder = await request(oldKey, 'GET', ROW_PATH, undefined, 'tracepoint-unknown-old-holder-proof');
    statuses.unknownRead = unknownHolder.status;
    assert.equal(rejectedCredential(old.status), true, 'OLD_KEY_STILL_AUTHORIZES_READ');
    assert.equal(rejectedCredential(unknownHolder.status), true, 'UNKNOWN_HOLDER_STILL_AUTHORIZES_READ');
    stage = 'old-retired-write';
    const patch = await request(oldKey, 'PATCH', ABSENT_ROW_PATH, { id: VEHICLE });
    statuses.oldWrite = patch.status;
    stage = 'unknown-holder-write';
    const unknownPatch = await request(oldKey, 'PATCH', ABSENT_ROW_PATH, { id: VEHICLE },
      'tracepoint-unknown-old-holder-proof');
    statuses.unknownWrite = unknownPatch.status;
    stage = 'old-retired-auth';
    const oldAuth = await request(oldKey, 'GET', '/auth/v1/admin/users?page=1&per_page=1');
    statuses.oldAuth = oldAuth.status;
    stage = 'old-retired-storage';
    const oldStorage = await request(oldKey, 'POST', '/storage/v1/object/list/tracepoint-attachments',
      { prefix: '', limit: 1, offset: 0 });
    statuses.oldStorage = oldStorage.status;
    const captureStorage = await request(captureKey, 'POST', '/storage/v1/object/list/tracepoint-attachments',
      { prefix: '', limit: 1, offset: 0 });
    statuses.captureStorage = captureStorage.status;
    let storageBody;
    try { storageBody = JSON.parse(oldStorage.text); } catch { storageBody = null; }
    const safeErrorLabel = value => typeof value === 'string' && /^[A-Za-z _-]{1,40}$/.test(value) ? value : null;
    statuses.storageError = storageBody && typeof storageBody === 'object' && !Array.isArray(storageBody)
      ? { code: safeErrorLabel(storageBody.code), error: safeErrorLabel(storageBody.error),
          statusCode: safeErrorLabel(storageBody.statusCode), keys: Object.keys(storageBody).filter(key => /^[A-Za-z_]{1,30}$/.test(key)) }
      : { shape: 'non-object' };
    const storageInvalidKey = rejectedStorageCredential(oldStorage.status, statuses.storageError, captureStorage.status);
    assert.equal(rejectedCredential(patch.status), true, 'OLD_KEY_STILL_AUTHORIZES_WRITE');
    assert.equal(rejectedCredential(unknownPatch.status), true, 'UNKNOWN_HOLDER_STILL_AUTHORIZES_WRITE');
    assert.equal(rejectedCredential(oldAuth.status), true, 'OLD_KEY_STILL_AUTHORIZES_AUTH');
    assert.equal(storageInvalidKey, true,
      'OLD_KEY_STORAGE_REJECTION_NOT_PROVEN');
    stage = 'capture-readback';
    const after = await request(captureKey, 'GET', ROW_PATH);
    assert.equal(after.status, 200, 'CAPTURE_READ_AFTER_RETIREMENT_FAILED');
    assert.equal(canonicalHash(after.text), rowHash, 'AUTHORITATIVE_ROW_CHANGED');
    console.log(JSON.stringify({ status: 'PAID_OLD_CREDENTIAL_RETIRED', projectRef: PROJECT,
      oldReadStatus: old.status, unknownHolderReadStatus: unknownHolder.status,
      oldWriteStatus: patch.status, unknownHolderWriteStatus: unknownPatch.status,
      oldAuthStatus: oldAuth.status, oldStorageStatus: oldStorage.status,
      captureStorageStatus: captureStorage.status, storageInvalidKey,
      captureReadStatus: after.status,
      authoritativeRowUnchanged: true, keyValuesLogged: false }));
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'PAID_CREDENTIAL_EPOCH_PROBE_FAILED',
    stage, code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'UNCLASSIFIED_FAILURE',
    errorType: error instanceof Error && /^[A-Za-z]+$/.test(error.name) ? error.name : 'unknown',
    httpStatuses: statuses }));
  process.exitCode = 1;
} finally {
  secrets.destroy();
}
