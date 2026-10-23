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

export async function loginThroughCognitoPkce({ page, baseURL, email, password, knownMfaSecret, onStep = () => {} }) {
  let callbackStatus;
  let currentStep = 'start';
  let totpSubmissions = 0;
  const setStep = name => { currentStep = name; onStep(name); };
  page.on('response', response => {
    try {
      const url = new URL(response.url());
      if (url.origin === new URL(baseURL).origin && url.pathname === '/api/auth/cognito/callback') callbackStatus = response.status();
    } catch { /* Ignore non-URL response metadata. */ }
  });
  try {
  setStep('open-login-page');
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  setStep('start-cognito-sign-in');
  await page.getByRole('button', { name: /continue with secure sign-in/i }).click();
  setStep('wait-for-cognito-redirect');
  await page.waitForURL(url => url.hostname.endsWith('amazoncognito.com'), { timeout: 30_000 });
  setStep('fill-cognito-username');
  const username = page.locator('input[autocomplete="username"],input[name="username"],input[name="email"],input[type="email"]').first();
  await username.waitFor({ state: 'visible', timeout: 30_000 });
  await username.fill(email);
  const pass = page.locator('input[autocomplete="current-password"],input[name="password"],input[type="password"]').first();
  if (await pass.isVisible().catch(() => false)) await pass.fill(password);
  setStep('submit-cognito-credentials');
  await submit(page);
  let secret = knownMfaSecret ?? null;
  for (let step = 0; step < 5; step += 1) {
    const loopStep = `cognito-login-loop-${step + 1}`;
    currentStep = loopStep;
    onStep(loopStep);
    const currentUrl = new URL(page.url());
    if (callbackStatus === 303 && currentUrl.origin === new URL(baseURL).origin && currentUrl.pathname !== '/api/auth/cognito/callback') return secret;
    if (new URL(page.url()).origin === new URL(baseURL).origin && new URL(page.url()).pathname === '/api/auth/cognito/callback') {
      setStep('complete-pkce-callback');
      await page.waitForURL(url => url.origin === new URL(baseURL).origin && !url.pathname.startsWith('/api/auth/cognito/callback'), { timeout: 30_000 });
      return secret;
    }
    if (await pass.isVisible().catch(() => false) && (await pass.inputValue().catch(() => '')) === '') {
      await pass.fill(password);
      await submit(page);
      continue;
    }
    const text = await page.locator('body').innerText().catch(() => '');
    if (/select.*mfa|choose.*mfa|verification method/i.test(text)) {
      setStep('select-cognito-mfa-factor');
      const factor = page.getByRole('button', { name: /authenticator app|software token|time-based one-time password/i }).first();
      await factor.waitFor({ state: 'visible', timeout: 15_000 });
      await factor.click();
      await submit(page);
      continue;
    }
    if (/software token|authenticator app|setup.*mfa|set up.*authenticator/i.test(text)) {
      setStep('configure-cognito-totp');
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
          setStep('reveal-cognito-totp-manual-key');
          await manualSetup.click();
          continue;
        }
        if (qrDiagnostics) throw Object.assign(new Error('Cognito TOTP enrollment QR could not be read.'), { acceptanceDiagnostics: { ...qrDiagnostics, manualSetupVisible } });
      }
      if (!secret) throw new Error('Cognito software-token MFA setup did not expose an authenticator secret.');
    }
    if (/verification code|authenticator|one.time password|software token/i.test(text)) {
      setStep('wait-for-totp-input');
      if (!secret) throw new Error('Cognito requested MFA without an enrolled software-token secret.');
      const codeInput = page.locator('input[autocomplete="one-time-code"],input[name*="code" i],input[type="tel"],input[inputmode="numeric"]').first();
      await codeInput.waitFor({ state: 'visible', timeout: 15_000 });
      setStep('fill-totp-code');
      await codeInput.fill(totp(secret));
      totpSubmissions += 1;
      const beforeUrl = page.url();
      const beforeBody = await page.locator('body').innerText().catch(() => '');
      setStep('submit-totp-code');
      await submit(page);
      setStep('wait-for-totp-response');
      await page.waitForFunction(({ previousUrl, previousBody }) =>
        location.href !== previousUrl || document.body?.innerText !== previousBody,
      { previousUrl: beforeUrl, previousBody: beforeBody }, { timeout: 15_000 });
      const responseText = await page.locator('body').innerText().catch(() => '');
      if (/invalid|incorrect|try again/i.test(responseText)) onStep('totp-code-rejected');
      continue;
    }
    if (/configure.*authenticator|scan.*qr|can't scan/i.test(text)) {
      setStep('complete-cognito-totp-setup');
      if (!secret) throw new Error('Cognito MFA setup is required but no software-token secret was found.');
      continue;
    }
    if (step === 0 && await pass.isVisible().catch(() => false)) {
      await pass.fill(password); await submit(page); continue;
    }
    await page.waitForTimeout(300);
  }
  setStep('cognito-login-loop-exhausted');
  if (!secret) throw new Error('Cognito PKCE/MFA login did not complete.');
  await page.waitForURL(url => url.origin === new URL(baseURL).origin && url.pathname === '/', { timeout: 30_000 });
  return secret;
  } catch (error) {
    if (error && typeof error === 'object') {
      try {
        error.acceptanceDiagnostics = {
          ...(error.acceptanceDiagnostics && typeof error.acceptanceDiagnostics === 'object' ? error.acceptanceDiagnostics : {}),
          ...await captureCognitoLoginDiagnostics(page, baseURL, { step: currentStep, callbackStatus, totpSubmissions }),
        };
      } catch {
        error.acceptanceDiagnostics = { step: safeLoginStep(currentStep), callbackStatus: Number.isInteger(callbackStatus) ? callbackStatus : null, totpSubmissions };
      }
    }
    throw error;
  }
}

/** Captures only enumerated browser state; never returns URL values, page text, selectors or credentials. */
export async function captureCognitoLoginDiagnostics(page, baseURL, { step: currentStep, callbackStatus, totpSubmissions = 0 } = {}) {
  let current;
  let application;
  try { current = new URL(page.url()); application = new URL(baseURL); }
  catch { return { step: safeLoginStep(currentStep), hostClass: 'unknown', pathClass: 'unknown', callbackStatus: Number.isInteger(callbackStatus) ? callbackStatus : null, totpSubmissions }; }
  const text = await page.locator('body').innerText().catch(() => '');
  const otpInput = page.locator('input[autocomplete="one-time-code"],input[name*="code" i],input[type="tel"],input[inputmode="numeric"]').first();
  const passwordInput = page.locator('input[autocomplete="current-password"],input[name="password"],input[type="password"]').first();
  return {
    step: safeLoginStep(currentStep),
    onCognitoHost: current.hostname.endsWith('amazoncognito.com'),
    callbackReached: current.origin === application.origin && current.pathname === '/api/auth/cognito/callback',
    hostClass: current.hostname === application.hostname ? 'application' : current.hostname.endsWith('amazoncognito.com') ? 'cognito' : 'other',
    pathClass: current.pathname === '/login' ? 'login' : current.pathname === '/' ? 'home' : current.pathname === '/api/auth/cognito/callback' ? 'callback' : 'other',
    mfaPromptVisible: /verification code|authenticator|one.time password|software token/i.test(text),
    otpInputVisible: await otpInput.isVisible().catch(() => false),
    passwordInputVisible: await passwordInput.isVisible().catch(() => false),
    invalidCodeNotice: /invalid (?:verification )?code|incorrect (?:verification )?code/i.test(text),
    expiredCodeNotice: /code (?:has )?expired|expired code/i.test(text),
    retryNotice: /try again|please retry/i.test(text),
    genericRequestError: /invalid request|unable to process|something went wrong/i.test(text),
    totpSubmissions: Number.isInteger(totpSubmissions) ? totpSubmissions : 0,
    callbackStatus: Number.isInteger(callbackStatus) ? callbackStatus : null,
  };
}

function safeLoginStep(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value) ? value : 'unknown';
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
