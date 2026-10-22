import { test as base, type Page } from "@playwright/test";

import { credentials, storageStatePath, type Role } from "./env";

/** A page signed in as `role` (session from global-setup); skips when that account is not configured. */
export async function pageAs(browser: import("@playwright/test").Browser, role: Role, testInfo = base.info()): Promise<Page> {
  if (!credentials(role)) testInfo.skip(true, `No ${role} test account configured (see e2e/README.md).`);
  const context = await browser.newContext({ ...testInfo.project.use, storageState: storageStatePath(role) });
  return context.newPage();
}

export function requireRoles(...roles: Role[]) {
  const missing = roles.filter((role) => !credentials(role));
  base.skip(missing.length > 0, `Needs test accounts for: ${missing.join(", ")} (see e2e/README.md).`);
}

export async function openRangeDayScoring(page: Page, title: string, drillName: string) {
  await page.goto("/range-days");
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  await page.getByRole("button", { name: /^Scoring/ }).first().click();
  await page.locator('label:has-text("Drill") + select').first().selectOption({ label: drillName });
}

export const saveRunButton = (page: Page) => page.getByRole("button", { name: /^Save (All - )?Run 1$/ }).first();
