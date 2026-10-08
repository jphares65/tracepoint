import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNativeLoginRedirect, verifyBaselineInvalidBearer, verifyCandidateMobileInvalidBearer, verifyNativeLogin } from './test-staging-native-login.mjs';

const response = (status) => new Response('', { status });

test('native login accepts only the expected Cognito authorization-code redirect', () => {
  const url = new URL('https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com/oauth2/authorize');
  url.search = new URLSearchParams({ response_type: 'code', redirect_uri: 'https://staging.tracepointhq.com/api/auth/cognito/callback', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43), state: 'b'.repeat(16) }).toString();
  assert.doesNotThrow(() => assertNativeLoginRedirect({ status: 303, headers: new Headers({ location: url.toString() }) }));
  assert.throws(() => assertNativeLoginRedirect({ status: 303, headers: new Headers({ location: 'https://example.invalid/oauth2/authorize' }) }));
});

test('baseline login keeps the stable access invalid-bearer probe', async () => {
  const redirect = new URL('https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com/oauth2/authorize');
  redirect.search = new URLSearchParams({ response_type: 'code', redirect_uri: 'https://staging.tracepointhq.com/api/auth/cognito/callback', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43), state: 'b'.repeat(16) }).toString();
  const requests = [];
  await verifyNativeLogin(async (url) => { const href = String(url); requests.push(href); if (href.endsWith('/api/auth/cognito/login')) return new Response(null, { status: 303, headers: { location: redirect.toString() } }); if (href.endsWith('/login')) return new Response('<form action="/api/auth/cognito/login"><button>Continue with secure sign-in</button></form>', { status: 200 }); return response(401); });
  assert.deepEqual(requests.filter((url) => url.includes('/api/mobile/')), []);
  assert.ok(requests.some((url) => url.endsWith('/api/access')));
});

test('baseline accepts only a denied invalid bearer on the stable access route', async () => {
  for (const status of [401, 403]) await verifyBaselineInvalidBearer(async (url) => { assert.match(url, /\/api\/access$/); return response(status); });
  for (const status of [200, 404, 500]) await assert.rejects(() => verifyBaselineInvalidBearer(async () => response(status)));
});

test('post-deploy requires every mobile invalid-bearer probe to deny', async () => {
  for (const status of [401, 403]) await verifyCandidateMobileInvalidBearer(async () => response(status));
  for (const status of [200, 404, 500]) await assert.rejects(() => verifyCandidateMobileInvalidBearer(async () => response(status)));
});
