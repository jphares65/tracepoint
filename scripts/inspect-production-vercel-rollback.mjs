#!/usr/bin/env node
// Exact-project, read-only Vercel rollback inventory. Never prints tokens or env values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_TEAM_ID, VERCEL_PROJECT_ID, BASELINE_DEPLOYMENT_UID,
  VERCEL_TOKEN_SECRET, attestVercelProject, attestVercelVariables,
  attestVercelDeployment, withExactVercelTeam } from './production-vercel-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
function aws(args, output = 'json') {
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...args, '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', output],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'PINNED_AWS_READ_FAILED');
  return result.stdout.trim();
}

async function getJson(token, path) {
  const exactDeploymentList = `/v6/deployments?projectId=${VERCEL_PROJECT_ID}&target=production&limit=100`;
  assert.ok(/^\/(?:v9\/projects|v13\/deployments)\//.test(path) ||
    /^\/v1\/projects\/prj_V03LJyQIc231luvZ9u0gcOAt4xK4\/env\/[A-Za-z0-9]+$/.test(path) ||
    path === exactDeploymentList,
    'UNAPPROVED_VERCEL_PATH');
  const url = new URL(`https://api.vercel.com${withExactVercelTeam(path)}`);
  // A project-scoped token cannot read team/user metadata. The exact project
  // and owner are verified from the returned project before any other read.
  let response;
  try {
    response = await fetch(url, { method: 'GET', redirect: 'error',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error('VERCEL_NETWORK_FAILED');
  }
  if (response.status !== 200) {
    let code = null;
    try {
      const body = await response.json();
      if (/^[a-zA-Z0-9_-]{1,64}$/.test(body?.error?.code ?? '')) code = body.error.code;
    } catch { /* Status is sufficient. */ }
    throw new Error(`VERCEL_READ_HTTP_${response.status}${code ? `_${code.toUpperCase()}` : ''}`);
  }
  return response.json();
}

async function diagnosticStatus(token, path) {
  assert.ok(path === '/v2/user' || path === `/v2/teams/${VERCEL_TEAM_ID}`,
    'UNAPPROVED_VERCEL_DIAGNOSTIC_PATH');
  const url = new URL(`https://api.vercel.com${path}`);
  const response = await fetch(url, { method: 'GET', redirect: 'error',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000) });
  let code = null;
  try {
    const body = await response.json();
    if (/^[a-zA-Z0-9_-]{1,64}$/.test(body?.error?.code ?? '')) code = body.error.code;
  } catch { /* status alone is sufficient */ }
  return { status: response.status, code };
}

let stage = 'aws-identity';
let safeDiagnostic = null;
try {
  const identity = JSON.parse(aws(['sts', 'get-caller-identity']));
  assert.equal(identity.Account, '193644343389', 'PRODUCTION_ACCOUNT_REQUIRED');
  stage = 'token-secret';
  const secretPayload = aws(['secretsmanager', 'get-secret-value', '--secret-id', VERCEL_TOKEN_SECRET,
    '--query', 'SecretString'], 'text');
  const wrapped = secretPayload.startsWith('{') ? JSON.parse(secretPayload) : null;
  if (wrapped) assert.deepEqual(Object.keys(wrapped), [VERCEL_TOKEN_SECRET],
    'VERCEL_SECRET_WRAPPER_MISMATCH');
  const token = wrapped ? wrapped[VERCEL_TOKEN_SECRET] : secretPayload;
  assert.equal(typeof token, 'string', 'VERCEL_TOKEN_STRING_REQUIRED');
  assert.ok(token.length >= 32 && !/\s/.test(token), 'VERCEL_TOKEN_SHAPE_INVALID');
  stage = 'token-scope';
  safeDiagnostic = { user: await diagnosticStatus(token, '/v2/user'),
    team: await diagnosticStatus(token, `/v2/teams/${VERCEL_TEAM_ID}`) };
  stage = 'project';
  const project = await getJson(token, `/v9/projects/${VERCEL_PROJECT_ID}`);
  attestVercelProject(project);
  const gitBinding = { type: project.link?.type ?? null,
    org: project.link?.org ?? null, repo: project.link?.repo ?? null,
    repoIdPresent: project.link?.repoId != null,
    productionBranch: project.link?.productionBranch ?? null };
  stage = 'variables';
  const variableResult = await getJson(token, `/v9/projects/${VERCEL_PROJECT_ID}/env`);
  const ids = attestVercelVariables(variableResult.envs ?? variableResult);
  const elevatedMetadata = (variableResult.envs ?? variableResult)
    .filter(entry => entry.key === 'SUPABASE_SECRET_KEY')
    .map(entry => ({ id: entry.id, target: entry.target, type: entry.type,
      gitBranchSet: entry.gitBranch != null,
      createdAt: entry.createdAt ?? null, updatedAt: entry.updatedAt ?? null }));
  const publishableMetadata = (variableResult.envs ?? variableResult)
    .filter(entry => entry.key === 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    .map(entry => ({ target: entry.target, type: entry.type,
      gitBranchSet: entry.gitBranch != null }));
  const productionPublishable = (variableResult.envs ?? variableResult)
    .filter(entry => entry.key === 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' &&
      entry.target?.includes('production'));
  assert.equal(productionPublishable.length, 1, 'VERCEL_PRODUCTION_PUBLISHABLE_AMBIGUOUS');
  const publishableDetail = await getJson(token,
    `/v1/projects/${VERCEL_PROJECT_ID}/env/${productionPublishable[0].id}`);
  assert.equal(publishableDetail?.key, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const publishableValue = publishableDetail.value;
  const productionClientKeyShape = typeof publishableValue !== 'string' ? 'NONREADABLE' :
    publishableValue.startsWith('sb_publishable_') ? 'MODERN_PUBLISHABLE' :
      /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(publishableValue) ?
        'LEGACY_JWT' : 'UNKNOWN';
  stage = 'deployment-list';
  const deploymentList = await getJson(token,
    `/v6/deployments?projectId=${VERCEL_PROJECT_ID}&target=production&limit=100`);
  const listed = deploymentList.deployments ?? [];
  assert.ok(Array.isArray(listed), 'VERCEL_DEPLOYMENT_LIST_INVALID');
  safeDiagnostic.deploymentList = { count: listed.length,
    firstFive: listed.slice(0, 5).map(entry => ({ id: entry.uid ?? entry.id,
      target: entry.target ?? null, readyState: entry.readyState ?? null,
      projectIdMatches: entry.projectId === VERCEL_PROJECT_ID })) };
  const candidate = listed.find(entry => (entry.uid ?? entry.id) === BASELINE_DEPLOYMENT_UID);
  assert.ok(candidate, 'VERCEL_BASELINE_DEPLOYMENT_NOT_LISTED');
  stage = 'deployment';
  const deployment = await getJson(token, `/v13/deployments/${BASELINE_DEPLOYMENT_UID}`);
  attestVercelDeployment(deployment);
  console.log(JSON.stringify({ status: 'PRODUCTION_VERCEL_ROLLBACK_INVENTORY_ATTESTED',
    teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID,
    baselineDeploymentUid: BASELINE_DEPLOYMENT_UID,
    gitBinding,
    baselineGitSha: deployment.meta?.githubCommitSha ?? null,
    productionSecretEnvId: ids.productionId, previewSecretEnvId: ids.previewId,
    elevatedMetadata, publishableMetadata, productionClientKeyShape,
    tokenValueLogged: false, environmentValuesLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PRODUCTION_VERCEL_ROLLBACK_INVENTORY_BLOCKED',
    stage, code: /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'ATTESTATION_FAILED',
    ...(safeDiagnostic ? { diagnostic: safeDiagnostic } : {}) }));
  process.exitCode = 2;
}
