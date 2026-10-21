import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canPerformFleetInspection, canReadFleet, canUseVehicleInspectionQr } from "./fleet-access.ts";

test("Fleet reads require both an enabled agency module and a Fleet permission", () => {
  assert.equal(canReadFleet({ permissions: ["view_fleet"], enabledFeatures: ["fleet"] }), true);
  assert.equal(canReadFleet({ permissions: ["perform_fleet_inspections"], enabledFeatures: ["fleet"] }), true);
  assert.equal(canReadFleet({ permissions: ["view_fleet"], enabledFeatures: [] }), false);
  assert.equal(canReadFleet({ permissions: [], enabledFeatures: ["fleet"] }), false);
  assert.equal(canReadFleet({ permissions: ["administer_department"], enabledFeatures: [] }), false);
});

test("vehicle inspection writes require Fleet enablement and an inspection grant or configured role", () => {
  const inspectionOfficer = {
    permissions: ["perform_fleet_inspections"],
    enabledFeatures: ["fleet"],
    roleCodes: ["officer"],
  };
  assert.equal(canPerformFleetInspection(inspectionOfficer, []), true);
  assert.equal(canPerformFleetInspection({ ...inspectionOfficer, permissions: ["view_fleet"] }, []), false);
  assert.equal(canPerformFleetInspection({ ...inspectionOfficer, permissions: [] }, []), false);
  assert.equal(canPerformFleetInspection({ ...inspectionOfficer, enabledFeatures: [] }, []), false);
  assert.equal(canPerformFleetInspection({ ...inspectionOfficer, permissions: ["administer_department"], enabledFeatures: [] }, []), false);
  assert.equal(canPerformFleetInspection({ ...inspectionOfficer, permissions: [] }, ["officer"]), true);
  assert.equal(canPerformFleetInspection({ ...inspectionOfficer, permissions: [], roleCodes: ["officer"] }, ["chief"]), false);
});

test("vehicle QR preserves agency-configured inspection roles without bypassing Fleet enablement", () => {
  const access = { permissions: [], enabledFeatures: ["fleet"], roleCodes: ["field_officer"] };
  assert.equal(canUseVehicleInspectionQr(access, ["field_officer"]), true);
  assert.equal(canUseVehicleInspectionQr(access, ["inspector"]), false);
  assert.equal(canUseVehicleInspectionQr({ ...access, enabledFeatures: [] }, ["field_officer"]), false);
});

test("Fleet list, detail, and inspection routes enforce the policy on the backend", async () => {
  const [list, detail, inspection, evidence, qr] = await Promise.all([
    readFile(new URL("../../app/api/fleet/vehicles/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/fleet/vehicles/[vehicleId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/fleet/vehicles/[vehicleId]/inspections/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/fleet/vehicles/[vehicleId]/inspections/[inspectionId]/evidence/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/mobile/qr/resolve/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(list, /hasServerFeature\(resolved, "fleet"\)/);
  assert.match(list, /canReadFleet\(resolved\)/);
  assert.match(detail, /hasServerFeature\(context, "fleet"\)/);
  assert.match(detail, /canReadFleet\(context\)/);
  assert.match(inspection, /hasServerFeature\(context, "fleet"\)/);
  // One inspection rule, mirrored by can_submit_fleet_inspection (migration 055).
  assert.match(inspection, /canSubmitFleetInspection\(context, rules\)/);
  assert.match(inspection, /if \(rulesError\)/);
  assert.match(evidence, /hasServerFeature\(context, "fleet"\)/);
  assert.match(qr, /resolveServerAccess\(request\)/);
  assert.match(qr, /from\("fleet_rules"\)[\s\S]*?inspection_role_codes/);
  assert.match(qr, /vehicleInspectionEligible = canSubmitFleetInspection\(resolved\.context, rules\.data\)/);
});
