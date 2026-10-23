import assert from 'node:assert/strict';
import test from 'node:test';
import { captureCognitoLoginDiagnostics } from './staging-cognito-login.mjs';
import { sanitizeAcceptanceCheck } from './staging-acceptance-evidence.mjs';

function pageAt(url, visibleText = '') {
  return {
    url: () => url,
    locator: selector => ({
      innerText: async () => selector === 'body' ? visibleText : '',
      first() { return this; },
      isVisible: async () => selector.includes('one-time-code'),
    }),
  };
}

test('Cognito timeout diagnostics identify the failing login step without retaining page text or URL values', async () => {
  const diagnostics = await captureCognitoLoginDiagnostics(
    pageAt('https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com/login?state=private', 'Verification code for officer@example.invalid'),
    'https://staging.tracepointhq.com',
    { step: 'wait-for-totp-input', callbackStatus: null, totpSubmissions: 0 },
  );
  assert.deepEqual(diagnostics, {
    step: 'wait-for-totp-input', onCognitoHost: true, callbackReached: false, hostClass: 'cognito', pathClass: 'login',
    mfaPromptVisible: true, otpInputVisible: true, passwordInputVisible: false, invalidCodeNotice: false,
    expiredCodeNotice: false, retryNotice: false, genericRequestError: false, totpSubmissions: 0, callbackStatus: null,
  });
  const safe = sanitizeAcceptanceCheck({ name: 'Cognito login', status: 'fail', phase: 'cognito-pkce-mfa-login', diagnostics: {
    ...diagnostics, pageText: 'must not persist', query: 'private', password: 'never-copy',
  } });
  assert.equal(safe.diagnostics.step, 'wait-for-totp-input');
  assert.equal(JSON.stringify(safe).includes('private'), false);
  assert.equal(JSON.stringify(safe).includes('officer@example.invalid'), false);
  assert.equal(JSON.stringify(safe).includes('must not persist'), false);
});

test('Cognito timeout diagnostics classify the application callback without recording its query string', async () => {
  const diagnostics = await captureCognitoLoginDiagnostics(
    pageAt('https://staging.tracepointhq.com/api/auth/cognito/callback?code=credential&state=private'),
    'https://staging.tracepointhq.com',
    { step: 'complete-pkce-callback', callbackStatus: 303, totpSubmissions: 1 },
  );
  assert.equal(diagnostics.hostClass, 'application');
  assert.equal(diagnostics.pathClass, 'callback');
  assert.equal(diagnostics.callbackReached, true);
  assert.equal(JSON.stringify(diagnostics).includes('credential'), false);
  assert.equal(JSON.stringify(diagnostics).includes('private'), false);
});
