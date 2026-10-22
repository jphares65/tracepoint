import { expect, test } from "@playwright/test";

import { apiAs, createFirearm, rangeResults, seedRangeDay } from "./support/seed";
import { openRangeDayScoring, pageAs, requireRoles, saveRunButton } from "./support/fixtures";

// S25 / UX-RB-1: an untouched Completion row is Not recorded and cannot be saved
// as anything; an explicit Complete is saved as complete with no deficiency.
test("S25 Completion drill: explicit choice required, display equals saved record @field", async ({ browser }) => {
  requireRoles("manager", "instructor", "officer");
  const manager = await apiAs("manager");
  const officer = await apiAs("officer");
  const firearmId = await createFirearm(manager.request, officer.access.userId);
  const day = await seedRangeDay(manager.request, {
    managerId: manager.access.userId,
    officers: [{ officerId: officer.access.userId, firearmId }],
    drills: [{ name: "E2E Completion drill", scoringFormat: "Completion" }],
  });

  const page = await pageAs(browser, "instructor");
  await openRangeDayScoring(page, day.title, "E2E Completion drill");
  const control = page.getByRole("group", { name: `Completion for ${officer.access.fullName}` });
  await expect(control.getByRole("button", { name: "Complete" })).toHaveAttribute("aria-pressed", "false");
  await expect(control.getByRole("button", { name: "Incomplete" })).toHaveAttribute("aria-pressed", "false");
  await expect(control.getByText("Not recorded")).toBeVisible();

  // A note alone is not a completion.
  await page.getByPlaceholder(/note/i).first().fill("E2E note only");
  await saveRunButton(page).click();
  await expect(page.getByText(/Choose Complete or Incomplete before saving results for/)).toBeVisible();
  expect(await rangeResults(manager.request, day.dayId)).toEqual([]);

  await control.getByRole("button", { name: "Complete" }).click();
  await expect(control.getByRole("button", { name: "Complete" })).toHaveAttribute("aria-pressed", "true");
  await saveRunButton(page).click();
  await expect.poll(async () => (await rangeResults(manager.request, day.dayId)).length, { timeout: 15_000 }).toBe(1);
  const [result] = await rangeResults(manager.request, day.dayId);
  expect(result).toMatchObject({ completed: true, passed: true, deficiencyObserved: false, remedialTrainingRecommended: false });
});
