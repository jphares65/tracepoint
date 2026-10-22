import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { totp } from "../../src/lib/testing/totp";
import { baseUrl, credentials, syntheticAgency, type Role } from "./env";

/**
 * Signs in through the real Cognito managed login (password and TOTP MFA), the
 * same path a person uses. Nothing in the application is bypassed.
 */
export async function signIn(page: Page, role: Role) {
  const account = credentials(role);
  if (!account) throw new Error(`No credentials for the ${role} test account.`);

  await page.goto(`${baseUrl()}/login`);
  await page.getByRole("button", { name: /continue with secure sign-in/i }).click();

  await page.locator('input[name="username"]:visible').fill(account.email);
  await page.locator('input[name="password"]:visible').fill(account.password);
  await page.locator('input[type="submit"]:visible, button[type="submit"]:visible').first().click();

  // MFA. Wait for a fresh 30-second window if the current one is about to end.
  const code = page.locator('input[name="totpCode"]:visible, input[name="mfaCode"]:visible, input[autocomplete="one-time-code"]:visible, input[inputmode="numeric"]:visible').first();
  await code.waitFor({ timeout: 20_000 });
  const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (secondsLeft < 5) await page.waitForTimeout(secondsLeft * 1000 + 500);
  await code.fill(totp(account.totpSecret));
  await page.locator('input[type="submit"]:visible, button[type="submit"]:visible').first().click();

  await page.waitForURL((url) => url.origin === new URL(baseUrl()).origin && !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await assertSyntheticAgency(page.request);
}

/** Aborts unless the signed-in user is in the synthetic staging agency and not in support mode. */
export async function assertSyntheticAgency(request: APIRequestContext) {
  const agency = syntheticAgency();
  const response = await request.get(`${baseUrl()}/api/access`);
  expect(response.ok(), "the signed-in session must resolve").toBeTruthy();
  const { access } = await response.json();
  if (access.departmentId !== agency.departmentId || access.departmentName !== agency.name || access.isSupportMode) {
    throw new Error(`Refusing to continue: signed in to "${access.departmentName}" (${access.departmentId}), not the synthetic agency.`);
  }
  return access as { userId: string; fullName: string; permissions: string[] };
}
