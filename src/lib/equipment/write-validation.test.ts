import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { equipmentAssignment, equipmentIdentifierConflict } from "./write-validation.ts";

test("accepts unassigned, officer, vehicle, and location custody independently", () => {
  assert.deepEqual(equipmentAssignment({}), { assignedUserId: null, assignedVehicleId: null, assignedLocation: null });
  assert.equal(equipmentAssignment({ assignedUserId: " officer-a " }).assignedUserId, "officer-a");
  assert.equal(equipmentAssignment({ assignedVehicleId: "vehicle-a" }).assignedVehicleId, "vehicle-a");
  assert.equal(equipmentAssignment({ assignedLocation: "Evidence room" }).assignedLocation, "Evidence room");
});

test("rejects ambiguous assignment targets and maps duplicate identifiers", () => {
  assert.throws(() => equipmentAssignment({ assignedUserId: "a", assignedVehicleId: "b" }), /only one/);
  assert.match(equipmentIdentifierConflict("23505") ?? "", /serial or asset number/);
});

test("migration grants scoped history writes and enforces same-agency targets", async () => {
  const sql = await readFile("supabase/migrations/202609020001_equipment_assignment_rls_and_targets.sql", "utf8");
  assert.match(sql, /equipment_assignment_history_insert_managers/);
  assert.match(sql, /member\.department_id = new\.department_id/);
  assert.match(sql, /vehicle\.department_id = new\.department_id/);
  assert.match(sql, /equipment_assets_single_assignment_target/);
  assert.match(sql, /write_audit_event/);
});
