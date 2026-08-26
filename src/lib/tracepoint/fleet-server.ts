import "server-only";

export function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function nullableText(value: unknown, max = 1000) {
  return text(value, max) || null;
}

export function nullableDate(value: unknown) {
  const valueText = text(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : null;
}

export function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function rolesFor(context: any) {
  return Array.isArray(context?.roleCodes) ? context.roleCodes : [];
}

function hasAnyRole(context: any, configured: unknown, fallback: string[]) {
  const allowed = Array.isArray(configured) && configured.length ? configured : fallback;
  return rolesFor(context).some((role: string) => allowed.includes(role));
}

export function canConfigureFleet(context: any) {
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  return Boolean(
    context?.isSuperAdmin ||
      permissions.includes("administer_department") ||
      permissions.includes("manage_fleet_rules")
  );
}

export function canManageFleet(context: any, rules?: any) {
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  return Boolean(
    canConfigureFleet(context) ||
      permissions.includes("manage_fleet") ||
      hasAnyRole(context, rules?.fleet_manager_role_codes, ["fleet_manager"])
  );
}

export function canPerformFleetMaintenance(context: any, rules?: any) {
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  return Boolean(
    canManageFleet(context, rules) ||
      permissions.includes("manage_fleet_maintenance") ||
      hasAnyRole(context, rules?.mechanic_role_codes, ["mechanic", "fleet_mechanic"])
  );
}

export function canViewNetworkDetails(context: any, rules?: any) {
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  const roles = Array.isArray(context?.roleCodes) ? context.roleCodes : [];
  return Boolean(
    context?.isSuperAdmin ||
      permissions.includes("administer_department") ||
      hasAnyRole(context, rules?.fleet_manager_role_codes, ["fleet_manager"]) ||
      roles.some((role: string) => ["it", "it_manager"].includes(role)),
  );
}

export async function auditFleet(
  context: any,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  const { error } = await context.admin.from("audit_events").insert({
    department_id: context.departmentId,
    actor_user_id: context.user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details: { ...details, support_mode: context.isSupportMode === true },
  });
  if (error) throw new Error(`Audit record failed: ${error.message}`);
}

export async function refreshFleetVehicle(context: any, vehicleId: string) {
  const [rulesResult, workResult, equipmentResult] = await Promise.all([
    context.admin.from("fleet_rules").select("*").eq("department_id", context.departmentId).maybeSingle(),
    context.admin.from("fleet_work_orders").select("id,priority,status,affects_availability").eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).not("status", "in", '("Completed","Cancelled")'),
    context.admin.from("fleet_vehicle_equipment").select("id,status,is_critical").eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).neq("status", "Removed"),
  ]);

  const rules = rulesResult.data ?? {};
  const work = workResult.data ?? [];
  const equipment = equipmentResult.data ?? [];
  const criticalIssue = work.some((item: any) => item.priority === "Critical" || item.affects_availability === true);
  const criticalEquipment = equipment.some((item: any) => item.is_critical && ["Missing", "Out of Service"].includes(item.status));
  const openIssueCount = work.length;

  const { data: vehicle } = await context.admin.from("fleet_vehicles").select("status,status_override_active").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle();
  let status = vehicle?.status ?? "Available";
  if (rules.status_automation_enabled !== false && status !== "Retired" && vehicle?.status_override_active !== true) {
    if ((rules.critical_issue_out_of_service !== false && criticalIssue) || (rules.critical_equipment_out_of_service !== false && criticalEquipment)) status = "Out of Service";
    else if (work.some((item: any) => ["Assigned", "Scheduled", "In Progress", "Awaiting Parts"].includes(item.status))) status = "Maintenance";
    else if (openIssueCount > 0 || equipment.some((item: any) => item.status === "Attention")) status = "Attention";
    else status = "Available";
  }

  await context.admin.from("fleet_vehicles").update({ status, open_issue_count: openIssueCount, updated_at: new Date().toISOString() }).eq("department_id", context.departmentId).eq("id", vehicleId);
  return { status, openIssueCount };
}
