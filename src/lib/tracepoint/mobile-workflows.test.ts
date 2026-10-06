import assert from "node:assert/strict";
import test from "node:test";
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
  assert.equal(qrDecision({ identifier: "qr", access: { permissions: [] as never[], enabledFeatures: [] }, firearm: { id: "f" } }).status, "denied");
  assert.equal(qrDecision({ identifier: "", access }).status, "unknown");
});
