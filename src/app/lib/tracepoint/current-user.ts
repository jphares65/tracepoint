import { CURRENT_USER } from "./mock-data";

export type TracePointRole =
  | "Officer"
  | "Instructor"
  | "Range Master"
  | "Armorer"
  | "Supervisor"
  | "Command Staff"
  | "Chief"
  | "Administrator";

export type TracePointPermission =
  | "view_command_dashboard"
  | "approve_off_duty_firearms"
  | "manage_range_days"
  | "manage_firearms"
  | "view_analytics"
  | "administer_department";

export type TracePointUserProfile = {
  id: string;
  name: string;
  badge: string;
  unit: string;
  role: TracePointRole;
  permissions: TracePointPermission[];
};

function readString(
  record: Record<string, unknown>,
  keys: string[],
  fallback: string,
) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number") {
      return String(value);
    }
  }

  return fallback;
}

const rawCurrentUser = CURRENT_USER as unknown as Record<string, unknown>;

export const CURRENT_USER_PROFILE: TracePointUserProfile = {
  id: CURRENT_USER.id,
  name: readString(rawCurrentUser, ["name", "displayName"], "Current User"),
  badge: readString(
    rawCurrentUser,
    ["badge", "badgeNumber", "employeeNumber"],
    "Badge not set",
  ),
  unit: readString(
    rawCurrentUser,
    ["unit", "division", "assignment"],
    "Department",
  ),
  role: "Command Staff",
  permissions: [
    "view_command_dashboard",
    "approve_off_duty_firearms",
    "manage_range_days",
    "manage_firearms",
    "view_analytics",
    "administer_department",
  ],
};

export const CHIEF_PROFILE: TracePointUserProfile = {
  id: "chief-1",
  name: "Chief of Police",
  badge: "Chief",
  unit: "Office of the Chief",
  role: "Chief",
  permissions: [
    "view_command_dashboard",
    "approve_off_duty_firearms",
    "manage_range_days",
    "manage_firearms",
    "view_analytics",
    "administer_department",
  ],
};

export function hasPermission(
  permission: TracePointPermission,
): boolean {
  return CURRENT_USER_PROFILE.permissions.includes(permission);
}