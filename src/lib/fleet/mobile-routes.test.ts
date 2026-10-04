import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mobile fleet and equipment routes delegate to the existing scoped workflow handlers", async () => {
  for (const [path, handler] of [["fleet/vehicles/route.ts", "fleet/vehicles/route"], ["fleet/vehicles/[vehicleId]/route.ts", "fleet/vehicles/[vehicleId]/route"], ["fleet/vehicles/[vehicleId]/inspections/route.ts", "fleet/vehicles/[vehicleId]/inspections/route"], ["fleet/vehicles/[vehicleId]/inspections/[inspectionId]/evidence/route.ts", "fleet/vehicles/[vehicleId]/inspections/[inspectionId]/evidence/route"], ["equipment/assets/route.ts", "equipment/assets/route"], ["equipment/custody/route.ts", "equipment/custody/route"], ["readiness/equipment/route.ts", "readiness/equipment/route"]]) {
    const source = await readFile(`src/app/api/mobile/${path}`, "utf8");
    assert.ok(source.includes(`@/app/api/${handler}`));
  }
});

test("inspection detail returns mobile bearer-compatible evidence URLs", async () => {
  const source = await readFile("src/app/api/fleet/vehicles/[vehicleId]/route.ts", "utf8");
  assert.match(source, /attachmentBase = mobile \? "\/api\/mobile\/attachments" : "\/api\/attachments"/);
});
