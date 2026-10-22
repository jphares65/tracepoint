import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The UX-RB client replaced the staging autosave queue: a drill removal can no
// longer race an in-flight save because the removal carries this device's
// version (the route refuses an older copy) and every snapshot taken before
// the removal belongs to an earlier epoch, so it is never sent.
test("Range Day drill removal cannot race in-flight workspace saves", async () => {
  const page = await readFile("src/app/range-days/page.tsx", "utf8");
  assert.match(page, /body: JSON\.stringify\(\{ rangeDayId: selectedRangeDay\.id, drillId: drill\.id, baseUpdatedAt: rangeWorkspaceBaseUpdatedAt \?\? null \}\)/);
  assert.match(page, /snapshotEpochs\.current\.get\(workspace\) !== rangeWorkspaceEpoch/);
  assert.match(page, /if \(payload\.removedRangeDayDrillId !== drill\.id\)/);
});

test("Equipment custody write errors expose an operation stage without an automatic retry", async () => {
  const route = await readFile("src/app/api/equipment/custody/route.ts", "utf8");
  assert.match(route, /custodyWriteFailure\("checkout_asset_update", error\)/);
  assert.match(route, /custodyWriteFailure\("checkin_asset_update", error\)/);
  assert.match(route, /EQUIPMENT_CUSTODY_UNCONFIRMED/);
});
