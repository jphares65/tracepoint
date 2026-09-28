#!/usr/bin/env node
// Exact disposable-only proof of a project-level Production deny surviving a
// fresh Production deployment. Cleans up only its own named rule in finally.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { VERCEL_TEAM_ID, VERCEL_TOKEN_SECRET, withExactVercelTeam }
  from './production-vercel-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'],
  'EXACT_PROFILE_REQUIRED');
const project = 'prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw';
const ruleName = 'TracePoint disposable redeploy deny 20260928';
const origin = 'https://project-q7s6a.vercel.app/';
const aws = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
  ['secretsmanager', 'get-secret-value', '--secret-id', VERCEL_TOKEN_SECRET,
    '--query', 'SecretString', '--profile', 'tracepoint-production',
    '--region', 'us-east-1', '--output', 'text'], { encoding: 'utf8' });
assert.equal(aws.status, 0, 'VERCEL_TOKEN_UNAVAILABLE');
const raw = aws.stdout.trim();
const wrapped = raw.startsWith('{') ? JSON.parse(raw) : null;
if (wrapped) assert.deepEqual(Object.keys(wrapped), [VERCEL_TOKEN_SECRET]);
const token = wrapped ? wrapped[VERCEL_TOKEN_SECRET] : raw;
assert.ok(typeof token === 'string' && token.length >= 32 && !/\s/.test(token));

async function api(method, path, body) {
  const response = await fetch(`https://api.vercel.com${withExactVercelTeam(path)}`,
    { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await response.json(); } catch { /* status authoritative */ }
  return { status: response.status, json };
}
const configPath = `/v1/security/firewall/config?projectId=${project}`;
async function config() {
  const result = await api('GET', configPath);
  assert.equal(result.status, 200, `DISPOSABLE_CONFIG_HTTP_${result.status}`);
  return result.json;
}
async function activateDraft() {
  const current = await config();
  const version = current?.draft?.version;
  if (current?.draft == null) return; // This API may publish PATCH immediately.
  assert.ok(Number.isSafeInteger(version) && version > 0, 'DISPOSABLE_DRAFT_VERSION_MISSING');
  const activated = await api('POST',
    `/v1/security/firewall/config/${version}/activate?projectId=${project}`);
  assert.equal(activated.status, 200, `DISPOSABLE_ACTIVATE_HTTP_${activated.status}`);
}
async function waitExternal(expected) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(origin, { redirect: 'manual',
      signal: AbortSignal.timeout(15_000), headers: { 'cache-control': 'no-cache' } });
    await response.arrayBuffer();
    if (response.status === expected) return;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`DISPOSABLE_EXTERNAL_${expected}_NOT_REACHED`);
}
async function removeOwnRule() {
  const current = await config();
  const matches = [...(current?.active?.rules ?? []), ...(current?.draft?.rules ?? [])]
    .filter(rule => rule?.name === ruleName);
  const ids = [...new Set(matches.map(rule => rule.id).filter(Boolean))];
  if (ids.length === 0) return;
  assert.equal(ids.length, 1, 'DISPOSABLE_OWN_RULE_AMBIGUOUS');
  const deleted = await api('PATCH', configPath, { action: 'rules.remove', id: ids[0] });
  assert.equal(deleted.status, 200, `DISPOSABLE_REMOVE_HTTP_${deleted.status}`);
  await activateDraft();
}
let stage = 'baseline';
let inserted = false;
try {
  const identity = await api('GET', `/v9/projects/${project}`);
  assert.equal(identity.status, 200, 'DISPOSABLE_PROJECT_UNAVAILABLE');
  assert.equal(identity.json?.id, project, 'DISPOSABLE_PROJECT_MISMATCH');
  assert.equal(identity.json?.accountId, VERCEL_TEAM_ID, 'DISPOSABLE_TEAM_MISMATCH');
  assert.equal(identity.json?.name, 'project-q7s6a', 'DISPOSABLE_NAME_MISMATCH');
  const before = await config();
  assert.equal((before?.active?.rules ?? []).length, 0, 'DISPOSABLE_EXISTING_RULES');
  assert.equal(before?.draft, null, 'DISPOSABLE_EXISTING_DRAFT');
  await waitExternal(200);
  stage = 'insert';
  const added = await api('PATCH', configPath, { action: 'rules.insert', id: null,
    value: { active: true, name: ruleName,
      description: 'Temporary synthetic deployment deny proof',
      conditionGroup: [{ conditions: [{ type: 'environment', op: 'eq', value: 'production' }] }],
      action: { mitigate: { action: 'deny' } } } });
  assert.equal(added.status, 200, `DISPOSABLE_RULE_INSERT_HTTP_${added.status}`);
  inserted = true;
  stage = 'activate';
  await activateDraft();
  assert.equal((await config())?.active?.rules?.filter(rule => rule.name === ruleName).length,
    1, 'DISPOSABLE_RULE_NOT_ACTIVE');
  await waitExternal(403);
  stage = 'redeploy-under-deny';
  const created = await api('POST', '/v13/deployments?forceNew=1', {
    name: 'project-q7s6a', project, target: 'production',
    files: [{ file: 'index.html', data: '<!doctype html><title>TracePoint disposable deny redeploy proof</title><h1>Disposable proof only</h1>' }],
  });
  assert.equal(created.status, 200, `DISPOSABLE_DEPLOY_HTTP_${created.status}`);
  const uid = created.json?.uid ?? created.json?.id;
  assert.match(uid ?? '', /^dpl_[A-Za-z0-9]+$/, 'DISPOSABLE_DEPLOY_ID_MISSING');
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
  await waitExternal(403);
  stage = 'remove';
  await removeOwnRule();
  inserted = false;
  await waitExternal(200);
  console.log(JSON.stringify({ status: 'DISPOSABLE_REDEPLOY_DENY_PASS', projectId: project,
    deploymentUid: uid, deniedBeforeAndAfterRedeploy: true, restoredStatus: 200,
    liveProjectChanged: false, tokenLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'DISPOSABLE_REDEPLOY_DENY_FAILED', stage,
    code: /^[A-Z0-9_:]+$/.test(error?.message ?? '') ? error.message : 'PROBE_FAILED',
    cleanupRequired: inserted }));
  process.exitCode = 2;
} finally {
  if (inserted) {
    try { await removeOwnRule(); } catch { process.exitCode = 2; }
  }
}
