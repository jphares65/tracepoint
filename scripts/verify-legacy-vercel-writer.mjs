#!/usr/bin/env node
// Read-only external response proof for the exact legacy production origin.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const LEGACY_ORIGIN = 'https://tracepoint-amber.vercel.app';
export const LEGACY_PROJECT_ID = 'prj_V03LJyQIc231luvZ9u0gcOAt4xK4';

export async function verifyLegacyVercelResponse(expected, fetchImpl = fetch) {
  assert.ok(expected === 'active' || expected === 'paused', 'EXACT_MODE_REQUIRED');
  const response = await fetchImpl(`${LEGACY_ORIGIN}/`, {
    method: 'GET', redirect: 'manual', cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
    headers: { 'cache-control': 'no-cache' },
  });
  const location = response.headers.get('location');
  const body = (await response.text()).slice(0, 64_000);
  if (expected === 'paused') {
    assert.equal(response.status, 503, 'VERCEL_PAUSE_STATUS_NOT_503');
    assert.match(body, /DEPLOYMENT_PAUSED/, 'VERCEL_PAUSE_MARKER_MISSING');
  } else {
    assert.ok(response.status >= 200 && response.status < 400,
      'VERCEL_PRODUCTION_NOT_HEALTHY');
    assert.doesNotMatch(body, /DEPLOYMENT_PAUSED/, 'VERCEL_PROJECT_STILL_PAUSED');
    if (location) assert.equal(new URL(location, LEGACY_ORIGIN).origin, LEGACY_ORIGIN,
      'VERCEL_REDIRECT_ORIGIN_DRIFT');
  }
  return { projectId: LEGACY_PROJECT_ID, origin: LEGACY_ORIGIN, expected,
    status: response.status, pauseMarkerPresent: body.includes('DEPLOYMENT_PAUSED'),
    checkedAtUtc: new Date().toISOString() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert.equal(process.argv.length, 3, 'EXACT_MODE_REQUIRED');
    console.log(JSON.stringify(await verifyLegacyVercelResponse(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ status: 'LEGACY_VERCEL_RESPONSE_UNVERIFIED',
      code: error?.message ?? 'UNKNOWN' }));
    process.exitCode = 2;
  }
}
