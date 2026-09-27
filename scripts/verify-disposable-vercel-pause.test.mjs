import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDisposableVercelPause } from './verify-disposable-vercel-pause.mjs';

const reply = (status, body) => async () => new Response(body, { status });

test('active proof requires exact synthetic page', async () => {
  const result = await verifyDisposableVercelPause('active', reply(200,
    '<h1>TracePoint disposable Vercel pause proof</h1>'));
  assert.equal(result.status, 200);
  await assert.rejects(verifyDisposableVercelPause('active', reply(200, 'unrelated')),
    /PROOF_DEPLOYMENT_IDENTITY_MISMATCH/);
});

test('paused proof requires 503 and Vercel pause marker', async () => {
  const result = await verifyDisposableVercelPause('paused', reply(503,
    'DEPLOYMENT_PAUSED'));
  assert.equal(result.status, 503);
  await assert.rejects(verifyDisposableVercelPause('paused', reply(503, 'maintenance')),
    /PROOF_PAUSE_MARKER_MISSING/);
  await assert.rejects(verifyDisposableVercelPause('paused', reply(200,
    'DEPLOYMENT_PAUSED')), /PROOF_PAUSE_STATUS_NOT_503/);
});
