import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Range Day deletion drains in-flight workspace saves first", async () => {
  const page = await readFile("src/app/range-days/page.tsx", "utf8");
  assert.match(page, /async function finishPendingRangeWorkspaceWrite\(/);
  assert.match(page, /await finishPendingRangeWorkspaceWrite\(\)/);
  assert.match(page, /remoteWorkspaceWriteInFlight = pending/);
});

test("Equipment custody write errors expose an operation stage without an automatic retry", async () => {
  const route = await readFile("src/app/api/equipment/custody/route.ts", "utf8");
  assert.match(route, /custodyWriteFailure\("checkout_asset_update", error\)/);
  assert.match(route, /custodyWriteFailure\("checkin_asset_update", error\)/);
  assert.match(route, /EQUIPMENT_CUSTODY_UNCONFIRMED/);
});
