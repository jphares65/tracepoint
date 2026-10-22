import { expect, test } from "@playwright/test";

import { ROLES } from "./support/env";
import { apiAs } from "./support/seed";
import { pageAs } from "./support/fixtures";

// Every configured synthetic account signs in through Cognito (password + TOTP)
// and resolves to the synthetic agency; authorization is the real one.
for (const role of ROLES) {
  test(`${role} signs in to the synthetic agency @field`, async ({ browser }) => {
    const page = await pageAs(browser, role);
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    const { access } = await apiAs(role);
    expect(access.userId).toBeTruthy();
  });
}
