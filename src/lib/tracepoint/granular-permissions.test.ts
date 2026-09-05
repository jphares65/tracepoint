import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { effectiveDepartmentPermissions } from "./permission-authority.ts";
import { PERMISSION_COVERAGE, TRACEPOINT_PERMISSIONS } from "./permissions.ts";

test("generated coverage defines every permission exactly once with actionable surfaces", () => {
  assert.equal(PERMISSION_COVERAGE.length, TRACEPOINT_PERMISSIONS.length);
  assert.deepEqual(
    [...new Set(PERMISSION_COVERAGE.map((item) => item.code))].sort(),
    [...TRACEPOINT_PERMISSIONS].sort(),
  );
  for (const permission of PERMISSION_COVERAGE) {
    assert.ok(permission.displayName.length > 3, permission.code);
    assert.ok(permission.description.length > 20, permission.code);
    assert.ok(permission.actions.length > 0, permission.code);
    assert.ok(permission.modules.length > 0, permission.code);
    assert.ok(permission.routes.length > 0, permission.code);
    assert.ok(permission.tables.length > 0, permission.code);
  }
});

test("only the exact Administrator role inherits every current permission", () => {
  for (const role of ["chief", "command_staff", "supervisor", "armorer", "range_master", "fleet_manager", "training_manager", "department_admin", "admin"]) {
    assert.deepEqual(effectiveDepartmentPermissions([role], []), [], role);
  }
  assert.deepEqual(
    effectiveDepartmentPermissions(["administrator"], []),
    [...TRACEPOINT_PERMISSIONS],
  );
  assert.deepEqual(
    effectiveDepartmentPermissions(["chief"], ["view_analytics", "view_analytics", "forged"]),
    ["view_analytics"],
  );
});

test("database authority validates active membership, tenant, catalog, exact grants, and final Administrator", async () => {
  const migration = await readFile("supabase/migrations/202609050002_granular_permission_authority.sql", "utf8");
  assert.match(migration, /membership\.is_active = true/);
  assert.match(migration, /membership\.department_id = p_department_id/);
  assert.match(migration, /permission\.code = p_permission_code/);
  assert.match(migration, /membership_role\.role_code = 'administrator'/);
  assert.match(migration, /role_permission\.permission_code = p_permission_code/);
  assert.match(migration, /protect_final_department_administrator/);
  assert.match(migration, /role_permission\.role_code <> 'administrator'/);
  assert.match(migration, /and not \(role_code = any\(normalized_roles\)\)/);
  assert.match(migration, /set_department_role_permissions[\s\S]*public\.is_platform_admin\(\)/);
  assert.doesNotMatch(migration, /role_code in \([^)]*'chief'/);
});

test("Settings saves through an authenticated tenant-bound API and reports success after verified persistence", async () => {
  const [route, page] = await Promise.all([
    readFile("src/app/api/settings/role-permissions/route.ts", "utf8"),
    readFile("src/app/settings/page.tsx", "utf8"),
  ]);
  assert.match(route, /resolveServerAccess\(\)/);
  assert.match(route, /departmentId !== context\.departmentId/);
  assert.match(route, /context\.authDb\.rpc\("set_department_role_permissions"/);
  assert.match(route, /saved permissions could not be verified/i);
  assert.match(page, /fetch\("\/api\/settings\/role-permissions"/);
  const save = page.slice(page.indexOf("async function saveRolePermissions"), page.indexOf("async function inviteUser"));
  assert.ok(save.indexOf("await Promise.all([loadSettings(), refreshAccess()])") < save.indexOf("showNotice(\"success\""));
  assert.match(save, /catch \(error\)[\s\S]*showNotice\([\s\S]*"error"/);
});

test("server mutation gates use permissions and contain no operational role-name shortcut", async () => {
  const files = await Promise.all([
    "src/lib/tracepoint/fleet-server.ts",
    "src/lib/tracepoint/personal-rifle-server.ts",
    "src/app/api/armory/ammunition/route.ts",
    "src/app/api/armory/ammunition/reconciliations/route.ts",
    "src/app/api/off-duty-firearms/route.ts",
    "src/app/api/off-duty-firearms/[requestId]/route.ts",
  ].map((file) => readFile(file, "utf8")));
  const combined = files.join("\n");
  assert.doesNotMatch(combined, /roleCodes\.includes\("(?:chief|command_staff|armorer|range_master|fleet_manager|mechanic|training_manager)"\)/);
  assert.doesNotMatch(combined, /reviewerRoleCodes\s*=\s*\["chief"\]/);
  assert.match(combined, /manage_firearms/);
  assert.match(combined, /manage_inspections/);
  assert.match(combined, /approve_personal_rifles/);
  assert.match(combined, /review_off_duty_requests/);
  assert.match(combined, /submit_off_duty_requests/);
  assert.match(combined, /manage_fleet_maintenance/);
});

test("notification and personnel reads use permission-derived department scope", async () => {
  const [notifications, personnel, offDuty, rangeApi, rangePage] = await Promise.all([
    readFile("src/app/api/notifications/route.ts", "utf8"),
    readFile("src/app/api/pilot/personnel/route.ts", "utf8"),
    readFile("src/app/api/off-duty-firearms/route.ts", "utf8"),
    readFile("src/app/api/pilot/range-workspace/route.ts", "utf8"),
    readFile("src/app/range-days/page.tsx", "utf8"),
  ]);
  assert.doesNotMatch(notifications, /approve_off_duty_requests|return_off_duty_requests|deny_off_duty_requests/);
  assert.match(notifications, /permissions\.includes\("review_off_duty_requests"\)/);
  assert.match(personnel, /canViewDepartment[\s\S]*membership\.user_id === context\.userId/);
  assert.match(offDuty, /permission_code", "review_off_duty_requests"/);
  assert.match(offDuty, /\.eq\("is_active", true\)/);
  assert.match(rangeApi, /userId: resolved\.context\.userId/);
  assert.match(rangePage, /setCurrentUserId\(payload\.userId/);
  assert.doesNotMatch(rangePage, /CURRENT_USER_PROFILE|CURRENT_USER\.id/);
});

test("agency training, certifications, equipment, range, exports, and pilot mutations use their documented permissions", async () => {
  const [training, certification, equipment, range, report, ammunition, remediation] = await Promise.all([
    readFile("src/app/api/agency-training/events/route.ts", "utf8"),
    readFile("src/app/api/training/certifications/route.ts", "utf8"),
    readFile("src/app/api/equipment/assets/route.ts", "utf8"),
    readFile("src/app/api/pilot/range-workspace/route.ts", "utf8"),
    readFile("src/app/api/agency-training/events/[eventId]/report/route.ts", "utf8"),
    readFile("src/app/api/pilot/ammunition/route.ts", "utf8"),
    readFile("src/app/api/pilot/remediations/route.ts", "utf8"),
  ]);
  assert.match(training, /const MANAGE_PERMISSIONS = \[\s*"manage_training"/);
  assert.doesNotMatch(training, /MANAGE_PERMISSIONS[\s\S]{0,100}manage_(?:range_days|certifications)/);
  assert.match(certification, /hasAnyServerPermission\(resolved\.context, \["manage_certifications"\]\)/);
  assert.match(equipment, /if \(!context\.canManage\) return equipmentPermissionDenied\(\)/);
  assert.match(range, /authorizeRangeWorkspaceMutation/);
  assert.match(report, /manage_training/);
  assert.match(ammunition, /manage_firearms/);
  assert.match(remediation, /manage_training/);
});

test("API denials distinguish unauthenticated and unauthorized callers without database details", async () => {
  const [access, proxy, settings] = await Promise.all([
    readFile("src/lib/tracepoint/server-access.ts", "utf8"),
    readFile("src/lib/supabase/proxy.ts", "utf8"),
    readFile("src/app/api/settings/role-permissions/route.ts", "utf8"),
  ]);
  assert.match(access, /status: 401[\s\S]*Authentication is required/);
  assert.match(access, /status: 403[\s\S]*No active department membership/);
  assert.match(access, /result\.status >= 500[\s\S]*TracePoint access could not be verified/);
  assert.match(proxy, /function isApiPath[\s\S]*startsWith\("\/api\/"\)/);
  assert.match(proxy, /function apiAccessFailure[\s\S]*status: 401 \| 403[\s\S]*"Cache-Control": "no-store"/);
  assert.match(proxy, /function forbiddenOrRedirect[\s\S]*apiAccessFailure\([\s\S]*403/);
  assert.doesNotMatch(settings, /error\.message/);
});
