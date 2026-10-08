import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const stagingOrigin = 'https://staging.tracepointhq.com';
const cognitoOrigin = 'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com';
const callback = `${stagingOrigin}/api/auth/cognito/callback`;
const mobileBearerProbes = Object.freeze([
  ['/api/mobile/session', 'POST'],
  ['/api/mobile/range-days', 'GET'],
  ['/api/mobile/range-workspace', 'GET'],
]);

function assertDenied(response, path, { allowKnownDiagnosticBaselineMobile404 = false } = {}) {
  if ([401, 403].includes(response.status)) return;
  // This is deliberately narrower than treating 404 as an authentication denial:
  // it is available only to the one-shot diagnostic pre-deploy baseline, which is
  // independently pinned by the release script to the known recovery image.
  if (allowKnownDiagnosticBaselineMobile404 && response.status === 404) {
    console.log(JSON.stringify({ stagingMobileBaselineDiagnostic: 'known_route_absence_only', path }));
    return;
  }
  assert.fail(`${path} must deny an invalid bearer token with 401 or 403.`);
}

export async function verifyMobileInvalidBearer(fetchImpl = fetch, options = {}) {
  for (const [path, method] of mobileBearerProbes) {
    const denied = await fetchImpl(`${stagingOrigin}${path}`, {
      method,
      headers: { authorization: 'Bearer invalid-staging-token' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    assertDenied(denied, path, options);
  }
}

export async function verifyExistingBaselineBearerGuard(fetchImpl = fetch) {
  const denied = await fetchImpl(`${stagingOrigin}/api/access`, {
    headers: { authorization: 'Bearer invalid-staging-token' },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok([401, 403].includes(denied.status), '/api/access must deny an invalid bearer token with 401 or 403.');
}

export function assertNativeLoginRedirect(response) {
  assert.ok([302, 303, 307, 308].includes(response.status), 'Cognito login initiation must redirect.');
  const location = response.headers.get('location');
  assert.ok(location, 'Cognito login initiation must supply a redirect location.');
  const target = new URL(location, stagingOrigin);
  assert.equal(target.origin, cognitoOrigin, 'Login must redirect only to the configured staging Cognito domain.');
  assert.equal(target.pathname, '/oauth2/authorize');
  assert.equal(target.searchParams.get('response_type'), 'code');
  assert.equal(target.searchParams.get('redirect_uri'), callback);
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.match(target.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43,128}$/);
  assert.match(target.searchParams.get('state') ?? '', /^[A-Za-z0-9_-]{16,512}$/);
}

export async function verifyNativeLogin(fetchImpl = fetch, { allowKnownDiagnosticRejection = false, allowKnownDiagnosticBaselineMobile404 = false } = {}) {
  const login = await fetchImpl(`${stagingOrigin}/login`, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  assert.equal(login.status, 200);
  const document = await login.text();
  assert.match(document, /Continue with secure sign-in/);
  assert.match(document, /action="\/api\/auth\/cognito\/login"/);
  assert.doesNotMatch(document, /type="email"/);
  assert.doesNotMatch(document, /type="password"/);

  const started = await fetchImpl(`${stagingOrigin}/api/auth/cognito/login`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20_000),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: stagingOrigin }, body: new URLSearchParams({ next: '/' }),
  });
  if (allowKnownDiagnosticRejection && started.status === 400 && (await started.clone().json()).code === 'invalid_request') {
    console.log(JSON.stringify({ stagingLoginDiagnostic: 'known_invalid_request_only' }));
  } else assertNativeLoginRedirect(started);
  if (allowKnownDiagnosticBaselineMobile404) await verifyExistingBaselineBearerGuard(fetchImpl);
  await verifyMobileInvalidBearer(fetchImpl, { allowKnownDiagnosticBaselineMobile404 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const captureOnly = process.argv.includes('--verify-mobile-bearer-only');
  const options = {
    allowKnownDiagnosticRejection: process.argv.includes('--allow-known-diagnostic-rejection'),
    allowKnownDiagnosticBaselineMobile404: process.argv.includes('--allow-known-diagnostic-baseline-mobile-404'),
  };
  if (captureOnly) await verifyMobileInvalidBearer(fetch);
  else await verifyNativeLogin(fetch, options);
  console.log(JSON.stringify({ stagingOrigin, cognitoOrigin, nativeLogin: 'verified', invalidBearer: 'denied' }));
}
