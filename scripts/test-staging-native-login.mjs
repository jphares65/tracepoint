import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const stagingOrigin = 'https://staging.tracepointhq.com';
const cognitoOrigin = 'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com';
const callback = `${stagingOrigin}/api/auth/cognito/callback`;

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

export function assertInvalidBearerDenied(response, path) {
  assert.ok([401, 403].includes(response.status), `${path} must deny an invalid bearer token; received HTTP ${response.status}.`);
}

export async function verifyBaselineInvalidBearer(fetchImpl = fetch) {
  const denied = await fetchImpl(`${stagingOrigin}/api/access`, {
    headers: { authorization: 'Bearer invalid-staging-token' }, redirect: 'manual', signal: AbortSignal.timeout(20_000),
  });
  assertInvalidBearerDenied(denied, '/api/access');
}

export async function verifyCandidateMobileInvalidBearer(fetchImpl = fetch) {
  for (const [path, method] of [['/api/mobile/session', 'POST'], ['/api/mobile/range-days', 'GET'], ['/api/mobile/range-workspace', 'GET']]) {
    const denied = await fetchImpl(`${stagingOrigin}${path}`, { method, headers: { authorization: 'Bearer invalid-staging-token' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    assertInvalidBearerDenied(denied, path);
  }
}

export async function verifyNativeLogin(fetchImpl = fetch) {
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
  assertNativeLoginRedirect(started);
  await verifyBaselineInvalidBearer(fetchImpl);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const phase = process.argv.includes('--post-deploy') ? 'post-deploy' : 'baseline';
  if (phase === 'post-deploy') await verifyCandidateMobileInvalidBearer();
  else await verifyNativeLogin();
  console.log(JSON.stringify({ stagingOrigin, cognitoOrigin, phase, invalidBearer: 'denied' }));
}
