import { expect, test } from "@playwright/test";

import { apiAs, createFirearm, rangeResults, seedRangeDay } from "./support/seed";
import { openRangeDayScoring, pageAs, requireRoles, saveRunButton } from "./support/fixtures";

// S30 / UX-RB-6: an impossible score is stopped on the officer's row and named.
test("S30 an impossible score is blocked on the officer's row @field", async ({ browser }) => {
  requireRoles("manager", "officer", "instructor");
  const manager = await apiAs("manager");
  const officer = await apiAs("officer");
  const firearmId = await createFirearm(manager.request, officer.access.userId);
  const day = await seedRangeDay(manager.request, {
    managerId: manager.access.userId,
    officers: [{ officerId: officer.access.userId, firearmId }],
    drills: [{ name: "E2E Max 50", scoringFormat: "Points", maxScore: 50, passingScore: 40 }],
  });
  const page = await pageAs(browser, "instructor");
  await openRangeDayScoring(page, day.title, "E2E Max 50");
  const input = page.getByLabel(`Measurement for ${officer.access.fullName}`);
  await input.fill("55");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await saveRunButton(page).click();
  await expect(page.getByText(`${officer.access.fullName}: Score 55 for E2E Max 50 is above the maximum of 50.`).first()).toBeVisible();
  expect(await rangeResults(manager.request, day.dayId)).toEqual([]);

  await input.fill("48");
  await saveRunButton(page).click();
  await expect.poll(async () => (await rangeResults(manager.request, day.dayId))[0]?.score, { timeout: 15_000 }).toBe(48);
});
