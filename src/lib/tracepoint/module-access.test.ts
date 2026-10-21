import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { effectiveDepartmentPermissions } from "./permission-authority.ts";
import { canAccessModule, isAgencyFeatureEnabled, toggleExpandedGroup } from "./module-access.ts";
import type { PermissionRequirement } from "./permissions.ts";
import { MODULE_FEATURE_CODES, OPERATIONAL_MODULE_CATALOG, type ModuleFeatureCode } from "./module-catalog.ts";

const armoryRequirement: PermissionRequirement = {
  anyOf: ["manage_firearms", "manage_inspections", "view_command_dashboard"],
};

test("Chief plus Administrator receives Administrator permissions but remains limited by agency entitlements", () => {
  const permissions = effectiveDepartmentPermissions(["chief", "administrator"], []);
  const enabledFeatures = new Set(["equipment_readiness", "fleet"]);

  assert.ok(permissions.includes("manage_firearms"));
  assert.ok(permissions.includes("view_analytics"));
  assert.ok(permissions.includes("manage_range_days"));
  assert.equal(canAccessModule({ permissions, enabledFeatures, featureCode: "firearms", requirement: armoryRequirement }), false);
  assert.equal(canAccessModule({ permissions, enabledFeatures, featureCode: "analytics", requirement: { anyOf: ["view_analytics"] } }), false);
  assert.equal(canAccessModule({ permissions, enabledFeatures, featureCode: "range_training" }), false);
  assert.equal(canAccessModule({ permissions, enabledFeatures, featureCode: "equipment_readiness" }), true);
});

test("Chief plus Administrator sees every configured module when its entitlement is enabled", () => {
  const permissions = effectiveDepartmentPermissions(["chief", "administrator"], []);
  const enabledFeatures = new Set(MODULE_FEATURE_CODES);
  const modules: Array<{ featureCode: ModuleFeatureCode; requirement?: PermissionRequirement }> = [
    { featureCode: "ammunition", requirement: { anyOf: ["manage_firearms", "view_command_dashboard"] } },
    { featureCode: "analytics", requirement: { anyOf: ["view_analytics"] } },
    { featureCode: "certifications" },
    { featureCode: "command_dashboard", requirement: { anyOf: ["view_command_dashboard"] } },
    { featureCode: "equipment_readiness" },
    { featureCode: "fleet" },
    { featureCode: "firearms", requirement: armoryRequirement },
    { featureCode: "inventory" },
    { featureCode: "off_duty", requirement: { anyOf: ["submit_off_duty_requests", "review_off_duty_requests"] } },
    { featureCode: "qualifications" },
    { featureCode: "range_training" },
  ];

  assert.deepEqual(
    modules.filter((module) => canAccessModule({ ...module, permissions, enabledFeatures })),
    modules,
  );
});

test("the canonical catalog covers every operational module exactly once", () => {
  assert.equal(new Set(MODULE_FEATURE_CODES).size, MODULE_FEATURE_CODES.length);
  assert.deepEqual(OPERATIONAL_MODULE_CATALOG.map((entry) => entry.code), [...MODULE_FEATURE_CODES].sort((a, b) =>
    OPERATIONAL_MODULE_CATALOG.find((entry) => entry.code === a)!.sortOrder -
    OPERATIONAL_MODULE_CATALOG.find((entry) => entry.code === b)!.sortOrder,
  ));
  assert.ok(MODULE_FEATURE_CODES.includes("fleet"));
  assert.ok(MODULE_FEATURE_CODES.includes("inventory"));
});

test("module visibility honors each non-administrator role's permissions and the agency entitlement", () => {
  const chiefPermissions = effectiveDepartmentPermissions(["chief"], ["view_analytics"]);
  assert.equal(canAccessModule({ permissions: chiefPermissions, enabledFeatures: new Set(["analytics"]), featureCode: "analytics", requirement: { anyOf: ["view_analytics"] } }), true);
  assert.equal(canAccessModule({ permissions: chiefPermissions, enabledFeatures: new Set(["firearms"]), featureCode: "firearms", requirement: armoryRequirement }), false);
  assert.equal(canAccessModule({ permissions: chiefPermissions, enabledFeatures: new Set(), featureCode: "analytics", requirement: { anyOf: ["view_analytics"] } }), false);
});

test("the UI cannot treat platform support as an agency module entitlement", async () => {
  const shell = await readFile("src/app/components/TracePointShell.tsx", "utf8");
  const accessHook = await readFile("src/lib/tracepoint/useTracePointAccess.ts", "utf8");
  const allPermissions = effectiveDepartmentPermissions(["administrator"], []);

  assert.equal(isAgencyFeatureEnabled(new Set(), "firearms"), false);
  assert.equal(canAccessModule({ permissions: allPermissions, enabledFeatures: new Set(), featureCode: "firearms", requirement: armoryRequirement }), false);
  assert.match(shell, /return canAccessModule\(\{/);
  assert.doesNotMatch(shell, /isSuperAdmin\s*\|\|\s*canAccessModule/);
  assert.match(accessHook, /hasEnabledFeatures\(featureSet, \[featureCode\]\)/);
  assert.doesNotMatch(accessHook, /access\.isSuperAdmin\s*\|\|\s*featureSet/);
});

test("direct Armory route checks both the effective permission and firearms entitlement", async () => {
  const [layout, firearmsApi] = await Promise.all([
    readFile("src/app/firearms/layout.tsx", "utf8"),
    readFile("src/app/api/armory/firearms/route.ts", "utf8"),
  ]);
  assert.match(layout, /hasAnyServerPermission\(resolved\.context,[\s\S]*"manage_firearms"[\s\S]*"manage_inspections"[\s\S]*"view_command_dashboard"/);
  assert.match(layout, /requireServerFeature\(resolved\.context, "firearms"/);
  assert.match(firearmsApi, /requireServerFeature\([\s\S]*"firearms"/);
  assert.match(firearmsApi, /hasAnyServerPermission\(context,[\s\S]*"manage_firearms"[\s\S]*"manage_inspections"[\s\S]*"view_command_dashboard"/);
});

test("direct Analytics, Range & Training, and Ammunition routes match sidebar policy", async () => {
  const [analyticsLayout, rangeLayout, ammunitionLayout, shell, ammunitionApi] = await Promise.all([
    readFile("src/app/analytics/layout.tsx", "utf8"),
    readFile("src/app/range-days/layout.tsx", "utf8"),
    readFile("src/app/firearms/ammunition/layout.tsx", "utf8"),
    readFile("src/app/components/TracePointShell.tsx", "utf8"),
    readFile("src/app/api/armory/ammunition/route.ts", "utf8"),
  ]);
  assert.match(analyticsLayout, /hasAnyServerPermission\(resolved\.context, \["view_analytics"\]\)/);
  assert.match(analyticsLayout, /hasEnabledFeatures\(resolved\.context\.enabledFeatures, MODULE_FEATURES\.analytics\)/);
  assert.match(rangeLayout, /hasEnabledFeatures\(resolved\.context\.enabledFeatures, MODULE_FEATURES\.rangeTraining\)/);
  assert.match(ammunitionLayout, /hasAnyServerPermission\(resolved\.context, \["manage_firearms"\]\)/);
  assert.match(ammunitionLayout, /"ammunition",\s*"Ammunition"/);
  const ammunitionNav = shell.slice(shell.indexOf('label: "Ammunition"'), shell.indexOf('label: "Reconciliation"'));
  assert.match(ammunitionNav, /requirement: \{ anyOf: \["manage_firearms"\] \}/);
  assert.match(ammunitionApi, /hasAnyServerPermission\(resolved\.context, \["manage_firearms"\]\)/);
  assert.equal(canAccessModule({ permissions: ["view_command_dashboard"], enabledFeatures: new Set(["ammunition"]), featureCode: "ammunition", requirement: { anyOf: ["manage_firearms"] } }), false);
});

test("AWS-native access hydration combines role-derived permissions with enabled tenant features", async () => {
  const source = await readFile("src/lib/tracepoint/server-access-postgres.ts", "utf8");
  assert.match(source, /from public\.department_membership_roles mr[\s\S]*where mr\.department_id=\$1 and mr\.user_id=\$2/);
  assert.match(source, /public\.has_department_permission\(\$1,permission_code\)/);
  assert.match(source, /from public\.department_features where department_id=\$1 and is_enabled is not false/);
  assert.match(source, /effectiveDepartmentPermissions\(roleCodes,permissionRows\.rows\.map\(row=>row\.permission_code\)\)/);
});

test("expandable sidebar sections start collapsed and retain only user-controlled expansion", () => {
  const initiallyOpen = new Set<string>();
  assert.deepEqual([...initiallyOpen], []);

  const opened = toggleExpandedGroup(initiallyOpen, "Armory");
  assert.deepEqual([...opened], ["Armory"]);
  assert.deepEqual([...toggleExpandedGroup(opened, "Armory")], []);
});
