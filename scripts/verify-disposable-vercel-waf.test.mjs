import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, PROJECT_ID, verifyDisposableWaf } from './verify-disposable-vercel-waf.mjs';

test('disposable WAF verifier accepts only exact synthetic active or denied state', async () => {
  assert.equal(PROJECT_ID, 'prj_wkk5IA0iS8cTKKuaTQoNbxYncCFw');
  const marker = 'TracePoint disposable Vercel pause proof';
  const fetchImpl = async (url) => {
    assert.equal(url, `${ORIGIN}/`);
    return new Response(marker, { status: 200 });
  };
  assert.equal((await verifyDisposableWaf('active', fetchImpl)).status, 200);
  await assert.rejects(() => verifyDisposableWaf('denied', fetchImpl));
  await assert.rejects(() => verifyDisposableWaf('paused', fetchImpl));
});

test('deny requires 403 and no synthetic application marker', async () => {
  assert.equal((await verifyDisposableWaf('denied', async () =>
    new Response('Forbidden', { status: 403 }))).status, 403);
  await assert.rejects(() => verifyDisposableWaf('denied', async () =>
    new Response('TracePoint disposable Vercel pause proof', { status: 403 })));
});
