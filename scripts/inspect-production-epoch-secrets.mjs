#!/usr/bin/env node
// Read-only, exact-project attestation. Never prints or writes credential values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { PRODUCTION_EPOCH, SOURCE_CREDENTIALS, classifySourceSecret,
  fingerprintSourceSecret } from './source-credential-epoch-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
const region = 'us-east-1';
const projectRef = PRODUCTION_EPOCH.projectRef;
const names = [SOURCE_CREDENTIALS[0].name,
  PRODUCTION_EPOCH.captureSecretName, PRODUCTION_EPOCH.rollbackSecretName];

function extractKey(value) {
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

try {
  const identity = aws(['sts', 'get-caller-identity']);
  assert.equal(identity.Account, '193644343389', 'PRODUCTION_ACCOUNT_REQUIRED');
  // Identify absent reserved destinations before attempting any network probe
  // against the existing source. This keeps a missing epoch distinct from a
  // temporary source-API failure, without reading or printing key values.
  for (const name of names.slice(1)) {
    const metadata = aws(['secretsmanager', 'describe-secret', '--secret-id', name]);
    assert.equal(metadata.Name, name, 'SECRET_NAME_MISMATCH');
  }
  const entries = [];
  for (const name of names) {
    const response = aws(['secretsmanager', 'get-secret-value', '--secret-id', name]);
    assert.equal(response.Name, name, 'SECRET_NAME_MISMATCH');
    assert.match(response.ARN ?? '', new RegExp(`^arn:aws:secretsmanager:${region}:193644343389:secret:${name}-[A-Za-z0-9]{6}$`),
      'SECRET_ARN_MISMATCH');
    assert.equal(typeof response.SecretString, 'string', 'STRING_SECRET_REQUIRED');
    const key = extractKey(response.SecretString);
    const check = await fetch(`https://${projectRef}.supabase.co/rest/v1/departments?select=id&limit=1`, {
      headers: { apikey: key, accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const status = check.status;
    await check.arrayBuffer();
    assert.equal(status, 200, 'EXACT_PROJECT_KEY_READ_FAILED');
    entries.push({ name, arn: response.ARN, versionId: response.VersionId,
      fingerprint: fingerprintSourceSecret(response.SecretString, projectRef), status });
  }
  assert.equal(new Set(entries.map(entry => entry.fingerprint)).size, 3, 'EPOCH_KEYS_NOT_DISTINCT');
  console.log(JSON.stringify({ status: 'PRODUCTION_EPOCH_SECRETS_ATTESTED', projectRef,
    oldCredential: { name: entries[0].name, arn: entries[0].arn, readStatus: entries[0].status },
    capture: { name: entries[1].name, arn: entries[1].arn,
      versionIdPresent: Boolean(entries[1].versionId), readStatus: entries[1].status },
    rollback: { name: entries[2].name, arn: entries[2].arn,
      versionIdPresent: Boolean(entries[2].versionId), readStatus: entries[2].status },
    threeCredentialsDistinct: true, keyValuesLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PRODUCTION_EPOCH_SECRETS_NOT_READY',
    code: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'ATTESTATION_FAILED' }));
  process.exitCode = 2;
}
