export const TRACEPOINT_PERMISSIONS = [
  "view_command_dashboard", "view_analytics", "manage_users",
  "manage_firearms", "manage_inspections", "approve_personal_rifles",
  "manage_range_days", "score_range_days", "manage_qualifications",
  "manage_certifications", "manage_training", "manage_equipment",
  "view_fleet", "manage_fleet", "perform_fleet_inspections",
  "manage_fleet_maintenance", "manage_fleet_rules",
  "submit_off_duty_requests", "review_off_duty_requests",
  "view_audit_log", "administer_department",
] as const;

export type TracePointPermission = (typeof TRACEPOINT_PERMISSIONS)[number];
export type PermissionAction = "View" | "Create" | "Edit" | "Delete/Archive" | "Approve" | "Score" | "Export" | "Configure" | "Administer";
export type PermissionRequirement = { anyOf?: readonly TracePointPermission[]; allOf?: readonly TracePointPermission[] };
export type PermissionCoverage = { code: TracePointPermission; displayName: string; description: string; actions: readonly PermissionAction[]; modules: readonly string[]; routes: readonly string[]; tables: readonly string[] };

/**
 * Canonical authorities for the current Training Alerts pilot.
 *
 * The generated alert feed is analytics data. Remediation persistence is an
 * agency-training management operation. Keep these arrays separate because a
 * manage_training-only actor can reach the module and remediation endpoint but
 * cannot load the generated alert feed, while a view_analytics-only actor can
 * load the feed but cannot persist remediation changes.
 */
export const TRAINING_ALERTS_MODULE_PERMISSIONS = [
  "manage_training",
  "view_analytics",
] as const satisfies readonly TracePointPermission[];

export const TRAINING_ALERTS_GENERATED_READ_PERMISSIONS = [
  "view_analytics",
] as const satisfies readonly TracePointPermission[];

export const TRAINING_ALERTS_REMEDIATION_READ_PERMISSIONS = [
  "manage_training",
  "view_analytics",
] as const satisfies readonly TracePointPermission[];

export const TRAINING_ALERTS_REMEDIATION_WRITE_PERMISSIONS = [
  "manage_training",
] as const satisfies readonly TracePointPermission[];

/** Reviewable source map used by the generated permission coverage audit. */
export const PERMISSION_COVERAGE: readonly PermissionCoverage[] = [
  { code: "view_command_dashboard", displayName: "View Command Dashboard", description: "View department-wide command metrics, readiness, and operational queues; this does not grant module editing.", actions: ["View", "Export"], modules: ["Command Dashboard", "Reports"], routes: ["/command-dashboard", "/api/command-dashboard"], tables: ["qualification_results", "range_days", "notification_events"] },
  { code: "view_analytics", displayName: "View Analytics", description: "View department-wide qualification, drill, firearm, training, equipment, and performance analytics; this does not grant editing.", actions: ["View", "Export"], modules: ["Analytics", "Reports", "Readiness"], routes: ["/analytics", "/api/pilot/performance-summary", "/api/readiness"], tables: ["qualification_results", "drill_run_results"] },
  { code: "manage_users", displayName: "Manage Users", description: "Manage non-administrator department memberships, activation, role assignments, groups, ranks, and units.", actions: ["View", "Create", "Edit"], modules: ["Personnel", "Settings"], routes: ["/settings", "/api/settings/users"], tables: ["department_memberships", "department_membership_roles", "department_group_members"] },
  { code: "manage_firearms", displayName: "Manage Firearms", description: "Create, edit, assign, archive, and restore department firearm and ammunition records.", actions: ["View", "Create", "Edit", "Delete/Archive"], modules: ["Firearms", "Ammunition"], routes: ["/firearms", "/api/armory/firearms", "/api/armory/ammunition"], tables: ["firearms", "firearm_assignments", "ammunition_lots", "ammunition_transactions"] },
  { code: "manage_inspections", displayName: "Manage Inspections", description: "Record and manage firearm inspections, malfunctions, maintenance, and armorer review steps.", actions: ["View", "Create", "Edit", "Approve"], modules: ["Firearm Inspections", "Personal Rifles"], routes: ["/firearms/inspections", "/api/armory/inspections", "/api/armory/personal-rifles"], tables: ["firearm_inspections", "firearm_malfunctions", "personal_rifles"] },
  { code: "approve_personal_rifles", displayName: "Approve Personal Rifles", description: "Perform final department approval, denial, and revocation of personally owned rifle requests after armorer review.", actions: ["View", "Approve"], modules: ["Personal Rifles"], routes: ["/personal-rifle-review", "/api/armory/personal-rifles"], tables: ["personal_rifles", "personal_rifle_status_history"] },
  { code: "manage_range_days", displayName: "Manage Range Days", description: "Create, edit, archive, lock, and manage range days, rosters, drill-library entries, and drill associations.", actions: ["View", "Create", "Edit", "Delete/Archive", "Configure"], modules: ["Range Days", "Drill Library"], routes: ["/range-days", "/api/pilot/range-workspace", "/api/drill-library"], tables: ["range_days", "drills", "range_day_drills", "pilot_range_workspaces"] },
  { code: "score_range_days", displayName: "Score Range Days", description: "Enter and update drill and qualification results for active, non-finalized range records.", actions: ["View", "Score"], modules: ["Range Days", "Qualification Scoring"], routes: ["/range-days", "/api/pilot/range-workspace"], tables: ["drill_run_results", "qualification_results"] },
  { code: "manage_qualifications", displayName: "Manage Qualifications", description: "Manage qualification standards, course versions, imported history, evidence, and qualification records.", actions: ["View", "Create", "Edit", "Delete/Archive", "Configure", "Export"], modules: ["Qualifications"], routes: ["/qualifications", "/api/qualifications"], tables: ["qualification_standards", "qualification_courses", "qualification_results"] },
  { code: "manage_certifications", displayName: "Manage Certifications", description: "Manage certification types, requirements, officer certification records, and certification evidence.", actions: ["View", "Create", "Edit", "Delete/Archive", "Configure", "Export"], modules: ["Certifications"], routes: ["/training/certifications", "/api/training/certifications"], tables: ["certification_types", "department_certification_requirements", "training_certifications"] },
  { code: "manage_training", displayName: "Manage Agency Training", description: "Create and manage agency training courses, events, rosters, attendance, closeout, remediation, and training exports.", actions: ["View", "Create", "Edit", "Delete/Archive", "Approve", "Export", "Configure"], modules: ["Agency Training", "Training Alerts"], routes: ["/agency-training", "/api/agency-training", "/api/pilot/remediations"], tables: ["agency_training_courses", "agency_training_events", "agency_training_attendees", "agency_training_requirements"] },
  { code: "manage_equipment", displayName: "Manage Equipment", description: "Create, edit, assign, archive, and remove equipment assets, types, and readiness requirements; members retain access to their own assignments.", actions: ["View", "Create", "Edit", "Delete/Archive", "Configure", "Export"], modules: ["Equipment", "Readiness"], routes: ["/equipment", "/api/equipment", "/api/readiness/equipment"], tables: ["equipment_assets", "equipment_types", "equipment_asset_assignments", "department_equipment_requirements"] },
  { code: "view_fleet", displayName: "View Fleet", description: "View department vehicles, readiness, inspections, maintenance, equipment, documents, and Fleet reports.", actions: ["View", "Export"], modules: ["Fleet"], routes: ["/fleet-management", "/api/fleet"], tables: ["fleet_vehicles", "fleet_vehicle_inspections", "fleet_work_orders"] },
  { code: "manage_fleet", displayName: "Manage Fleet", description: "Create and edit vehicles, vehicle status, assignments, equipment, documents, and Fleet operational records.", actions: ["View", "Create", "Edit", "Delete/Archive"], modules: ["Fleet"], routes: ["/fleet-management", "/api/fleet/vehicles"], tables: ["fleet_vehicles", "fleet_vehicle_equipment", "fleet_vehicle_documents"] },
  { code: "perform_fleet_inspections", displayName: "Perform Fleet Inspections", description: "Complete agency vehicle inspection workflows without receiving general Fleet editing rights.", actions: ["View", "Create"], modules: ["Fleet Inspections"], routes: ["/fleet-management", "/api/fleet/vehicles/*/inspections"], tables: ["fleet_vehicle_inspections"] },
  { code: "manage_fleet_maintenance", displayName: "Manage Fleet Maintenance", description: "Create, assign, update, and complete Fleet maintenance and repair work orders.", actions: ["View", "Create", "Edit", "Delete/Archive"], modules: ["Fleet Maintenance"], routes: ["/fleet-management", "/api/fleet/vehicles/*/work-orders"], tables: ["fleet_work_orders"] },
  { code: "manage_fleet_rules", displayName: "Manage Fleet Rules", description: "Configure Fleet rules, inspection templates, readiness behavior, network-detail visibility, and notification routing.", actions: ["View", "Configure"], modules: ["Fleet Settings"], routes: ["/settings/fleet", "/api/fleet/rules"], tables: ["fleet_rules"] },
  { code: "submit_off_duty_requests", displayName: "Submit Off-Duty Requests", description: "Create, edit, submit, correct, and resubmit the signed-in member's own off-duty firearm requests.", actions: ["View", "Create", "Edit"], modules: ["Off-Duty Firearms"], routes: ["/off-duty-firearms", "/api/off-duty-firearms"], tables: ["off_duty_firearm_requests", "off_duty_firearm_history"] },
  { code: "review_off_duty_requests", displayName: "Review Off-Duty Requests", description: "View department off-duty requests and approve, deny, return, revoke, or archive them.", actions: ["View", "Approve", "Delete/Archive"], modules: ["Off-Duty Firearms"], routes: ["/off-duty-firearms", "/api/off-duty-firearms"], tables: ["off_duty_firearm_requests", "off_duty_firearm_history"] },
  { code: "view_audit_log", displayName: "View Audit Log", description: "View and export department audit events; this does not grant permission to change records.", actions: ["View", "Export"], modules: ["Audit Log"], routes: ["/settings", "/api/settings/audit-log"], tables: ["audit_events"] },
  { code: "administer_department", displayName: "Administer Department", description: "Configure department profile, security, appearance, rules, permissions, imports, exports, and administrator assignments.", actions: ["View", "Create", "Edit", "Delete/Archive", "Approve", "Score", "Export", "Configure", "Administer"], modules: ["Settings", "Department Administration"], routes: ["/settings", "/api/settings"], tables: ["departments", "department_rules", "department_security_settings", "department_role_permissions"] },
] as const;

type RoutePermissionRule = { prefix: string; requirement: PermissionRequirement };
const ROUTE_PERMISSION_RULES: readonly RoutePermissionRule[] = [
  { prefix: "/firearms/ammunition/reconciliation", requirement: { anyOf: ["manage_firearms", "view_command_dashboard"] } },
  { prefix: "/firearms/ammunition", requirement: { anyOf: ["manage_firearms", "view_command_dashboard"] } },
  { prefix: "/firearms/inspections", requirement: { anyOf: ["manage_inspections", "manage_firearms", "view_command_dashboard"] } },
  { prefix: "/command-dashboard", requirement: { anyOf: ["view_command_dashboard"] } },
  { prefix: "/analytics", requirement: { anyOf: ["view_analytics"] } },
  { prefix: "/agency-training", requirement: {} },
  { prefix: "/training/certifications", requirement: {} },
  { prefix: "/training", requirement: {} },
  { prefix: "/training-alerts", requirement: { anyOf: TRAINING_ALERTS_MODULE_PERMISSIONS } },
  { prefix: "/range-days", requirement: {} },
  { prefix: "/qualifications", requirement: {} },
  { prefix: "/off-duty-firearms", requirement: { anyOf: ["submit_off_duty_requests", "review_off_duty_requests"] } },
  { prefix: "/personal-rifle-review", requirement: { anyOf: ["manage_inspections", "approve_personal_rifles"] } },
  { prefix: "/fleet-management", requirement: { anyOf: ["view_fleet", "manage_fleet", "perform_fleet_inspections", "manage_fleet_maintenance", "manage_fleet_rules"] } },
  { prefix: "/settings/import-export", requirement: { anyOf: ["administer_department"] } },
  { prefix: "/settings/fleet", requirement: { anyOf: ["manage_fleet_rules"] } },
  { prefix: "/settings", requirement: { anyOf: ["manage_users", "view_audit_log", "administer_department"] } },
];

export function isTracePointPermission(value: unknown): value is TracePointPermission {
  return typeof value === "string" && (TRACEPOINT_PERMISSIONS as readonly string[]).includes(value);
}

export function meetsPermissionRequirement(permissions: Iterable<TracePointPermission>, requirement?: PermissionRequirement) {
  if (!requirement) return true;
  const permissionSet = new Set(permissions);
  if (permissionSet.has("administer_department")) return true;
  const satisfiesAll = !requirement.allOf || requirement.allOf.every((permission) => permissionSet.has(permission));
  const satisfiesAny = !requirement.anyOf || requirement.anyOf.length === 0 || requirement.anyOf.some((permission) => permissionSet.has(permission));
  return satisfiesAll && satisfiesAny;
}

export function getRoutePermissionRequirement(pathname: string): PermissionRequirement | undefined {
  const normalizedPath = pathname.toLowerCase();
  return [...ROUTE_PERMISSION_RULES]
    .sort((left, right) => right.prefix.length - left.prefix.length)
    .find(({ prefix }) => normalizedPath === prefix.toLowerCase() || normalizedPath.startsWith(`${prefix.toLowerCase()}/`))
    ?.requirement;
}
