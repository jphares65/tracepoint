import { expect, test } from "@playwright/test";

import { apiAs, createFirearm, rangeResults, seedRangeDay } from "./support/seed";
import { openRangeDayScoring, pageAs, requireRoles, saveRunButton } from "./support/fixtures";

// S29 / UX-RB-5: two instructors on two devices score the same range day.
async function seedTwoOfficerDay() {
  const manager = await apiAs("manager");
  const officer = await apiAs("officer");
  const armorer = await apiAs("armorer");
  const firearmA = await createFirearm(manager.request, officer.access.userId);
  const firearmB = await createFirearm(manager.request, armorer.access.userId);
  const day = await seedRangeDay(manager.request, {
    managerId: manager.access.userId,
    officers: [{ officerId: officer.access.userId, firearmId: firearmA }, { officerId: armorer.access.userId, firearmId: firearmB }],
    drills: [{ name: "E2E Points drill", scoringFormat: "Points", maxScore: 50, passingScore: 40 }],
  });
  return { manager, officer, armorer, day };
}

test("S29 two instructors scoring different officers: neither score is lost", async ({ browser }) => {
  requireRoles("manager", "officer", "armorer", "instructor", "instructor2");
  const { manager, officer, armorer, day } = await seedTwoOfficerDay();
  const one = await pageAs(browser, "instructor");
  const two = await pageAs(browser, "instructor2");
  await openRangeDayScoring(one, day.title, "E2E Points drill");
  await openRangeDayScoring(two, day.title, "E2E Points drill");

  await one.getByLabel(`Measurement for ${officer.access.fullName}`).fill("46");
  await saveRunButton(one).click();
  await expect.poll(async () => (await rangeResults(manager.request, day.dayId)).length, { timeout: 15_000 }).toBe(1);

  // Device two still holds the old version; its save is merged, not refused or reloaded.
  await two.getByLabel(`Measurement for ${armorer.access.fullName}`).fill("38");
  await saveRunButton(two).click();
  await expect.poll(async () => (await rangeResults(manager.request, day.dayId)).map((result: { officerId: string; score: number }) => [result.officerId, result.score]).sort(), { timeout: 30_000 })
    .toEqual([[officer.access.userId, 46], [armorer.access.userId, 38]].sort());
  await expect(two.getByText(/were made on this device and on another device/)).toHaveCount(0);
});

test("S29 the same officer scored on both devices is shown as a conflict and kept", async ({ browser }) => {
  requireRoles("manager", "officer", "armorer", "instructor", "instructor2");
  const { manager, officer, day } = await seedTwoOfficerDay();
  const one = await pageAs(browser, "instructor");
  const two = await pageAs(browser, "instructor2");
  await openRangeDayScoring(one, day.title, "E2E Points drill");
  await openRangeDayScoring(two, day.title, "E2E Points drill");

  await one.getByLabel(`Measurement for ${officer.access.fullName}`).fill("46");
  await saveRunButton(one).click();
  await expect.poll(async () => (await rangeResults(manager.request, day.dayId)).length, { timeout: 15_000 }).toBe(1);

  await two.getByLabel(`Measurement for ${officer.access.fullName}`).fill("44");
  await saveRunButton(two).click();
  const panel = two.getByRole("alert").filter({ hasText: "made on this device and on another device" });
  await expect(panel).toContainText("this device 44");
  await expect(panel).toContainText("other device 46");
  await panel.getByRole("button", { name: "Use this device's value" }).click();
  await expect.poll(async () => (await rangeResults(manager.request, day.dayId))[0]?.score, { timeout: 30_000 }).toBe(44);
});
