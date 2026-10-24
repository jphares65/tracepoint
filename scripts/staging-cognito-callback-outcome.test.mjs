import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAcceptanceReport } from './staging-acceptance-evidence.mjs';
import {
  assertCallbackAuthenticated, classifyCallbackLanding, CognitoCallbackRejectedError, describeCallbackRequest, loginThroughCognitoPkce,
} from './staging-cognito-login.mjs';

// Run a1bae9d2: the application refused the Instructor's callback with 303 -> /login?notice=authorization_rejected,
// which the sign-in helper took for success. These tests drive the helper through both callback outcomes and pin that
// its diagnostics never carry the authorization code, state, cookies or MFA material.
const baseURL = 'https://staging.tracepointhq.com';
const cognito = 'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com';
const code = 'c0de-SECRET-authorization-code';
const state = 'st4te-SECRET-value';
const flowCookieValue = 'SECRET-flow-handle';
const sessionCookieValue = 'SECRET-session-handle';
const callbackUrl = `${baseURL}/api/auth/cognito/callback?code=${code}&state=${state}`;
const secrets = [code, state, flowCookieValue, sessionCookieValue, 'Aa1!password'];

/** A Playwright page reduced to what loginThroughCognitoPkce uses: Cognito accepts the password and redirects back. */
function fakePage(callbackLocation, { callbacks = 1 } = {}) {
  const listeners = { request: [], response: [] };
  let url = 'about:blank';
  const emit = (event, value) => listeners[event].forEach(listener => listener(value));
  const request = target => ({ url: () => target, allHeaders: async () => ({ cookie: `__Host-tracepoint-cognito-flow=${flowCookieValue}; other=1` }) });
  const element = (onClick = async () => {}) => ({
    first() { return this; }, last() { return this; },
    waitFor: async () => {}, fill: async () => {}, click: onClick,
    isVisible: async () => url.startsWith(cognito), inputValue: async () => 'filled', innerText: async () => '',
  });
  return {
    on: (event, listener) => listeners[event]?.push(listener),
    url: () => url,
    goto: async target => { url = target; },
    waitForURL: async predicate => { assert.equal(predicate(new URL(url)), true, `unexpected page ${url}`); },
    waitForTimeout: async () => {},
    getByRole: (role, { name }) => element(async () => {
      if (String(name) === String(/continue with secure sign-in/i)) {
        emit('request', request(`${baseURL}/api/auth/cognito/login`));
        url = `${cognito}/login?client_id=x`;
        return;
      }
      for (let index = 0; index < callbacks; index += 1) {
        emit('request', request(callbackUrl));
        emit('response', { url: () => callbackUrl, status: () => 303, headers: () => ({ location: callbackLocation, 'set-cookie': `__Host-tracepoint-cognito-session=${sessionCookieValue}` }) });
      }
      url = new URL(callbackLocation, baseURL).toString();
    }),
    locator: () => element(),
  };
}
const signIn = page => loginThroughCognitoPkce({ page, baseURL, email: 'acceptance-x-instructor@example.invalid', password: 'Aa1!password' });

test('a callback that lands on an application page completes the sign-in', async () => {
  await signIn(fakePage(`${baseURL}/`));
});

test('a callback refused with /login?notice=authorization_rejected fails the sign-in with safe diagnostics', async () => {
  const error = await signIn(fakePage(`${baseURL}/login?notice=authorization_rejected`)).then(() => assert.fail('must not sign in'), error => error);
  assert.ok(error instanceof CognitoCallbackRejectedError);
  for (const [key, expected] of Object.entries({
    callbackStatus: 303, callbackLanding: 'login', loginNotice: 'authorization_rejected',
    callbackHadCode: true, callbackHadState: true, providerError: 'none', flowCookiePresent: true,
    callbacksSeen: 1, signInStarts: 1, callbackSeconds: 0,
  })) assert.equal(error.acceptanceDiagnostics[key], expected, key);
  for (const secret of secrets) assert.doesNotMatch(JSON.stringify(error.acceptanceDiagnostics) + error.message, new RegExp(secret));
});

test('a sign-in whose callback ran twice is refused, since the application treats a flow opened twice as rejected', async () => {
  const error = await signIn(fakePage(`${baseURL}/`, { callbacks: 2 })).then(() => assert.fail('must not sign in'), error => error);
  assert.ok(error instanceof CognitoCallbackRejectedError);
  assert.equal(error.acceptanceDiagnostics.callbacksSeen, 2);
});

test('callback facts are recorded by presence and fixed codes only', () => {
  assert.deepEqual(describeCallbackRequest(callbackUrl, `__Host-tracepoint-cognito-flow=${flowCookieValue}`),
    { callbackHadCode: true, callbackHadState: true, providerError: 'none', flowCookiePresent: true });
  assert.deepEqual(describeCallbackRequest(`${baseURL}/api/auth/cognito/callback?error=access_denied&error_description=${code}`),
    { callbackHadCode: false, callbackHadState: false, providerError: 'access_denied', flowCookiePresent: false });
  assert.equal(describeCallbackRequest(`${baseURL}/api/auth/cognito/callback?error=${code}`).providerError, 'other');
  assert.equal(describeCallbackRequest(callbackUrl, '__Host-tracepoint-cognito-flow=a; __Host-tracepoint-cognito-flow=b').flowCookiePresent, false);
  assert.deepEqual(classifyCallbackLanding('/', baseURL), { landing: 'application' });
  assert.deepEqual(classifyCallbackLanding('/login?notice=authorization_unavailable', baseURL), { landing: 'login', loginNotice: 'authorization_unavailable' });
  assert.deepEqual(classifyCallbackLanding(`/login?notice=${code}`, baseURL), { landing: 'login', loginNotice: 'other' });
  assert.deepEqual(classifyCallbackLanding('https://elsewhere.example/', baseURL), { landing: 'other' });
  assert.throws(() => assertCallbackAuthenticated({ status: 200, location: '/', callbacks: 1 }, baseURL), CognitoCallbackRejectedError);
  assert.throws(() => assertCallbackAuthenticated({ callbacks: 0 }, baseURL), CognitoCallbackRejectedError);
});

test('the evidence report keeps the callback diagnostics and nothing else', () => {
  const report = createAcceptanceReport({
    fixtureRun: '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', sourceCommit: 'a'.repeat(40), taskRevision: '194', appImageDigest: `sha256:${'b'.repeat(64)}`,
    startedAt: '2026-10-24T01:35:05.851Z',
    checks: [{ name: 'authenticated acceptance execution', status: 'fail', code: 'COGNITO_CALLBACK_REJECTED', role: 'instructor', phase: 'cognito-verify-pkce-callback-outcome',
      errorName: 'CognitoCallbackRejectedError', diagnostics: { callbackStatus: 303, callbackLanding: 'login', loginNotice: 'authorization_rejected', providerError: 'none',
        callbackHadCode: true, callbackHadState: true, flowCookiePresent: true, callbacksSeen: 1, signInStarts: 1, callbackSeconds: 41, code, state } }],
  });
  assert.deepEqual(report.checks[0].diagnostics, { callbackStatus: 303, callbackLanding: 'login', loginNotice: 'authorization_rejected', providerError: 'none',
    callbackHadCode: true, callbackHadState: true, flowCookiePresent: true, callbacksSeen: 1, signInStarts: 1, callbackSeconds: 41 });
  assert.equal(report.checks[0].code, 'COGNITO_CALLBACK_REJECTED');
  for (const secret of secrets) assert.doesNotMatch(JSON.stringify(report), new RegExp(secret));
});
