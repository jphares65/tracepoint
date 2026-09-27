#!/usr/bin/env node
// Read-only external verifier for the single synthetic Vercel project.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROJECT_ID = 'prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw';
export const ORIGIN = 'https://project-q7s6a.vercel.app';

export async function verifyDisposableWaf(expected, fetchImpl = fetch) {
  assert.ok(expected === 'active' || expected === 'denied', 'EXACT_MODE_REQUIRED');
  const response = await fetchImpl(`${ORIGIN}/`, {
    method: 'GET', redirect: 'manual', cache: 'no-store',
    headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.text()).slice(0, 64_000);
  if (expected === 'denied') {
    assert.equal(response.status, 403, 'WAF_DENY_STATUS_NOT_403');
    assert.doesNotMatch(body, /TracePoint disposable Vercel pause proof/,
      'SYNTHETIC_APPLICATION_REACHED_WHILE_DENIED');
  } else {
    assert.equal(response.status, 200, 'SYNTHETIC_DEPLOYMENT_NOT_HEALTHY');
    assert.match(body, /TracePoint disposable Vercel pause proof/,
      'SYNTHETIC_DEPLOYMENT_IDENTITY_MISMATCH');
  }
  return { projectId: PROJECT_ID, origin: ORIGIN, expected,
    status: response.status, checkedAtUtc: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 3, 'EXACT_MODE_REQUIRED');
    console.log(JSON.stringify(await verifyDisposableWaf(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ status: 'DISPOSABLE_VERCEL_WAF_UNVERIFIED',
      code: error?.message ?? 'UNKNOWN' }));
    process.exitCode = 2;
  }
}
