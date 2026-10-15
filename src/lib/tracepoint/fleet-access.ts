import { MODULE_FEATURE } from "./module-catalog.ts";

const FLEET_READ_PERMISSIONS = [
  "view_fleet",
  "manage_fleet",
  "perform_fleet_inspections",
  "manage_fleet_maintenance",
  "manage_fleet_rules",
] as const;

const FLEET_INSPECTION_PERMISSIONS = [
  "administer_department",
  "perform_fleet_inspections",
  "manage_fleet",
  "manage_fleet_rules",
] as const;

type FleetAccess = {
  permissions: readonly string[];
  enabledFeatures: readonly string[];
  isSuperAdmin?: boolean;
};

export function canReadFleet(access: FleetAccess) {
  return access.enabledFeatures.includes(MODULE_FEATURE.FLEET) &&
    (access.isSuperAdmin === true || FLEET_READ_PERMISSIONS.some((permission) => access.permissions.includes(permission)));
}
export function canUseVehicleInspectionQr(
  access: FleetAccess & { roleCodes: readonly string[] },
  permittedRoleCodes: readonly string[],
) {
  if (!access.enabledFeatures.includes(MODULE_FEATURE.FLEET)) return false;

  const permissionGranted = access.isSuperAdmin === true ||
    ["administer_department", "perform_fleet_inspections", "view_fleet", "manage_fleet"]
      .some((permission) => access.permissions.includes(permission));
  const configuredRoleGranted = permittedRoleCodes.length > 0 &&
    access.roleCodes.some((roleCode) => permittedRoleCodes.includes(roleCode));

  return permissionGranted || configuredRoleGranted;
}

export function canPerformFleetInspection(
  access: FleetAccess & { roleCodes: readonly string[] },
  permittedRoleCodes: readonly string[],
) {
  if (!access.enabledFeatures.includes(MODULE_FEATURE.FLEET)) return false;

  const permissionGranted = access.isSuperAdmin === true ||
    FLEET_INSPECTION_PERMISSIONS.some((permission) => access.permissions.includes(permission));
  const configuredRoleGranted = permittedRoleCodes.length > 0 &&
    access.roleCodes.some((roleCode) => permittedRoleCodes.includes(roleCode));

  return permissionGranted || configuredRoleGranted;
}
