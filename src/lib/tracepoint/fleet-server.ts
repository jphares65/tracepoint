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

// A reading that is blank, null or not a number was not provided; null, not zero.
export function optionalNumeric(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const parsed = numeric(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

export function canConfigureFleet(context: any) {
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  return Boolean(
    context?.isSuperAdmin ||
      permissions.includes("administer_department") ||
      permissions.includes("manage_fleet_rules")
  );
}

export function canManageFleet(context: any, rules?: unknown) {
  void rules;
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  return Boolean(
    context?.isSuperAdmin ||
      permissions.includes("administer_department") ||
      permissions.includes("manage_fleet")
  );
}

export function canPerformFleetMaintenance(context: any, rules?: any) {
  void rules;
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  return Boolean(
    canManageFleet(context, rules) ||
      permissions.includes("manage_fleet_maintenance")
  );
}

export function canViewNetworkDetails(context: any, rules?: any) {
  void rules;
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  return Boolean(
    context?.isSuperAdmin ||
      permissions.includes("administer_department") ||
      permissions.includes("manage_fleet") ||
      permissions.includes("manage_fleet_rules"),
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
  const readError = rulesResult.error ?? workResult.error ?? equipmentResult.error;
  if (readError) throw new Error(`Vehicle readiness could not be refreshed: ${readError.message}`);

  const rules = rulesResult.data ?? {};
  const work = workResult.data ?? [];
  const equipment = equipmentResult.data ?? [];
  const criticalIssue = work.some((item: any) => item.priority === "Critical" || item.affects_availability === true);
  const criticalEquipment = equipment.some((item: any) => item.is_critical && ["Missing", "Out of Service"].includes(item.status));
  const outOfService = (rules.critical_issue_out_of_service !== false && criticalIssue) || (rules.critical_equipment_out_of_service !== false && criticalEquipment);
  const openIssueCount = work.length;

  const { data: vehicle, error: vehicleError } = await context.admin.from("fleet_vehicles").select("status,status_override_active").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle();
  if (vehicleError) throw new Error(`Vehicle readiness could not be refreshed: ${vehicleError.message}`);
  let status = vehicle?.status ?? "Available";
  if (rules.status_automation_enabled !== false && status !== "Retired") {
    if (vehicle?.status_override_active === true) {
      // A manual override never masks a critical condition: an overridden Available/Attention vehicle is still taken out of service.
      // Manager-set Maintenance, Out of Service and Retired are left alone, and the override stays active.
      if (outOfService && ["Available", "Attention"].includes(status)) status = "Out of Service";
    }
    else if (outOfService) status = "Out of Service";
    else if (work.some((item: any) => ["Assigned", "Scheduled", "In Progress", "Awaiting Parts"].includes(item.status))) status = "Maintenance";
    else if (openIssueCount > 0 || equipment.some((item: any) => item.status === "Attention")) status = "Attention";
    else status = "Available";
  }

  const { error: updateError } = await context.admin.from("fleet_vehicles").update({ status, open_issue_count: openIssueCount, updated_at: new Date().toISOString() }).eq("department_id", context.departmentId).eq("id", vehicleId);
  if (updateError) throw new Error(`Vehicle readiness could not be refreshed: ${updateError.message}`);
  return { status, openIssueCount };
}
