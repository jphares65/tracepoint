import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNativeLoginRedirect, verifyNativeLogin } from './test-staging-native-login.mjs';

function response(status, location) { return { status, headers: new Headers(location ? { location } : {}) }; }

test('native login accepts only the expected Cognito authorization-code redirect', () => {
  const url = new URL('https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com/oauth2/authorize');
  url.search = new URLSearchParams({ response_type: 'code', redirect_uri: 'https://staging.tracepointhq.com/api/auth/cognito/callback', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43), state: 'b'.repeat(16) }).toString();
  assert.doesNotThrow(() => assertNativeLoginRedirect(response(303, url.toString())));
  assert.throws(() => assertNativeLoginRedirect(response(303, 'https://example.invalid/oauth2/authorize')));
  assert.throws(() => assertNativeLoginRedirect(response(200, url.toString())));
});

test('native login verification requires Cognito UI and denies invalid mobile bearers', async () => {
  const redirect = new URL('https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com/oauth2/authorize');
  redirect.search = new URLSearchParams({ response_type: 'code', redirect_uri: 'https://staging.tracepointhq.com/api/auth/cognito/callback', code_challenge_method: 'S256', code_challenge: 'a'.repeat(43), state: 'b'.repeat(16) }).toString();
  const requests = [];
  await verifyNativeLogin(async (url, init = {}) => {
    const href = String(url); requests.push({ href, init });
    if (href.endsWith('/api/auth/cognito/login')) return new Response(null, { status: 303, headers: { location: redirect.toString() } });
    if (href.endsWith('/login')) return new Response('<form action="/api/auth/cognito/login"><button>Continue with secure sign-in</button></form>', { status: 200 });
    return new Response(null, { status: 401 });
  });
  assert.equal(requests.length, 5);
});
