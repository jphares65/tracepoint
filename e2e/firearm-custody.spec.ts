import { expect, test } from "@playwright/test";

import { apiAs, createFirearm, createStorageLocation, custody, setDutyOnly } from "./support/seed";
import { pageAs, requireRoles } from "./support/fixtures";

// S28 / UX-RB-4: the record page transfers a Duty Only firearm to secure storage
// and back to its assigned officer, by the database's own authorization (031).
test("S28 firearm record page: custody transfer in both directions, with reason and notes @field", async ({ browser }) => {
  requireRoles("manager", "officer");
  const manager = await apiAs("manager");
  const officer = await apiAs("officer");
  const firearmId = await createFirearm(manager.request, officer.access.userId);
  await setDutyOnly(manager.request, firearmId);
  const locationId = await createStorageLocation(manager.request);

  const before = await custody(officer.request, firearmId);
  expect(before.operations).toEqual({ canCheckIn: true, canCheckOut: false });

  // The assignee checks the firearm in to secure storage.
  const page = await pageAs(browser, "officer");
  await page.goto(`/firearms/${firearmId}`);
  await page.getByRole("button", { name: "Transfer to Secure Storage" }).click();
  await page.locator('label:has-text("Secure-storage location") select').selectOption(locationId);
  await page.locator('label:has-text("Reason") textarea').fill("E2E end of shift");
  await page.locator('label:has-text("Notes") textarea').fill("Locker 4");
  await page.getByRole("button", { name: "Confirm Transfer" }).click();
  await expect(page.getByText("Department secure storage")).toBeVisible();
  expect((await custody(officer.request, firearmId)).operations).toEqual({ canCheckIn: false, canCheckOut: true });

  // And returns it.
  await page.getByRole("button", { name: "Return to Assigned Officer" }).click();
  await page.locator('label:has-text("Reason") textarea').fill("E2E start of shift");
  await page.getByRole("button", { name: "Confirm Transfer" }).click();
  await expect.poll(async () => (await custody(officer.request, firearmId)).current?.holder_type).toBe("OFFICER");

  // A supervisor's view of history shows both transfers with the reasons.
  const history = await custody(manager.request, firearmId);
  expect(history.events.slice(0, 2).map((event: { notes: string }) => event.notes)).toEqual(["E2E start of shift", "E2E end of shift — Locker 4"]);
});
