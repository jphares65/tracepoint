#!/usr/bin/env node
// Exact-project external pause/resume probe; never mutates Vercel state.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROOF_PROJECT_ID = 'prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw';
export const PROOF_ORIGIN = 'https://project-q7s6a.vercel.app';

export async function verifyDisposableVercelPause(expected, fetchImpl = fetch) {
  assert.ok(expected === 'active' || expected === 'paused', 'EXACT_MODE_REQUIRED');
  const response = await fetchImpl(`${PROOF_ORIGIN}/`, {
    method: 'GET', redirect: 'manual', cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: { 'cache-control': 'no-cache' },
  });
  const body = (await response.text()).slice(0, 64_000);
  if (expected === 'paused') {
    assert.equal(response.status, 503, 'PROOF_PAUSE_STATUS_NOT_503');
    assert.match(body, /DEPLOYMENT_PAUSED/, 'PROOF_PAUSE_MARKER_MISSING');
  } else {
    assert.equal(response.status, 200, 'PROOF_DEPLOYMENT_NOT_HEALTHY');
    assert.match(body, /TracePoint disposable Vercel pause proof/,
      'PROOF_DEPLOYMENT_IDENTITY_MISMATCH');
  }
  return { projectId: PROOF_PROJECT_ID, origin: PROOF_ORIGIN, expected,
    status: response.status, checkedAtUtc: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 3, 'EXACT_MODE_REQUIRED');
    console.log(JSON.stringify(await verifyDisposableVercelPause(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ status: 'VERCEL_PAUSE_PROOF_UNVERIFIED',
      code: error?.message ?? 'UNKNOWN' }));
    process.exitCode = 2;
  }
}
