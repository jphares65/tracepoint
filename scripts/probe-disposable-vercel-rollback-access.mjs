#!/usr/bin/env node
// Proves the short-lived cutover token can create, update, and remove an
// environment variable on the approved disposable project only. No live
// TracePoint project or credential is read or changed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { VERCEL_TEAM_ID, VERCEL_TOKEN_SECRET, withExactVercelTeam } from './production-vercel-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
const projectId = 'prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw';
const key = 'TRACEPOINT_ROLLBACK_SENSITIVE_PROBE_20260928';
const aws = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
  ['secretsmanager', 'get-secret-value', '--secret-id', VERCEL_TOKEN_SECRET,
    '--query', 'SecretString', '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'text'],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(aws.status, 0, 'VERCEL_TOKEN_UNAVAILABLE');
const stored = aws.stdout.trim();
const envelope = stored.startsWith('{') ? JSON.parse(stored) : null;
if (envelope) assert.deepEqual(Object.keys(envelope), [VERCEL_TOKEN_SECRET]);
const token = envelope ? envelope[VERCEL_TOKEN_SECRET] : stored;
assert.ok(typeof token === 'string' && token.length >= 32 && !/\s/.test(token), 'VERCEL_TOKEN_INVALID');

async function call(method, path, body) {
  const url = `https://api.vercel.com${withExactVercelTeam(path)}`;
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${token}`, accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  let result = null;
  try { result = await response.json(); } catch { /* no body */ }
  return { status: response.status, result };
}

let createdId = null;
let stage = 'project';
try {
  const project = await call('GET', `/v9/projects/${projectId}`);
  assert.equal(project.status, 200, 'DISPOSABLE_PROJECT_UNAVAILABLE');
  assert.equal(project.result?.id, projectId, 'DISPOSABLE_PROJECT_ID_MISMATCH');
  assert.equal(project.result?.accountId, VERCEL_TEAM_ID, 'DISPOSABLE_TEAM_MISMATCH');
  stage = 'preexisting';
  const existing = await call('GET', `/v9/projects/${projectId}/env`);
  assert.equal(existing.status, 200, 'DISPOSABLE_ENV_UNAVAILABLE');
  assert.equal((existing.result?.envs ?? existing.result ?? []).filter(entry => entry.key === key).length,
    0, 'DISPOSABLE_PROBE_ALREADY_EXISTS');
  const first = `synthetic-${randomUUID()}`;
  const second = `synthetic-${randomUUID()}`;
  stage = 'create';
  const created = await call('POST', `/v9/projects/${projectId}/env`,
    { key, value: first, target: ['production'], type: 'sensitive' });
  assert.ok(created.status === 200 || created.status === 201, `DISPOSABLE_CREATE_HTTP_${created.status}`);
  const entry = Array.isArray(created.result) ? created.result[0] : created.result?.created?.[0] ?? created.result;
  createdId = entry?.id;
  assert.match(createdId ?? '', /^[A-Za-z0-9_-]+$/, 'DISPOSABLE_CREATED_ID_MISSING');
  stage = 'patch';
  const patched = await call('PATCH', `/v9/projects/${projectId}/env/${createdId}`, { value: second });
  assert.equal(patched.status, 200, `DISPOSABLE_PATCH_HTTP_${patched.status}`);
  stage = 'verify';
  const after = await call('GET', `/v9/projects/${projectId}/env`);
  assert.equal(after.status, 200, 'DISPOSABLE_VERIFY_UNAVAILABLE');
  const matches = (after.result?.envs ?? after.result ?? []).filter(item => item.key === key);
  assert.equal(matches.length, 1, 'DISPOSABLE_PROBE_COUNT_MISMATCH');
  assert.equal(matches[0].id, createdId, 'DISPOSABLE_PROBE_ID_MISMATCH');
  assert.equal(matches[0].type, 'sensitive', 'DISPOSABLE_PROBE_TYPE_MISMATCH');
  stage = 'cleanup';
  const deleted = await call('DELETE', `/v9/projects/${projectId}/env/${createdId}`);
  assert.ok(deleted.status === 200 || deleted.status === 204, `DISPOSABLE_DELETE_HTTP_${deleted.status}`);
  createdId = null;
  console.log(JSON.stringify({ status: 'DISPOSABLE_VERCEL_ENV_ROLLBACK_PERMISSION_PASS',
    projectId, teamId: VERCEL_TEAM_ID, create: created.status, patch: patched.status,
    delete: deleted.status, secretValuesLogged: false, liveProjectChanged: false }));
} catch (error) {
  if (createdId) {
    try { await call('DELETE', `/v9/projects/${projectId}/env/${createdId}`); } catch { /* report below */ }
  }
  console.error(JSON.stringify({ status: 'DISPOSABLE_VERCEL_ENV_ROLLBACK_PERMISSION_BLOCKED',
    stage, code: /^[A-Z0-9_:]+$/.test(error?.message ?? '') ? error.message : 'PROBE_FAILED',
    cleanupNeeded: Boolean(createdId) }));
  process.exitCode = 2;
}
