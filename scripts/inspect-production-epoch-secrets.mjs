#!/usr/bin/env node
// Read-only, exact-project attestation. Never prints or writes credential values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PRODUCTION_EPOCH, SOURCE_CREDENTIALS, classifySourceSecret,
  extractProductionEpochKey } from './source-credential-epoch-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
const region = 'us-east-1';
const projectRef = PRODUCTION_EPOCH.projectRef;
const names = [SOURCE_CREDENTIALS[0].name,
  PRODUCTION_EPOCH.captureSecretName, PRODUCTION_EPOCH.rollbackSecretName];

function extractKey(value, name) {
  if (name !== SOURCE_CREDENTIALS[0].name) return extractProductionEpochKey(value, name);
  assert.equal(classifySourceSecret(value, projectRef), 'modern_secret', 'MODERN_KEY_REQUIRED');
  return value.startsWith('sb_secret_') ? value :
    (JSON.parse(value).serviceRoleKey ?? JSON.parse(value).SUPABASE_SECRET_KEY);
}

function aws(args) {
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...args, '--profile', 'tracepoint-production', '--region', region, '--output', 'json'],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) {
    if (result.stderr?.includes('ResourceNotFoundException')) throw new Error('MISSING_EXACT_SECRET');
    throw new Error('AWS_READ_ONLY_CALL_FAILED');
  }
  return JSON.parse(result.stdout);
}

let stage = 'aws-identity';
const readStatuses = [];
try {
  const identity = aws(['sts', 'get-caller-identity']);
  assert.equal(identity.Account, '193644343389', 'PRODUCTION_ACCOUNT_REQUIRED');
  // Identify absent reserved destinations before attempting any network probe
  // against the existing source. This keeps a missing epoch distinct from a
  // temporary source-API failure, without reading or printing key values.
  for (const name of names.slice(1)) {
    stage = name === PRODUCTION_EPOCH.captureSecretName ? 'capture-metadata' : 'rollback-metadata';
    const metadata = aws(['secretsmanager', 'describe-secret', '--secret-id', name]);
    assert.equal(metadata.Name, name, 'SECRET_NAME_MISMATCH');
  }
  const entries = [];
  for (const name of names) {
    const purpose = name === names[0] ? 'old' :
      name === PRODUCTION_EPOCH.captureSecretName ? 'capture' : 'rollback';
    stage = `${purpose}-secret-read`;
    const response = aws(['secretsmanager', 'get-secret-value', '--secret-id', name]);
    assert.equal(response.Name, name, 'SECRET_NAME_MISMATCH');
    assert.match(response.ARN ?? '', new RegExp(`^arn:aws:secretsmanager:${region}:193644343389:secret:${name}-[A-Za-z0-9]{6}$`),
      'SECRET_ARN_MISMATCH');
    assert.equal(typeof response.SecretString, 'string', 'STRING_SECRET_REQUIRED');
    stage = `${purpose}-key-format`;
    const key = extractKey(response.SecretString, name);
    stage = `${purpose}-project-read`;
    const check = await fetch(`https://${projectRef}.supabase.co/rest/v1/departments?select=id&limit=1`, {
      headers: { apikey: key, accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const status = check.status;
    await check.arrayBuffer();
    let paidRehearsalStatus = null;
    if (status !== 200 && purpose !== 'old') {
      const paidCheck = await fetch('https://reukdouvpshshvqnzsgw.supabase.co/rest/v1/departments?select=id&limit=1', {
        headers: { apikey: key, accept: 'application/json' }, redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      paidRehearsalStatus = paidCheck.status;
      await paidCheck.arrayBuffer();
    }
    readStatuses.push({ purpose, productionStatus: status, paidRehearsalStatus });
    entries.push({ name, arn: response.ARN, versionId: response.VersionId,
      fingerprint: createHash('sha256').update(key).digest('hex'), status });
  }
  stage = 'distinctness';
  // After a pre-authority abort the old modern key is irreversibly retired;
  // the source REST secret is deliberately replaced with the reserved rollback key.
  const activeIsRollback = entries[0].fingerprint === entries[2].fingerprint;
  assert.notEqual(entries[1].fingerprint, entries[2].fingerprint, 'CAPTURE_AND_ROLLBACK_KEYS_NOT_DISTINCT');
  assert.ok(activeIsRollback || new Set(entries.map(entry => entry.fingerprint)).size === 3,
    'UNEXPECTED_ACTIVE_SOURCE_KEY');
  stage = 'project-reads';
  assert.ok(entries.every(entry => entry.status === 200), 'EXACT_PROJECT_KEY_READ_FAILED');
  stage = 'capture-storage-read';
  const captureKey = extractKey((aws(['secretsmanager', 'get-secret-value',
    '--secret-id', PRODUCTION_EPOCH.captureSecretName])).SecretString,
  PRODUCTION_EPOCH.captureSecretName);
  const storage = await fetch(`https://${projectRef}.supabase.co/storage/v1/object/list/department-assets`, {
    method: 'POST', headers: { apikey: captureKey, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 1, offset: 0 }), redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const storageStatus = storage.status;
  await storage.arrayBuffer();
  assert.equal(storageStatus, 200, 'CAPTURE_STORAGE_BUCKET_UNAVAILABLE');
  console.log(JSON.stringify({ status: 'PRODUCTION_EPOCH_SECRETS_ATTESTED', projectRef,
    oldCredential: { name: entries[0].name, arn: entries[0].arn, readStatus: entries[0].status },
    capture: { name: entries[1].name, arn: entries[1].arn,
      versionIdPresent: Boolean(entries[1].versionId), readStatus: entries[1].status },
    rollback: { name: entries[2].name, arn: entries[2].arn,
      versionIdPresent: Boolean(entries[2].versionId), readStatus: entries[2].status },
    threeCredentialsDistinct: !activeIsRollback, activeSourceUsesRollbackKey: activeIsRollback,
    captureAndRollbackDistinct: true, captureStorageStatus: storageStatus,
    keyValuesLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PRODUCTION_EPOCH_SECRETS_NOT_READY',
    stage, code: /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'ATTESTATION_FAILED',
    readStatuses }));
  process.exitCode = 2;
}
