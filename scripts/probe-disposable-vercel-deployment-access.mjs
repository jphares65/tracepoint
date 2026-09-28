#!/usr/bin/env node
// Creates one synthetic deployment on the explicitly approved disposable
// project. It does not target the live TracePoint project or its Git repo.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_TEAM_ID, VERCEL_TOKEN_SECRET, withExactVercelTeam } from './production-vercel-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
const projectId = 'prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw';
const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
  ['secretsmanager', 'get-secret-value', '--secret-id', VERCEL_TOKEN_SECRET,
    '--query', 'SecretString', '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'text'],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(result.status, 0, 'VERCEL_TOKEN_UNAVAILABLE');
const raw = result.stdout.trim();
const envelope = raw.startsWith('{') ? JSON.parse(raw) : null;
if (envelope) assert.deepEqual(Object.keys(envelope), [VERCEL_TOKEN_SECRET]);
const token = envelope ? envelope[VERCEL_TOKEN_SECRET] : raw;
assert.ok(typeof token === 'string' && token.length >= 32 && !/\s/.test(token), 'VERCEL_TOKEN_INVALID');

async function call(method, path, body) {
  const response = await fetch(`https://api.vercel.com${withExactVercelTeam(path)}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${token}`, accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await response.json(); } catch { /* status remains authoritative */ }
  return { status: response.status, json };
}

let stage = 'project';
try {
  const project = await call('GET', `/v9/projects/${projectId}`);
  assert.equal(project.status, 200, 'DISPOSABLE_PROJECT_UNAVAILABLE');
  assert.equal(project.json?.id, projectId);
  assert.equal(project.json?.accountId, VERCEL_TEAM_ID);
  const name = project.json.name;
  assert.equal(name, 'project-q7s6a', 'DISPOSABLE_PROJECT_NAME_MISMATCH');
  stage = 'create';
  const created = await call('POST', '/v13/deployments?forceNew=1', {
    name, project: projectId, target: 'production',
    files: [{ file: 'index.html', data: '<!doctype html><title>TracePoint disposable rollback deployment proof</title><h1>Disposable proof only</h1>' }],
  });
  assert.equal(created.status, 200, `DISPOSABLE_DEPLOY_HTTP_${created.status}`);
  const uid = created.json?.uid ?? created.json?.id;
  assert.match(uid ?? '', /^dpl_[A-Za-z0-9]+$/, 'DISPOSABLE_DEPLOY_ID_MISSING');
  assert.equal(created.json?.projectId, projectId, 'DISPOSABLE_DEPLOY_PROJECT_MISMATCH');
  stage = 'poll';
  let ready = null;
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const state = await call('GET', `/v13/deployments/${uid}`);
    assert.equal(state.status, 200, 'DISPOSABLE_DEPLOY_READ_FAILED');
    assert.equal(state.json?.projectId, projectId, 'DISPOSABLE_DEPLOY_PROJECT_MISMATCH');
    ready = state.json?.readyState;
    if (ready === 'READY' || ready === 'ERROR' || ready === 'CANCELED') break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(ready, 'READY', `DISPOSABLE_DEPLOY_NOT_READY_${ready ?? 'UNKNOWN'}`);
  console.log(JSON.stringify({ status: 'DISPOSABLE_VERCEL_FRESH_DEPLOY_PERMISSION_PASS',
    projectId, deploymentUid: uid, readyState: ready, liveProjectChanged: false,
    customerDataIncluded: false, tokenLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'DISPOSABLE_VERCEL_FRESH_DEPLOY_PERMISSION_BLOCKED', stage,
    code: /^[A-Z0-9_:]+$/.test(error?.message ?? '') ? error.message : 'PROBE_FAILED' }));
  process.exitCode = 2;
}
