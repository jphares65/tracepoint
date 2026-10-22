import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// UX-RB2-4 (D-60, D-15). The server side is already covered: FLT-01 in
// src/lib/fleet/fleet-integrity.test.ts shows a manual Available on a held vehicle
// is stored as Out of Service. These checks pin the page to that rule.
test("UX-RB2-4: the vehicle page shows the hold in its header and offers no status the hold refuses", async () => {
  const page = await readFile(new URL("./[vehicleId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const held = Boolean\(data\?\.safetyHold\) \|\| blockingOrders\.length > 0;/);
  assert.match(page, /\{held \? <span [^>]*>\{data\.safetyHold \? "Critical safety hold" : "Open critical work"\}<\/span> : null\}/);
  assert.match(page, /disabled=\{saving \|\| status === v\.status \|\| statusBlockedByHold\(held, status\)\}/);
});

test("UX-RB2-4 (D-15): the fleet list reports the status the server applied", async () => {
  const list = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(list, /setMessage\(`Unit \$\{vehicle\.unit_number\} status updated and audited\.`\)/);
  assert.match(list, /statusChangeMessage\(vehicle\.unit_number, status, payload\.item\?\.status\)/);
});
