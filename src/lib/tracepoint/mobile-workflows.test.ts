import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { effectiveDepartmentPermissions } from "./permission-authority.ts";
import { qrDecision, rangeDayDetailPayload, rangeDayPayload } from "./mobile-workflows.ts";

const access = { permissions: ["score_range_days", "perform_fleet_inspections"] as never[], enabledFeatures: ["fleet", "equipment_readiness"] };
test("mobile range days separate and preserve ordered drills with document availability", () => {
  const workspace = { rangeDays: [{ id: "today", title: "Today", date: "2026-10-06", status: "Planned" }], rangeDayDrills: [{ id: "two", rangeDayId: "today", name: "Two", sortOrder: 2, sourceTemplateId: "template" }, { id: "one", rangeDayId: "today", name: "One", sortOrder: 1 }], rangeRoster: [{ id: "r", rangeDayId: "today", officerId: "officer", attended: true }] };
  assert.equal(rangeDayPayload(workspace)[0].id, "today");
  const detail = rangeDayDetailPayload(workspace, "today", new Map([["template", ["document"]]]));
  assert.deepEqual(detail?.drills.map((drill) => drill.id), ["one", "two"]);
  assert.equal(detail?.drills[1].documentId, "document");
});
test("QR decisions do not disclose an unauthorized firearm", () => {
  assert.deepEqual(qrDecision({ identifier: "qr", access, vehicle: { id: "v", unit_number: "12" } }), { entityType: "vehicle", entityId: "v", displayName: "Unit 12", workflow: "vehicle_inspection", allowed: true });
  assert.equal(qrDecision({ identifier: "qr", access: { permissions: [], enabledFeatures: ["firearms"] }, firearm: { id: "f" } }).status, "denied");
  assert.equal(qrDecision({ identifier: "qr", access: { permissions: ["manage_firearms"] as never[], enabledFeatures: [] }, firearm: { id: "f" } }).status, "denied");
  assert.equal(qrDecision({ identifier: "qr", access: { permissions: ["view_inventory"] as never[], enabledFeatures: [] }, inventory: { id: "i" } }).status, "denied");
  assert.equal(qrDecision({ identifier: "", access }).status, "unknown");
});

test("vehicle QR allows inspection officers, Fleet supervisors, and department administrators", () => {
  const vehicle = { id: "vehicle-demo-12", unit_number: "12" };
  const fleetEnabled = ["fleet"];
  const decision = (permissions: string[]) => qrDecision({
    identifier: vehicle.id,
    access: { permissions: permissions as never[], enabledFeatures: fleetEnabled },
    vehicle,
  });

  const officer = effectiveDepartmentPermissions(["officer"], ["perform_fleet_inspections"]);
  const supervisor = effectiveDepartmentPermissions(["supervisor"], ["view_fleet"]);
  const administrator = effectiveDepartmentPermissions(["administrator"], []);
  assert.equal(decision(officer).allowed, true);
  assert.equal(decision(supervisor).allowed, true);
  assert.equal(decision(administrator).allowed, true);
});

test("vehicle QR denies users without Fleet grants and agencies without Fleet enabled", () => {
  const vehicle = { id: "vehicle-demo-12", unit_number: "12" };
  const unprivilegedOfficer = effectiveDepartmentPermissions(["officer"], []);
  assert.equal(qrDecision({ identifier: vehicle.id, access: { permissions: unprivilegedOfficer, enabledFeatures: ["fleet"] }, vehicle }).status, "denied");
  assert.equal(qrDecision({ identifier: vehicle.id, access: { permissions: ["perform_fleet_inspections"] as never[], enabledFeatures: [] }, vehicle }).status, "denied");
});

test("mobile QR lookup propagates the bearer Request and keeps vehicle matches agency-scoped", async () => {
  const route = await readFile(new URL("../../app/api/mobile/qr/resolve/route.ts", import.meta.url), "utf8");
  assert.match(route, /resolveServerAccess\(request\)/);
  assert.match(route, /from\("fleet_vehicles"\)[\s\S]*?eq\("department_id", departmentId\)/);
});

test("a QR identifier with no match in the selected agency stays unknown", () => {
  const result = qrDecision({
    identifier: "vehicle-from-another-agency",
    access: { permissions: ["perform_fleet_inspections"] as never[], enabledFeatures: ["fleet"] },
    vehicle: null,
    equipment: null,
    firearm: null,
    inventory: null,
  });
  assert.deepEqual(result, { status: "unknown", message: "This QR code is unknown, inactive, or unavailable." });
});
