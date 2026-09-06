import {
  TRACEPOINT_PERMISSIONS,
  type TracePointPermission,
} from "./permissions.ts";

export const DEPARTMENT_ADMINISTRATOR_ROLE = "administrator";

export function isDepartmentAdministrator(roleCodes: readonly string[]) {
  return roleCodes.includes(DEPARTMENT_ADMINISTRATOR_ROLE);
}

export function effectiveDepartmentPermissions(
  roleCodes: readonly string[],
  grantedPermissions: readonly unknown[],
): TracePointPermission[] {
  if (isDepartmentAdministrator(roleCodes)) {
    return [...TRACEPOINT_PERMISSIONS];
  }

  return Array.from(
    new Set(grantedPermissions.filter(
      (permission): permission is TracePointPermission =>
        typeof permission === "string" &&
        (TRACEPOINT_PERMISSIONS as readonly string[]).includes(permission),
    )),
  ).sort();
}
