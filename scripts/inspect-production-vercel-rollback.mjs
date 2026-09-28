#!/usr/bin/env node
// Exact-project, read-only Vercel rollback inventory. Never prints tokens or env values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_TEAM_ID, VERCEL_PROJECT_ID, BASELINE_DEPLOYMENT_ID,
  VERCEL_TOKEN_SECRET, attestVercelProject, attestVercelVariables,
  attestVercelDeployment } from './production-vercel-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
function aws(args, output = 'json') {
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...args, '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', output],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'PINNED_AWS_READ_FAILED');
  return result.stdout.trim();
}

async function getJson(token, path) {
  assert.match(path, /^\/(?:v9\/projects|v13\/deployments)\//, 'UNAPPROVED_VERCEL_PATH');
  const url = new URL(`https://api.vercel.com${path}`);
  url.searchParams.set('teamId', VERCEL_TEAM_ID);
  const response = await fetch(url, { method: 'GET', redirect: 'error',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, 'VERCEL_READ_FAILED');
  return response.json();
}

try {
  const identity = JSON.parse(aws(['sts', 'get-caller-identity']));
  assert.equal(identity.Account, '193644343389', 'PRODUCTION_ACCOUNT_REQUIRED');
  const token = aws(['secretsmanager', 'get-secret-value', '--secret-id', VERCEL_TOKEN_SECRET,
    '--query', 'SecretString'], 'text');
  assert.ok(token.length >= 32 && !/\s/.test(token), 'VERCEL_TOKEN_SHAPE_INVALID');
  const project = await getJson(token, `/v9/projects/${VERCEL_PROJECT_ID}`);
  attestVercelProject(project);
  const variableResult = await getJson(token, `/v9/projects/${VERCEL_PROJECT_ID}/env`);
  const ids = attestVercelVariables(variableResult.envs ?? variableResult);
  const deployment = await getJson(token, `/v13/deployments/${BASELINE_DEPLOYMENT_ID}`);
  attestVercelDeployment(deployment);
  console.log(JSON.stringify({ status: 'PRODUCTION_VERCEL_ROLLBACK_INVENTORY_ATTESTED',
    teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID,
    baselineDeploymentId: BASELINE_DEPLOYMENT_ID,
    productionSecretEnvId: ids.productionId, previewSecretEnvId: ids.previewId,
    tokenValueLogged: false, environmentValuesLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PRODUCTION_VERCEL_ROLLBACK_INVENTORY_BLOCKED',
    code: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'ATTESTATION_FAILED' }));
  process.exitCode = 2;
}
