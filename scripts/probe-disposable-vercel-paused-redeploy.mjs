#!/usr/bin/env node
// Prove a fresh synthetic Production deployment can be built while the approved
// disposable Vercel project is paused, then always unpause that exact project.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_TEAM_ID, VERCEL_TOKEN_SECRET, withExactVercelTeam }
  from './production-vercel-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'],
  'EXACT_PROFILE_REQUIRED');
const project = 'prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw';
const origin = 'https://project-q7s6a.vercel.app/';
const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
  ['secretsmanager', 'get-secret-value', '--secret-id', VERCEL_TOKEN_SECRET,
    '--query', 'SecretString', '--profile', 'tracepoint-production',
    '--region', 'us-east-1', '--output', 'text'], { encoding: 'utf8' });
assert.equal(result.status, 0, 'VERCEL_TOKEN_UNAVAILABLE');
const stored = result.stdout.trim();
const wrapped = stored.startsWith('{') ? JSON.parse(stored) : null;
if (wrapped) assert.deepEqual(Object.keys(wrapped), [VERCEL_TOKEN_SECRET]);
const token = wrapped ? wrapped[VERCEL_TOKEN_SECRET] : stored;
assert.ok(typeof token === 'string' && token.length >= 32 && !/\s/.test(token));

async function api(method, path, body) {
  const response = await fetch(`https://api.vercel.com${withExactVercelTeam(path)}`,
    { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await response.json(); } catch { /* status is enough */ }
  return { status: response.status, json };
}
async function page() {
  const response = await fetch(origin, { redirect: 'manual',
    signal: AbortSignal.timeout(15_000), headers: { 'cache-control': 'no-cache' } });
  return { status: response.status, marker: (await response.text()).slice(0, 4096) };
}
async function waitPage(expected) {
  let last;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    last = await page();
    if (last.status === expected) return last;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`DISPOSABLE_EXTERNAL_${expected}_NOT_REACHED`);
}
let paused = false;
let stage = 'baseline';
try {
  const inspected = await api('GET', `/v9/projects/${project}`);
  assert.equal(inspected.status, 200, 'DISPOSABLE_PROJECT_UNAVAILABLE');
  assert.equal(inspected.json?.id, project, 'DISPOSABLE_PROJECT_MISMATCH');
  assert.equal(inspected.json?.accountId, VERCEL_TEAM_ID, 'DISPOSABLE_TEAM_MISMATCH');
  assert.equal(inspected.json?.name, 'project-q7s6a', 'DISPOSABLE_NAME_MISMATCH');
  assert.equal((await waitPage(200)).status, 200, 'DISPOSABLE_BASELINE_NOT_ACTIVE');
  stage = 'pause';
  const stopped = await api('POST', `/v1/projects/${project}/pause`);
  assert.ok([200, 201, 202, 204].includes(stopped.status),
    `DISPOSABLE_PAUSE_HTTP_${stopped.status}`);
  paused = true;
  const offline = await waitPage(503);
  assert.match(offline.marker, /DEPLOYMENT_PAUSED/, 'DISPOSABLE_PAUSE_MARKER_MISSING');
  stage = 'redeploy-while-paused';
  const created = await api('POST', '/v13/deployments?forceNew=1', {
    name: 'project-q7s6a', project, target: 'production',
    files: [{ file: 'index.html', data: '<!doctype html><title>TracePoint disposable paused redeploy proof</title><h1>Disposable proof only</h1>' }],
  });
  assert.equal(created.status, 200, `DISPOSABLE_DEPLOY_HTTP_${created.status}`);
  const uid = created.json?.uid ?? created.json?.id;
  assert.match(uid ?? '', /^dpl_[A-Za-z0-9]+$/, 'DISPOSABLE_DEPLOY_ID_MISSING');
  assert.equal(created.json?.projectId, project, 'DISPOSABLE_DEPLOY_PROJECT_MISMATCH');
  let ready = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await api('GET', `/v13/deployments/${uid}`);
    assert.equal(state.status, 200, 'DISPOSABLE_DEPLOY_READ_FAILED');
    assert.equal(state.json?.projectId, project, 'DISPOSABLE_DEPLOY_PROJECT_MISMATCH');
    ready = state.json?.readyState;
    if (['READY', 'ERROR', 'CANCELED'].includes(ready)) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(ready, 'READY', `DISPOSABLE_DEPLOY_${ready ?? 'TIMEOUT'}`);
  const stillPaused = await waitPage(503);
  assert.match(stillPaused.marker, /DEPLOYMENT_PAUSED/);
  stage = 'unpause';
  const resumed = await api('POST', `/v1/projects/${project}/unpause`);
  assert.ok([200, 201, 202, 204].includes(resumed.status),
    `DISPOSABLE_UNPAUSE_HTTP_${resumed.status}`);
  paused = false;
  assert.equal((await waitPage(200)).status, 200);
  console.log(JSON.stringify({ status: 'DISPOSABLE_PAUSED_REDEPLOY_PASS', projectId: project,
    deploymentUid: uid, pausedExternalStatus: 503, deployedWhilePaused: true,
    resumedExternalStatus: 200, liveProjectChanged: false, secretValuesLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'DISPOSABLE_PAUSED_REDEPLOY_FAILED', stage,
    code: /^[A-Z0-9_:]+$/.test(error?.message ?? '') ? error.message : 'PROBE_FAILED',
    cleanupAttempted: paused }));
  process.exitCode = 2;
} finally {
  if (paused) {
    try {
      const resumed = await api('POST', `/v1/projects/${project}/unpause`);
      if (![200, 201, 202, 204].includes(resumed.status)) process.exitCode = 2;
    } catch { process.exitCode = 2; }
  }
}
