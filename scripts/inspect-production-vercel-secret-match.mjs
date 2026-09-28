#!/usr/bin/env node
// Read-only check of the live Vercel Production secret's shape and readability.
// Sensitive Vercel variables are intentionally non-readable after creation.
import assert from 'node:assert/strict';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { PRODUCTION_MIGRATION_REST_SECRET } from './production-credential-rollback-core.mjs';
import { VERCEL_PROJECT_ID, VERCEL_TOKEN_SECRET, PRODUCTION_SECRET_ENV_ID,
  attestVercelProject, attestVercelVariables, withExactVercelTeam } from './production-vercel-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
process.env.AWS_PROFILE = 'tracepoint-production';
process.env.AWS_SDK_LOAD_CONFIG = '1';
const manager = new SecretsManagerClient({ region: 'us-east-1', maxAttempts: 1 });
async function secret(name) {
  const result = await manager.send(new GetSecretValueCommand({ SecretId: name }));
  assert.equal(result.Name, name, 'SECRET_NAME_MISMATCH');
  assert.match(result.ARN ?? '', /^arn:aws:secretsmanager:us-east-1:193644343389:secret:/,
    'SECRET_ACCOUNT_MISMATCH');
  assert.equal(typeof result.SecretString, 'string');
  return result.SecretString;
}
async function vercel(token, path) {
  const response = await fetch(`https://api.vercel.com${withExactVercelTeam(path)}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200, `VERCEL_READ_HTTP_${response.status}`);
  return response.json();
}
let stage = 'secret';
try {
  const rawToken = await secret(VERCEL_TOKEN_SECRET);
  const wrapper = rawToken.startsWith('{') ? JSON.parse(rawToken) : null;
  if (wrapper) assert.deepEqual(Object.keys(wrapper), [VERCEL_TOKEN_SECRET]);
  const token = wrapper ? wrapper[VERCEL_TOKEN_SECRET] : rawToken;
  assert.ok(typeof token === 'string' && token.length >= 32 && !/\s/.test(token));
  const source = JSON.parse(await secret(PRODUCTION_MIGRATION_REST_SECRET));
  assert.equal(source.projectUrl, 'https://izlkwggluhlhzlumtzes.supabase.co');
  assert.match(source.serviceRoleKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/);
  stage = 'vercel-project';
  const project = await vercel(token, `/v9/projects/${VERCEL_PROJECT_ID}`);
  attestVercelProject(project);
  const listing = await vercel(token, `/v9/projects/${VERCEL_PROJECT_ID}/env`);
  attestVercelVariables(listing.envs ?? listing);
  stage = 'vercel-variable';
  const variable = await vercel(token,
    `/v1/projects/${VERCEL_PROJECT_ID}/env/${PRODUCTION_SECRET_ENV_ID}`);
  stage = 'vercel-variable-shape';
  const safeShape = { idMatches: variable.id === PRODUCTION_SECRET_ENV_ID,
    keyMatches: variable.key === 'SUPABASE_SECRET_KEY',
    targetIsProduction: JSON.stringify(variable.target) === '["production"]',
    typeIsSensitive: variable.type === 'sensitive' };
  if (!Object.values(safeShape).every(Boolean)) {
    console.error(JSON.stringify({ safeShape }));
    throw new Error('VERCEL_ENV_SHAPE_MISMATCH');
  }
  assert.equal(typeof variable.value, 'undefined', 'SENSITIVE_VALUE_UNEXPECTEDLY_VISIBLE');
  assert.equal(variable.decrypted, false, 'SENSITIVE_VARIABLE_DECRYPTED');
  console.log(JSON.stringify({ status: 'PRODUCTION_VERCEL_SENSITIVE_SECRET_NONREADABLE',
    projectId: VERCEL_PROJECT_ID, variableId: PRODUCTION_SECRET_ENV_ID,
    oldAwsSecretModern: source.serviceRoleKey.startsWith('sb_secret_'),
    exactValueMatchUnknowable: true, replacementRequiredForRollback: true,
    valueLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PRODUCTION_VERCEL_SECRET_MATCH_BLOCKED', stage,
    code: /^[A-Z0-9_:]+$/.test(error?.message ?? '') ? error.message : 'ATTESTATION_FAILED' }));
  process.exitCode = 2;
} finally { manager.destroy(); }
