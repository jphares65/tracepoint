import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { groupCurrentOfficerAssignments } from "./officer-assignments.ts";

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
