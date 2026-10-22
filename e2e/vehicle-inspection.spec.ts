import { expect, test } from "@playwright/test";

import { apiAs, createVehicle, getFleetRules, putFleetRules, vehicle } from "./support/seed";
import { pageAs, requireRoles } from "./support/fixtures";

// S27 / UX-RB-2 + UX-RB-3: vehicle checks start Not inspected, and a critical
// defect is reported as Out of Service even when no work order is created.
test("S27 vehicle inspection: no Pass defaults; critical defect reports Out of Service @field", async ({ browser }) => {
  requireRoles("fleetManager", "officer");
  const manager = await apiAs("fleetManager");
  const rules = await getFleetRules(manager.request);
  await putFleetRules(manager.request, { ...rules, inspection_defect_creates_work_order: false });
  try {
    const unit = await createVehicle(manager.request);
    const page = await pageAs(browser, "officer");
    await page.goto(`/fleet-management/${unit.id}?tab=inspections`);
    await page.getByRole("button", { name: /Quick Inspect/ }).first().click();
    await page.getByRole("button", { name: "Start Inspection" }).click();

    const submit = page.getByRole("button", { name: "Submit Inspection" });
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/items are not inspected/)).toBeVisible();

    const brakes = page.getByRole("group", { name: "Brakes, steering and controls" });
    await brakes.getByRole("button", { name: "Critical" }).click();
    await page.getByPlaceholder("Brief defect note (required)").fill("E2E brake failure");
    await page.getByRole("button", { name: /Mark remaining \d+ as Pass/ }).click();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByRole("alert")).toContainText("This vehicle is Out of Service. Do not use it.");
    await expect(page.getByText("Vehicle remains ready")).toHaveCount(0);
    expect((await vehicle(manager.request, unit.id)).vehicle.status).toBe("Out of Service");
  } finally {
    await putFleetRules(manager.request, rules);
  }
});
