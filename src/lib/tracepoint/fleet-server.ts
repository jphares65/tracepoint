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

// Vehicle inspections and issue reports. The same rule is
// public.can_submit_fleet_inspection (database/aws/045); the session already
// belongs to an active member.
type FleetAccess = { permissions?: unknown; roleCodes?: unknown; isSuperAdmin?: boolean } | null | undefined;
export function canSubmitFleetInspection(context: FleetAccess, rules?: { inspection_role_codes?: unknown } | null) {
  const permissions: unknown[] = Array.isArray(context?.permissions) ? context.permissions : [];
  if (context?.isSuperAdmin || ["manage_fleet", "administer_department", "perform_fleet_inspections"].some((code) => permissions.includes(code)))
    return true;
  const inspectionRoles: unknown[] = Array.isArray(rules?.inspection_role_codes) ? rules.inspection_role_codes : [];
  if (!inspectionRoles.length) return permissions.includes("view_fleet");
  const roleCodes: unknown[] = Array.isArray(context?.roleCodes) ? context.roleCodes : [];
  return roleCodes.some((role) => inspectionRoles.includes(role));
}

// Maintenance cost information goes only to fleet managers, mechanics and administrators.
export function canViewFleetCosts(context: FleetAccess) {
  return canPerformFleetMaintenance(context);
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
  // A critical inspection whose defect work order was never created is still an unresolved critical defect.
  let unrecordedCriticalInspection = false;
  if (rules.inspection_defect_creates_work_order !== false) {
    const { data: latest, error: inspectionError } = await context.admin.from("fleet_vehicle_inspections").select("id,critical_defect_count,created_at").eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (inspectionError) throw new Error(`Vehicle readiness could not be refreshed: ${inspectionError.message}`);
    if (Number(latest?.critical_defect_count) > 0) {
      const { data: defectOrders, error: defectError } = await context.admin.from("fleet_work_orders").select("id").eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).eq("record_type", "Inspection").gte("created_at", latest.created_at).limit(1);
      if (defectError) throw new Error(`Vehicle readiness could not be refreshed: ${defectError.message}`);
      unrecordedCriticalInspection = !defectOrders?.length;
    }
  }
  const outOfService = (rules.critical_issue_out_of_service !== false && (criticalIssue || unrecordedCriticalInspection)) || (rules.critical_equipment_out_of_service !== false && criticalEquipment);
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

type FleetContext = Parameters<typeof auditFleet>[0];
const missingFunction = (error: { code?: unknown } | null | undefined) => ["42883", "PGRST202"].includes(String(error?.code ?? ""));

export type FleetAuditOutcome = { status: "recorded" } | { status: "pending" | "unrecorded"; message: string };

// The inspection's audit entry is queued with the inspection (database/aws/043) and
// delivered here. Without the outbox (bridge mode) it is written directly. A failure
// never reverses the inspection; it is reported as pending (queued) or unrecorded.
export async function recordInspectionAudit(context: FleetContext, inspection: { id: string; vehicle_id: string }, workOrderId: string | null): Promise<FleetAuditOutcome> {
  const { data, error } = await context.admin.rpc("deliver_fleet_audit_outbox", { p_inspection_id: inspection.id, p_details: { work_order_id: workOrderId } });
  if (!error && data !== null && data !== undefined) return { status: "recorded" };
  if (!error || !missingFunction(error)) {
    console.error("Fleet inspection audit delivery failed; entry remains queued.", { inspectionId: inspection.id, error: error?.message ?? "not delivered" });
    return { status: "pending", message: "The inspection was saved, but its audit entry could not be recorded yet. It is queued and will be recorded automatically the next time fleet records are used." };
  }
  try {
    await auditFleet(context, "fleet_vehicle_inspected", "fleet_vehicle", inspection.vehicle_id, { inspection, work_order_id: workOrderId });
    return { status: "recorded" };
  } catch (auditError) {
    console.error("Fleet inspection audit entry could not be recorded.", { inspectionId: inspection.id, error: auditError instanceof Error ? auditError.message : auditError });
    return { status: "unrecorded", message: "The inspection was saved, but its audit entry could not be recorded or queued. Tell a fleet manager so the audit history can be completed." };
  }
}

// Retries queued inspection audit entries for the agency; failures are only logged.
export async function reconcileFleetAudit(context: FleetContext) {
  try {
    const { error } = await context.admin.rpc("deliver_pending_fleet_audit", { p_department_id: context.departmentId });
    if (error && !missingFunction(error)) console.error("Queued fleet audit entries could not be reconciled.", { error: error.message });
  } catch (error) {
    console.error("Queued fleet audit entries could not be reconciled.", { error: error instanceof Error ? error.message : error });
  }
}
