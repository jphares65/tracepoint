import { expect, test } from "@playwright/test";

import { apiAs, createFirearm, firearmStatus, recordInspection } from "./support/seed";
import { pageAs, requireRoles } from "./support/fixtures";

// S26 / UX-RB-2: a firearm that failed inspection cannot be returned to service
// by an untouched form; the inspector answers every item and chooses the result.
test("S26 firearm inspection starts unanswered and cannot be saved untouched @field", async ({ browser }) => {
  requireRoles("armorer");
  const armorer = await apiAs("armorer");
  const firearmId = await createFirearm(armorer.request);
  await recordInspection(armorer.request, firearmId, "Failed");
  expect(await firearmStatus(armorer.request, firearmId)).toBe("Inspection Required");

  const page = await pageAs(browser, "armorer");
  await page.goto(`/firearms/inspections/new?firearmId=${firearmId}`);
  const save = page.getByRole("button", { name: "Save Inspection" });
  await expect(save).toBeDisabled();
  await expect(page.getByRole("list", { name: "Before saving" })).toContainText("not inspected");
  await expect(page.getByRole("group", { name: "Safe for duty use" }).getByText("Not inspected")).toBeVisible();
  expect(await firearmStatus(armorer.request, firearmId)).toBe("Inspection Required");

  // Conscious completion: weapon cleared, ammo removed, mark remaining, choose Failed.
  await page.locator('label:has-text("Weapon Cleared") select').selectOption("Yes");
  await page.locator('label:has-text("Ammunition Removed") select').selectOption("Yes");
  await page.getByRole("button", { name: /Mark remaining \d+ as Pass/ }).click();
  await page.getByRole("group", { name: "Safe for duty use" }).getByRole("button", { name: "Fail" }).click();
  await page.locator('label:has-text("Overall Result") select').selectOption("Failed");
  await expect(page.getByText("Saving a Failed result sets this firearm to Inspection Required.")).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => firearmStatus(armorer.request, firearmId)).toBe("Inspection Required");
});
