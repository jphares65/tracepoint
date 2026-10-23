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

type FleetRow = Record<string, unknown> | null | undefined;
export type FleetSafetyHold = { since: string; source: "inspection" | "work_order"; reason: string };

// A critical condition (an inspection with a critical defect, or a Critical or availability-affecting work order) holds the
// vehicle, even after that work order is completed or cancelled, until a later inspection records no critical defects or a
// fleet manager clears the hold (database/aws/046). It applies whatever the agency's automation and notification settings.
// database/aws/046 guard_fleet_safety_hold_status applies the same rule to every write of the vehicle's status; keep them in step.
export async function findSafetyHold(context: Parameters<typeof auditFleet>[0], vehicleId: string, vehicle: FleetRow): Promise<FleetSafetyHold | null> {
  const scoped = (table: string, columns: string) => context.admin.from(table).select(columns).eq("department_id", context.departmentId).eq("vehicle_id", vehicleId);
  const latest = (query: ReturnType<typeof scoped>) => query.order("created_at", { ascending: false }).limit(1).maybeSingle();
  const results: Array<{ data: FleetRow; error?: { message: string } | null }> = await Promise.all([
    latest(scoped("fleet_vehicle_inspections", "id,created_at").gt("critical_defect_count", 0)),
    latest(scoped("fleet_work_orders", "id,title,created_at").eq("priority", "Critical")),
    latest(scoped("fleet_work_orders", "id,title,created_at").eq("affects_availability", true)),
    latest(scoped("fleet_vehicle_inspections", "id,created_at").eq("critical_defect_count", 0)),
  ]);
  const readError = results.find((result) => result.error)?.error;
  if (readError) throw new Error(`Vehicle safety hold could not be checked: ${readError.message}`);
  const [inspection, priorityOrder, availabilityOrder, passed] = results.map((result) => result.data);
  const time = (value: unknown) => value ? new Date(value as string).getTime() : Number.NaN;
  const conditions = ([[inspection, "inspection"], [priorityOrder, "work_order"], [availabilityOrder, "work_order"]] as const).filter(([row]) => Number.isFinite(time(row?.created_at)));
  if (!conditions.length) return null;
  const [start, source] = conditions.reduce((a, b) => time(b[0]?.created_at) > time(a[0]?.created_at) ? b : a);
  const since = time(start?.created_at);
  if (time(passed?.created_at) > since || time(vehicle?.safety_hold_cleared_at) > since) return null;
  const recorded = new Date(since).toISOString().slice(0, 10);
  return {
    since: new Date(since).toISOString(),
    source,
    reason: `${source === "inspection" ? `Critical defect recorded by the inspection on ${recorded}` : `Critical work order "${String(start?.title ?? "")}" recorded on ${recorded}`}. The vehicle stays out of service until a later inspection records no critical defects or a fleet manager clears the hold.`,
  };
}

// The statuses the safety-hold guard (database/aws/057 guard_fleet_safety_hold_status) keeps a held vehicle
// from taking. A manual status update asking for one of them while a hold applies is refused before anything is
// written (AT-1): the guard would keep the status but save the override flag and reason, leaving the vehicle
// overridden Out of Service after the hold is released.
export const SAFETY_HOLD_RELEASING_STATUSES: ReadonlySet<string> = new Set(["Available", "Attention"]);

export async function findStatusBlockingSafetyHold(context: Parameters<typeof auditFleet>[0], vehicleId: string, vehicle: FleetRow, requestedStatus: unknown): Promise<FleetSafetyHold | null> {
  if (typeof requestedStatus !== "string" || !SAFETY_HOLD_RELEASING_STATUSES.has(requestedStatus) || requestedStatus === vehicle?.status) return null;
  return findSafetyHold(context, vehicleId, vehicle);
}

export const safetyHoldStatusRefusal = (hold: FleetSafetyHold) =>
  `This vehicle is under a safety hold and was not changed. ${hold.reason}`;

export async function refreshFleetVehicle(context: any, vehicleId: string) {
  const [rulesResult, workResult, equipmentResult, vehicleResult] = await Promise.all([
    context.admin.from("fleet_rules").select("*").eq("department_id", context.departmentId).maybeSingle(),
    context.admin.from("fleet_work_orders").select("id,priority,status,affects_availability").eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).not("status", "in", '("Completed","Cancelled")'),
    context.admin.from("fleet_vehicle_equipment").select("id,status,is_critical").eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).neq("status", "Removed"),
    // All columns: the clearance columns do not exist before database/aws/046.
    context.admin.from("fleet_vehicles").select("*").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle(),
  ]);
  const readError = rulesResult.error ?? workResult.error ?? equipmentResult.error ?? vehicleResult.error;
  if (readError) throw new Error(`Vehicle readiness could not be refreshed: ${readError.message}`);

  const rules = rulesResult.data ?? {};
  const work = workResult.data ?? [];
  const equipment = equipmentResult.data ?? [];
  const vehicle = vehicleResult.data;
  const criticalIssue = work.some((item: any) => item.priority === "Critical" || item.affects_availability === true);
  const criticalEquipment = equipment.some((item: any) => item.is_critical && ["Missing", "Out of Service"].includes(item.status));
  // Open critical work always holds; a recorded critical condition holds until verified or cleared. Both apply whatever
  // the automation settings, which govern only the rest of the readiness rules.
  const safetyHold = await findSafetyHold(context, vehicleId, vehicle);
  const criticalHold = criticalIssue || safetyHold !== null;
  const outOfService = criticalHold || (rules.critical_equipment_out_of_service !== false && criticalEquipment);
  const openIssueCount = work.length;

  let status = vehicle?.status ?? "Available";
  if (rules.status_automation_enabled === false) {
    // As with a manual override: an Available/Attention vehicle with a critical hold is taken out of service, nothing else changes.
    if (criticalHold && ["Available", "Attention"].includes(status)) status = "Out of Service";
  }
  else if (status !== "Retired") {
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
  return { status, openIssueCount, safetyHold };
}

// Open Critical or availability-affecting work orders; while any exists a safety hold cannot be cleared (database/aws/046).
export async function findOpenCriticalWorkOrders(context: Parameters<typeof auditFleet>[0], vehicleId: string): Promise<Array<{ id: string; title: string; created_at: string }>> {
  const { data, error } = await context.admin.from("fleet_work_orders").select("id,title,priority,affects_availability,created_at").eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).not("status", "in", '("Completed","Cancelled")');
  if (error) throw new Error(`Open critical work orders could not be checked: ${error.message}`);
  return (data ?? []).filter((item: FleetRow) => item?.priority === "Critical" || item?.affects_availability === true).map((item: FleetRow) => ({ id: String(item?.id), title: String(item?.title ?? ""), created_at: String(item?.created_at ?? "") }));
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
