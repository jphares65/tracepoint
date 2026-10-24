import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

export function totp(secret, now = Date.now()) {
  const clean = String(secret).replace(/[\s=-]/g, '').toUpperCase();
  assert.match(clean, /^[A-Z2-7]{16,64}$/);
  let bits = '';
  for (const character of clean) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Math.floor(now / 1000 / 30);
  const message = Buffer.alloc(8); message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Run a1bae9d2: the application's callback refused the Instructor's sign-in and answered, as it does for every
// refusal, with a 303 to /login?notice=authorization_rejected. That looked like a completed sign-in here, and the
// failure surfaced one request later as a 401. The callback outcome is now checked, and only non-secret facts about
// it are kept: which parameters were present (never their values), fixed error and notice codes, cookie presence by
// name, flow starts and elapsed seconds.
const callbackPath = '/api/auth/cognito/callback';
const flowCookie = '__Host-tracepoint-cognito-flow';
const oauthErrors = new Set(['access_denied', 'invalid_request', 'unauthorized_client', 'unsupported_response_type', 'invalid_scope', 'server_error', 'temporarily_unavailable']);
const loginNotices = new Set(['authorization_rejected', 'authorization_unavailable', 'session_expired', 'logout_unconfirmed']);

/** The callback request's shape: never the code, state or cookie values. */
export function describeCallbackRequest(url, cookieHeader = '') {
  const parameters = new URL(url).searchParams;
  const error = parameters.get('error');
  const cookieNames = String(cookieHeader ?? '').split(';').map(part => part.split('=')[0].trim());
  return {
    callbackHadCode: parameters.getAll('code').length === 1,
    callbackHadState: parameters.getAll('state').length === 1,
    providerError: error === null ? 'none' : oauthErrors.has(error) ? error : 'other',
    flowCookiePresent: cookieNames.filter(name => name === flowCookie).length === 1,
  };
}

/** Where the callback sent the browser: an application page, or /login with one of the application's fixed notices. */
export function classifyCallbackLanding(location, baseURL) {
  let url;
  try { url = new URL(location ?? '', baseURL); } catch { return { landing: 'other' }; }
  if (url.origin !== new URL(baseURL).origin) return { landing: 'other' };
  if (url.pathname === callbackPath) return { landing: 'callback' };
  if (url.pathname === '/login') {
    const notice = url.searchParams.get('notice');
    return { landing: 'login', loginNotice: notice === null ? 'none' : loginNotices.has(notice) ? notice : 'other' };
  }
  return { landing: 'application' };
}

export class CognitoCallbackRejectedError extends Error {
  constructor(diagnostics) {
    super('The application refused the Cognito sign-in callback.');
    this.name = 'CognitoCallbackRejectedError';
    this.acceptanceDiagnostics = diagnostics;
  }
}

/** A sign-in counts only when exactly one callback answered 303 to an application page other than /login. */
export function assertCallbackAuthenticated(observed, baseURL) {
  const landing = classifyCallbackLanding(observed.location, baseURL);
  const diagnostics = {
    callbackStatus: Number.isInteger(observed.status) ? observed.status : null,
    callbackLanding: landing.landing,
    ...(landing.loginNotice ? { loginNotice: landing.loginNotice } : {}),
    ...(observed.request ?? {}),
    callbacksSeen: observed.callbacks ?? 0,
    signInStarts: observed.starts ?? 0,
    ...(Number.isFinite(observed.seconds) ? { callbackSeconds: Math.round(observed.seconds) } : {}),
  };
  if (observed.status !== 303 || landing.landing !== 'application' || observed.callbacks !== 1) throw new CognitoCallbackRejectedError(diagnostics);
  return diagnostics;
}

export async function loginThroughCognitoPkce({ page, baseURL, email, password, knownMfaSecret, onStep = () => {} }) {
  let callbackStatus;
  const observed = { callbacks: 0, starts: 0 };
  let startedAt;
  let callbackRequestShape = Promise.resolve();
  const appOrigin = new URL(baseURL).origin;
  const isApp = (value, pathname) => { try { const url = new URL(value); return url.origin === appOrigin && url.pathname === pathname; } catch { return false; } };
  page.on('request', request => {
    if (isApp(request.url(), '/api/auth/cognito/login')) observed.starts += 1;
    if (!isApp(request.url(), callbackPath)) return;
    observed.callbacks += 1;
    if (startedAt) observed.seconds = (Date.now() - startedAt) / 1000;
    callbackRequestShape = request.allHeaders()
      .then(headers => { observed.request = describeCallbackRequest(request.url(), headers.cookie); })
      .catch(() => { observed.request = describeCallbackRequest(request.url()); });
  });
  page.on('response', response => {
    if (!isApp(response.url(), callbackPath)) return;
    callbackStatus = response.status();
    observed.status = callbackStatus;
    observed.location = response.headers().location;
  });
  const authenticated = async () => {
    onStep('verify-pkce-callback-outcome');
    await callbackRequestShape;
    assertCallbackAuthenticated(observed, baseURL);
  };
  onStep('open-login-page');
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  onStep('start-cognito-sign-in');
  startedAt = Date.now();
  await page.getByRole('button', { name: /continue with secure sign-in/i }).click();
  onStep('wait-for-cognito-redirect');
  await page.waitForURL(url => url.hostname.endsWith('amazoncognito.com'), { timeout: 30_000 });
  onStep('fill-cognito-username');
  const username = page.locator('input[autocomplete="username"],input[name="username"],input[name="email"],input[type="email"]').first();
  await username.waitFor({ state: 'visible', timeout: 30_000 });
  await username.fill(email);
  const pass = page.locator('input[autocomplete="current-password"],input[name="password"],input[type="password"]').first();
  if (await pass.isVisible().catch(() => false)) await pass.fill(password);
  onStep('submit-cognito-credentials');
  await submit(page);
  let secret = knownMfaSecret ?? null;
  let totpSubmissions = 0;
  for (let step = 0; step < 5; step += 1) {
    onStep(`cognito-login-loop-${step + 1}`);
    const currentUrl = new URL(page.url());
    if (callbackStatus === 303 && currentUrl.origin === new URL(baseURL).origin && currentUrl.pathname !== '/api/auth/cognito/callback') { await authenticated(); return secret; }
    if (new URL(page.url()).origin === new URL(baseURL).origin && new URL(page.url()).pathname === '/api/auth/cognito/callback') {
      onStep('complete-pkce-callback');
      await page.waitForURL(url => url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/api/auth/cognito/callback'), { timeout: 30_000 });
      await authenticated();
      return secret;
    }
    if (await pass.isVisible().catch(() => false) && (await pass.inputValue().catch(() => '')) === '') {
      await pass.fill(password);
      await submit(page);
      continue;
    }
    const text = await page.locator('body').innerText().catch(() => '');
    if (/select.*mfa|choose.*mfa|verification method/i.test(text)) {
      onStep('select-cognito-mfa-factor');
      const factor = page.getByRole('button', { name: /authenticator app|software token|time-based one-time password/i }).first();
      await factor.waitFor({ state: 'visible', timeout: 15_000 });
      await factor.click();
      await submit(page);
      continue;
    }
    if (/software token|authenticator app|setup.*mfa|set up.*authenticator/i.test(text)) {
      onStep('configure-cognito-totp');
      let setupSecret = extractTotpSecret(text);
      let qrDiagnostics = null;
      if (!setupSecret) {
        const qrResult = await extractTotpSecretFromQr(page);
        setupSecret = qrResult.secret;
        qrDiagnostics = qrResult.diagnostics;
      }
      if (setupSecret) secret = setupSecret;
      if (!secret) {
        const manualSetup = page.getByText(/can't scan|enter.*manually|manual setup/i).first();
        const manualSetupVisible = await manualSetup.isVisible().catch(() => false);
        if (manualSetupVisible) {
          onStep('reveal-cognito-totp-manual-key');
          await manualSetup.click();
          continue;
        }
        if (qrDiagnostics) throw Object.assign(new Error('Cognito TOTP enrollment QR could not be read.'), { acceptanceDiagnostics: { ...qrDiagnostics, manualSetupVisible } });
      }
      if (!secret) throw new Error('Cognito software-token MFA setup did not expose an authenticator secret.');
    }
    if (/verification code|authenticator|one.time password|software token/i.test(text)) {
      onStep('wait-for-totp-input');
      if (!secret) throw new Error('Cognito requested MFA without an enrolled software-token secret.');
      const codeInput = page.locator('input[autocomplete="one-time-code"],input[name*="code" i],input[type="tel"],input[inputmode="numeric"]').first();
      await codeInput.waitFor({ state: 'visible', timeout: 15_000 });
      onStep('fill-totp-code');
      await codeInput.fill(totp(secret));
      totpSubmissions += 1;
      const beforeUrl = page.url();
      const beforeBody = await page.locator('body').innerText().catch(() => '');
      onStep('submit-totp-code');
      await submit(page);
      onStep('wait-for-totp-response');
      await page.waitForFunction(({ previousUrl, previousBody }) =>
        location.href !== previousUrl || document.body?.innerText !== previousBody,
      { previousUrl: beforeUrl, previousBody: beforeBody }, { timeout: 15_000 });
      const responseText = await page.locator('body').innerText().catch(() => '');
      if (/invalid|incorrect|try again/i.test(responseText)) onStep('totp-code-rejected');
      continue;
    }
    if (/configure.*authenticator|scan.*qr|can't scan/i.test(text)) {
      onStep('complete-cognito-totp-setup');
      if (!secret) throw new Error('Cognito MFA setup is required but no software-token secret was found.');
      continue;
    }
    if (step === 0 && await pass.isVisible().catch(() => false)) {
      await pass.fill(password); await submit(page); continue;
    }
    await page.waitForTimeout(300);
  }
  onStep('cognito-login-loop-exhausted');
  if (!secret) throw new Error('Cognito PKCE/MFA login did not complete.');
  try {
    await page.waitForURL(url => url.origin === new URL(baseURL).origin && url.pathname === '/', { timeout: 30_000 });
  } catch (error) {
    const text = await page.locator('body').innerText().catch(() => '');
    const otpInput = page.locator('input[autocomplete="one-time-code"],input[name*="code" i],input[type="tel"],input[inputmode="numeric"]').first();
    const passwordInput = page.locator('input[autocomplete="current-password"],input[name="password"],input[type="password"]').first();
    const current = new URL(page.url());
    const application = new URL(baseURL);
    error.acceptanceDiagnostics = {
      onCognitoHost: current.hostname.endsWith('amazoncognito.com'),
      callbackReached: current.origin === new URL(baseURL).origin && current.pathname === '/api/auth/cognito/callback',
      hostClass: current.hostname === application.hostname ? 'application' : current.hostname.endsWith('amazoncognito.com') ? 'cognito' : 'other',
      pathClass: current.pathname === '/login' ? 'login' : current.pathname === '/' ? 'home' : current.pathname === '/api/auth/cognito/callback' ? 'callback' : 'other',
      mfaPromptVisible: /verification code|authenticator|one.time password|software token/i.test(text),
      otpInputVisible: await otpInput.isVisible().catch(() => false),
      passwordInputVisible: await passwordInput.isVisible().catch(() => false),
      invalidCodeNotice: /invalid (?:verification )?code|incorrect (?:verification )?code/i.test(text),
      expiredCodeNotice: /code (?:has )?expired|expired code/i.test(text),
      retryNotice: /try again|please retry/i.test(text),
      genericRequestError: /invalid request|unable to process|something went wrong/i.test(text),
      totpSubmissions,
      callbackStatus: Number.isInteger(callbackStatus) ? callbackStatus : null,
    };
    throw error;
  }
  await authenticated();
  return secret;
}

export function extractTotpSecret(text) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/secret|manual setup|setup key/i.test(lines[index])) continue;
    for (const candidate of lines.slice(index, index + 13)) {
      const value = candidate.toUpperCase().trim();
      if (/^[A-Z2-7]{16,64}$/.test(value)) return value;
      if (!/^[A-Z2-7]{4,8}(?:[\s-]+[A-Z2-7]{4,8}){3,15}$/.test(value)) continue;
      const normalized = value.replace(/[\s-]/g, '');
      if (/^[A-Z2-7]{16,64}$/.test(normalized)) return normalized;
    }
  }
  return null;
}

export function extractTotpSecretFromQrPayload(payload) {
  if (!String(payload).startsWith('otpauth://totp/')) return null;
  try {
    const secret = new URL(payload).searchParams.get('secret')?.replace(/[\s=-]/g, '').toUpperCase();
    return /^[A-Z2-7]{16,64}$/.test(secret ?? '') ? secret : null;
  } catch {
    return null;
  }
}

async function extractTotpSecretFromQr(page) {
  const diagnostics = { barcodeDetectorAvailable: false, imageCount: 0, canvasCount: 0, qrDecoded: false, totpPayloadFound: false };
  const images = page.locator('img:visible');
  diagnostics.imageCount = await images.count().catch(() => 0);
  diagnostics.canvasCount = await page.locator('canvas:visible').count().catch(() => 0);
  for (let index = 0; index < diagnostics.imageCount; index += 1) {
    try {
      const screenshot = await images.nth(index).screenshot({ animations: 'disabled', timeout: 5_000 });
      const secret = extractTotpSecretFromQrImage(screenshot);
      if (!secret) continue;
      diagnostics.qrDecoded = true;
      diagnostics.totpPayloadFound = true;
      if (secret) return { secret, diagnostics };
    } catch { /* Ignore image elements that are not readable QR codes. */ }
  }
  return { secret: null, diagnostics };
}

export function extractTotpSecretFromQrImage(imageBuffer) {
  try {
    const png = PNG.sync.read(imageBuffer);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, { inversionAttempts: 'attemptBoth' });
    return decoded?.data ? extractTotpSecretFromQrPayload(decoded.data) : null;
  } catch {
    return null;
  }
}

async function submit(page) {
  const button = page.getByRole('button', { name: /sign in|continue|verify|confirm|submit|next/i }).last();
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
}
