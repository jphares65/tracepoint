import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("notification aggregation does not fetch the manager-only ammunition ledger for Officers", () => {
  // The generator moved out of the route in B6 so the scheduled run can share it.
  const notifications = readFileSync("src/lib/notifications/user-notification-generator.ts", "utf8");
  const ammunition = readFileSync("src/app/api/pilot/ammunition/route.ts", "utf8");

  assert.match(ammunition, /hasAnyServerPermission\(context, \["manage_firearms"\]\)/);
  assert.match(notifications, /canViewAmmunition = hasAnyServerPermission\(accessContext, \["manage_firearms"\]\)/);
  assert.match(notifications, /context\.canViewAmmunition\s*\? readSource\("\/api\/pilot\/ammunition"\)\s*: Promise\.resolve\(null\)/);
  assert.match(notifications, /if \(ammunition === null\) \{ successful\.add\("Ammunition"\); \}/);
  assert.match(notifications, /else if \(ammunition\.ok\).*collectAmmunition\(ammunition\.payload\)/);
  assert.match(notifications, /else sourceErrors\.push\(\{ source: "Ammunition"/);
});
