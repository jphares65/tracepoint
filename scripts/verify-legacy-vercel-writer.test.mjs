import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_ORIGIN, verifyLegacyVercelResponse } from './verify-legacy-vercel-writer.mjs';

const reply = (status, body, location = null) => new Response(body, {
  status, headers: location ? { location } : {},
});

test('active control pins the production origin and rejects a cross-origin redirect', async () => {
  let requested;
  const result = await verifyLegacyVercelResponse('active', async (url, options) => {
    requested = { url, options };
    return reply(307, '', '/landing');
  });
  assert.equal(requested.url, `${LEGACY_ORIGIN}/`);
  assert.equal(requested.options.redirect, 'manual');
  assert.equal(result.status, 307);
  await assert.rejects(verifyLegacyVercelResponse('active', async () =>
    reply(307, '', 'https://other.example/login')), /VERCEL_REDIRECT_ORIGIN_DRIFT/);
});

test('paused control requires the documented 503 marker, not any error page', async () => {
  const result = await verifyLegacyVercelResponse('paused', async () =>
    reply(503, '<h1>DEPLOYMENT_PAUSED</h1>'));
  assert.equal(result.pauseMarkerPresent, true);
  await assert.rejects(verifyLegacyVercelResponse('paused', async () =>
    reply(503, 'Service unavailable')), /VERCEL_PAUSE_MARKER_MISSING/);
  await assert.rejects(verifyLegacyVercelResponse('paused', async () =>
    reply(403, 'DEPLOYMENT_PAUSED')), /VERCEL_PAUSE_STATUS_NOT_503/);
  await assert.rejects(verifyLegacyVercelResponse('active', async () =>
    reply(503, 'DEPLOYMENT_PAUSED')), /VERCEL_PRODUCTION_NOT_HEALTHY/);
});

test('unrecognized mode fails without issuing a request', async () => {
  await assert.rejects(verifyLegacyVercelResponse('other', async () => {
    throw new Error('must not be called');
  }), /EXACT_MODE_REQUIRED/);
});
