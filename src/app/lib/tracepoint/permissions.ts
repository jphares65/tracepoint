import type { TracePointUser, UserRole } from "./types";

const COMMAND_ROLES: UserRole[] = ["Supervisor", "Admin", "Command"];
const FIREARMS_MANAGEMENT_ROLES: UserRole[] = ["Armorer", "Admin", "Command"];
const TRAINING_MANAGEMENT_ROLES: UserRole[] = [
  "Instructor",
  "Supervisor",
  "Admin",
  "Command",
];

export function hasRole(user: TracePointUser, roles: UserRole[]) {
  return roles.includes(user.role);
}

export function canViewAllOfficers(user: TracePointUser) {
  return hasRole(user, ["Supervisor", "Instructor", "Armorer", "Admin", "Command"]);
}

export function canManageFirearms(user: TracePointUser) {
  return hasRole(user, FIREARMS_MANAGEMENT_ROLES);
}

export function canViewAllFirearms(user: TracePointUser) {
  return hasRole(user, ["Supervisor", "Instructor", "Armorer", "Admin", "Command"]);
}

export function canCreateRangeDay(user: TracePointUser) {
  return hasRole(user, TRAINING_MANAGEMENT_ROLES);
}

export function canScoreRangeDrills(user: TracePointUser) {
  return hasRole(user, TRAINING_MANAGEMENT_ROLES);
}

export function canEditQualificationResults(user: TracePointUser) {
  return hasRole(user, TRAINING_MANAGEMENT_ROLES);
}

export function canApproveOffDutyFirearms(user: TracePointUser) {
  return hasRole(user, COMMAND_ROLES);
}

export function canSubmitOffDutyFirearmRequest(user: TracePointUser) {
  return user.isActive;
}

export function canViewArmorerAlerts(user: TracePointUser) {
  return hasRole(user, ["Armorer", "Admin", "Command"]);
}

export function canResolveAlerts(user: TracePointUser) {
  return hasRole(user, ["Supervisor", "Instructor", "Armorer", "Admin", "Command"]);
}

export function canManageSettings(user: TracePointUser) {
  return hasRole(user, ["Admin", "Command"]);
}

export function canViewAuditLog(user: TracePointUser) {
  return hasRole(user, ["Supervisor", "Admin", "Command"]);
}