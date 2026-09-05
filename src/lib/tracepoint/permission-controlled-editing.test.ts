import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fleet direct API edits require manage_fleet, preserve row identity, scope tenant, and audit before and after", async () => {
  const [route, helper] = await Promise.all([
    readFile("src/app/api/fleet/vehicles/route.ts", "utf8"),
    readFile("src/lib/tracepoint/fleet-server.ts", "utf8"),
  ]);
  const patchStart = route.indexOf("export async function PATCH");
  const patch = route.slice(patchStart);
  assert.ok(patchStart > 0);
  assert.match(patch, /canManageFleet\(resolved, rules\)/);
  assert.match(patch, /\.eq\("department_id", resolved\.departmentId\)/);
  assert.match(patch, /\.eq\("id", id\)/);
  assert.match(patch, /action: "fleet_vehicle_updated"/);
  assert.match(patch, /previous: existing/);
  assert.match(patch, /current: data/);
  assert.doesNotMatch(patch, /fleet_vehicle_inspections[\s\S]*(?:delete|update)/);
  assert.doesNotMatch(patch, /fleet_work_orders[\s\S]*(?:delete|update)/);
  assert.doesNotMatch(patch, /fleet_vehicle_documents[\s\S]*(?:delete|update)/);
  const manageHelper = helper.slice(helper.indexOf("export function canManageFleet"), helper.indexOf("export function canPerformFleetMaintenance"));
  assert.match(manageHelper, /permissions\.includes\("manage_fleet"\)/);
  assert.doesNotMatch(manageHelper, /hasAnyRole/);
});

test("equipment asset and type API mutations deny non-managers and keep tenant filters", async () => {
  const [assets, types] = await Promise.all([
    readFile("src/app/api/equipment/assets/route.ts", "utf8"),
    readFile("src/app/api/equipment/types/route.ts", "utf8"),
  ]);
  for (const route of [assets, types]) {
    assert.match(route, /if \(!context\.canManage\) return equipmentPermissionDenied\(\)/);
    assert.match(route, /department_id", context\.departmentId/);
  }
  assert.match(types, /TYPE_IN_USE/);
  assert.match(types, /Archive it to preserve assignments, inspections, and history/);
  assert.match(assets, /assigned_user_id: assignedUserId/);
});

test("range direct API uses resolved active membership permissions and returns controlled denials", async () => {
  const [route, access] = await Promise.all([
    readFile("src/app/api/pilot/range-workspace/route.ts", "utf8"),
    readFile("src/lib/tracepoint/server-access.ts", "utf8"),
  ]);
  assert.match(route, /resolveServerAccess\(\)/);
  assert.match(route, /authorizeRangeWorkspaceMutation/);
  assert.match(route, /permissions: resolved\.context\.permissions/);
  assert.match(route, /status: decision\.status/);
  assert.doesNotMatch(route, /throw new Error\(error\.message\)/);
  assert.match(access, /\.eq\("is_active", true\)/);
  assert.match(access, /No active department membership was found/);
});

test("database policies deny inactive and unauthorized writes while audit triggers capture direct writes", async () => {
  const migration = await readFile("supabase/migrations/202609050001_permission_controlled_editing.sql", "utf8");
  assert.match(migration, /is_active_department_member\(department_id, auth\.uid\(\)\)/);
  assert.match(migration, /array\['manage_fleet', 'administer_department'\]/);
  assert.match(migration, /array\['manage_range_days', 'score_range_days', 'manage_qualifications', 'administer_department'\]/);
  assert.match(migration, /fleet_vehicles_accountability_audit/);
  assert.match(migration, /pilot_range_workspaces_accountability_audit/);
  assert.match(migration, /old_json|previous_value|write_audit_event/);
  assert.match(migration, /Finalized range history cannot be changed/);
});

test("the request proxy exposes health and returns a direct 403 for inactive API callers", async () => {
  const proxy = await readFile("src/lib/supabase/proxy.ts", "utf8");
  assert.match(proxy, /PUBLIC_PATHS = \[[^\]]*"\/api\/health"/);
  const inactiveBranch = proxy.slice(proxy.indexOf("if (memberships.length === 0)"));
  assert.match(inactiveBranch, /pathname\.toLowerCase\(\)\.startsWith\("\/api\/"\)/);
  assert.match(inactiveBranch, /No active department membership was found/);
  assert.match(inactiveBranch, /status: 403/);
  assert.match(inactiveBranch, /"Cache-Control": "no-store"/);
});

test("fleet UI exposes compact manager-only create and edit dialog with refresh and reason", async () => {
  const page = await readFile("src/app/fleet-management/page.tsx", "utf8");
  assert.match(page, /canManage \? \(/);
  assert.match(page, /openEditForm\(vehicle\)/);
  assert.match(page, /Edit Fleet Vehicle/);
  assert.match(page, /Reason for Change/);
  assert.match(page, /await loadFleet\(\)/);
});
