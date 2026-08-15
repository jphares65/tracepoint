"use client";

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

/**
 * Temporary normalized profile used by client workflows until every module
 * reads the authenticated Supabase user and department membership directly.
 */
export const CURRENT_USER_PROFILE: TracePointUserProfile = {
  id: "de55f6f2-6879-4756-82c5-05a3313bfee2",
  name: "Jason Phares",
  badge: "Badge not set",
  unit: "Command Staff",
  role: "Administrator",
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
  id: "chief",
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

export function hasPermission(permission: TracePointPermission) {
  return CURRENT_USER_PROFILE.permissions.includes(permission);
}

