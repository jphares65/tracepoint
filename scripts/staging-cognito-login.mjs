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
  onStep('open-login-page');
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
  onStep('start-cognito-sign-in');
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
  for (let step = 0; step < 5; step += 1) {
    onStep(`cognito-login-loop-${step + 1}`);
    if (new URL(page.url()).origin === new URL(baseURL).origin && new URL(page.url()).pathname === '/api/auth/cognito/callback') {
      onStep('complete-pkce-callback');
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
  await page.waitForURL(url => url.origin === new URL(baseURL).origin && url.pathname === '/', { timeout: 30_000 });
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
