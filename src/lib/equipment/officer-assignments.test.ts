import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { equipmentCustodyLabel, equipmentHolderName, groupCurrentOfficerAssignments } from "./officer-assignments.ts";

const members = [{ userId: "auth-chief" }, { userId: "auth-officer" }];
const laptop = (assignedUserId: string | null, lifecycleStatus = "active") => ({
  id: "laptop",
  assigned_user_id: assignedUserId,
  lifecycle_status: lifecycleStatus,
});

test("assigned laptop appears on the matching officer auth/profile record", () => {
  const grouped = groupCurrentOfficerAssignments(members, [laptop("auth-chief")]);
  assert.deepEqual(grouped.get("auth-chief")?.map((asset) => asset.id), ["laptop"]);
  assert.equal(grouped.has("auth-officer"), false);
});

test("uses membership user IDs and rejects unrelated personnel or department identifiers", () => {
  assert.equal(groupCurrentOfficerAssignments(members, [laptop("personnel-row-id")]).size, 0);
  assert.equal(groupCurrentOfficerAssignments(members, [laptop("other-department-user")]).size, 0);
});

test("reassignment, unassignment, and removal update current custody", () => {
  assert.equal(groupCurrentOfficerAssignments(members, [laptop("auth-chief")]).get("auth-chief")?.length, 1);
  assert.equal(groupCurrentOfficerAssignments(members, [laptop("auth-officer")]).get("auth-officer")?.length, 1);
  assert.equal(groupCurrentOfficerAssignments(members, [laptop(null)]).size, 0);
  assert.equal(groupCurrentOfficerAssignments(members, [laptop("auth-chief", "removed")]).size, 0);
});

test("asset writes atomically synchronize assignment history and enforce tenant-scoped RLS", async () => {
  const sync = await readFile("supabase/migrations/202608190002_equipment_assignment_sync.sql", "utf8");
  const guards = await readFile("supabase/migrations/202609020001_equipment_assignment_rls_and_targets.sql", "utf8");
  const policies = await readFile("supabase/migrations/20260822202500_equipment_rls_hardening.sql", "utf8");
  assert.match(sync, /after insert or update of assigned_user_id/);
  assert.match(sync, /returned_at = now\(\)/);
  assert.match(sync, /insert into public\.equipment_asset_assignments/);
  assert.match(guards, /member\.department_id = new\.department_id/);
  assert.match(policies, /assigned_user_id = auth\.uid\(\)/);
});

test("EQP-01: a separated holder's items stay grouped under that holder and are never shown as Unassigned", () => {
  const holders = [
    { userId: "auth-officer", fullName: "Olive Officer" },
    { userId: "auth-gone", fullName: "Sam Separated", isActive: false },
  ];
  const vest = { id: "vest", assigned_user_id: "auth-gone", lifecycle_status: "active" };
  const radio = { id: "radio", assigned_user_id: "auth-gone", lifecycle_status: "out_of_service" };
  assert.deepEqual(groupCurrentOfficerAssignments(holders, [vest, radio]).get("auth-gone")?.map((asset) => asset.id), ["vest", "radio"]);

  const holderMap = new Map(holders.map((holder) => [holder.userId, holder]));
  const vehicles = new Map([["vehicle-1", { unit_number: "3101" }]]);
  assert.equal(equipmentHolderName(holders[1]), "Sam Separated (inactive)");
  assert.equal(equipmentCustodyLabel(vest, holderMap, vehicles), "Sam Separated (inactive)");
  assert.equal(equipmentCustodyLabel({ assigned_user_id: "auth-officer" }, holderMap, vehicles), "Olive Officer");
  // A holder the viewer cannot resolve, or a vehicle not in the active fleet, is still not "Unassigned".
  assert.equal(equipmentCustodyLabel({ assigned_user_id: "auth-unknown" }, holderMap, vehicles), "Unrecognized holder");
  assert.equal(equipmentCustodyLabel({ assigned_vehicle_id: "vehicle-1" }, holderMap, vehicles), "Vehicle 3101");
  assert.equal(equipmentCustodyLabel({ assigned_vehicle_id: "vehicle-retired" }, holderMap, vehicles), "Assigned vehicle");
  assert.equal(equipmentCustodyLabel({ assigned_location: "Armory" }, holderMap, vehicles), "Armory");
  assert.equal(equipmentCustodyLabel({}, holderMap, vehicles), "Unassigned");
});

test("EQP-01: the equipment page and exports resolve holders through the separated-holder list", async () => {
  const page = await readFile("src/app/equipment/page.tsx", "utf8");
  assert.match(page, /\[\.\.\.members, \.\.\.inactiveHolders\]\.map/);
  assert.match(page, /groupCurrentOfficerAssignments\(holders, assets\)/);
  assert.match(page, /equipmentCustodyLabel\(asset, memberMap, vehicleMap\)/);
  assert.doesNotMatch(page, /asset\.assigned_location \?\? "Unassigned"/);
  const exports = await readFile("src/app/settings/import-export/page.tsx", "utf8");
  assert.match(exports, /\.\.\.\(assetsPayload\.inactiveHolders \?\? \[\]\)/);
  assert.match(exports, /\.\.\.(\(equipmentData\.inactiveHolders \?\? \[\]\)|reportRecords\(equipmentData\.inactiveHolders\))/);
});
