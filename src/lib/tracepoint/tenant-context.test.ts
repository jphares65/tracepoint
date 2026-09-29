import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

import {
  canAdministerTenant,
  resolveTenantContext,
} from "./tenant-context.ts";

test("agency Administrator can administer its selected tenant", () => {
  const context = resolveTenantContext({
    selectedDepartmentId: "agency-a",
    activeMembershipDepartmentIds: ["agency-a"],
    isPlatformAdmin: false,
  });

  assert.equal(
    canAdministerTenant(context, "agency-a", ["administer_department"]),
    true,
  );
});

test("platform administrator can administer an explicitly selected tenant", () => {
  const context = resolveTenantContext({
    selectedDepartmentId: "agency-a",
    activeMembershipDepartmentIds: [],
    isPlatformAdmin: true,
  });

  assert.deepEqual(context, {
    ok: true,
    departmentId: "agency-a",
    kind: "platform",
  });
  assert.equal(canAdministerTenant(context, "agency-a", []), true);
});

test("platform administrator without tenant context cannot mutate an arbitrary tenant", () => {
  const context = resolveTenantContext({
    selectedDepartmentId: "",
    activeMembershipDepartmentIds: [],
    isPlatformAdmin: true,
  });

  assert.deepEqual(context, { ok: false, reason: "no_membership" });
  assert.equal(canAdministerTenant(context, "agency-a", []), false);
});

test("ordinary users remain denied outside their permission set", () => {
  const context = resolveTenantContext({
    selectedDepartmentId: "agency-a",
    activeMembershipDepartmentIds: ["agency-a"],
    isPlatformAdmin: false,
  });

  assert.equal(canAdministerTenant(context, "agency-a", []), false);
});

test("cross-tenant access remains denied", () => {
  const context = resolveTenantContext({
    selectedDepartmentId: "agency-a",
    activeMembershipDepartmentIds: ["agency-a"],
    isPlatformAdmin: false,
  });

  assert.equal(
    canAdministerTenant(context, "agency-b", ["administer_department"]),
    false,
  );
});

test("patch upload and display route use resolved context and audit its result", async () => {
  const [route, proxy, access] = await Promise.all([
    readFile("src/app/api/settings/department-patch/route.ts", "utf8"),
    readFile("src/lib/supabase/proxy.ts", "utf8"),
    readFile("src/lib/tracepoint/server-access.ts", "utf8"),
  ]);

  assert.match(route, /resolveServerAccess\(\)/);
  assert.match(route, /department_id: context\.departmentId/);
  assert.match(route, /actor_user_id: context\.userId/);
  assert.match(route, /target_department_id: context\.departmentId/);
  assert.match(route, /effective_context: effectiveContext/);
  assert.match(route, /result,/);
  assert.match(route, /departmentPatchPathFromMetadata/);
  assert.match(proxy, /if \(selectedDepartmentId\)[\s\S]*is_platform_admin/);
  assert.doesNotMatch(proxy, /supportModeRequested/);
  assert.match(access, /if \(isPlatformAdmin && selectedDepartmentId\)/);
});
