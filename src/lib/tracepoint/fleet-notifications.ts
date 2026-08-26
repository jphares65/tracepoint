import "server-only";

function dateValue(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export async function collectFleetNotifications(context: any) {
  const roles = Array.isArray(context.roleCodes) ? context.roleCodes : [];
  const permissions = Array.isArray(context.permissions) ? context.permissions : [];
  const [rulesResult, vehicleResult, workResult, equipmentResult] = await Promise.all([
    context.admin.from("fleet_rules").select("*").eq("department_id", context.departmentId).maybeSingle(),
    context.admin.from("fleet_vehicles").select("id,unit_number,status,next_service_date,next_service_mileage,next_service_hours,current_mileage,current_hours,inspection_due_date,registration_expiration_date").eq("department_id", context.departmentId).neq("status", "Retired"),
    context.admin.from("fleet_work_orders").select("id,vehicle_id,record_type,title,priority,status,due_date,assigned_role_code,assigned_user_id,reported_at").eq("department_id", context.departmentId).not("status", "in", '("Completed","Cancelled")'),
    context.admin.from("fleet_vehicle_equipment").select("id,vehicle_id,name,status,is_required,is_critical,warranty_expiration_date").eq("department_id", context.departmentId).neq("status", "Removed"),
  ]);
  for (const result of [rulesResult, vehicleResult, workResult, equipmentResult]) if (result.error && result.error.code !== "42P01") throw new Error(result.error.message);
  if (vehicleResult.error?.code === "42P01") return [];

  const rules = rulesResult.data ?? {};
  const managerRoles = rules.fleet_manager_role_codes ?? ["fleet_manager"];
  const mechanicRoles = rules.mechanic_role_codes ?? ["mechanic", "fleet_mechanic"];
  const isManager =
    context.isSuperAdmin ||
    permissions.includes("administer_department") ||
    permissions.includes("manage_fleet") ||
    permissions.includes("manage_fleet_rules") ||
    roles.some((role: string) => managerRoles.includes(role));

  const isMechanic =
    permissions.includes("manage_fleet_maintenance") ||
    roles.some((role: string) => mechanicRoles.includes(role));
  if (!isManager && !isMechanic) return [];

  const vehicles = new Map((vehicleResult.data ?? []).map((vehicle: any) => [vehicle.id, vehicle]));
  const alerts: any[] = [];
  const now = Date.now();
  const warningDays = Number(rules.due_soon_days ?? 30);
  const warningLimit = now + warningDays * 86400000;

  for (const item of workResult.data ?? []) {
    const assignedToUser = item.assigned_user_id && item.assigned_user_id === context.user.id;
    const assignedToRole = item.assigned_role_code && roles.includes(item.assigned_role_code);
    const mechanicNotificationEnabled = item.record_type === "Issue"
      ? rules.notify_mechanic_on_issue_report !== false
      : item.record_type === "Inspection"
        ? rules.notify_mechanic_on_inspection_defect !== false
        : true;
    const mechanicEligible = isMechanic && mechanicNotificationEnabled;
    const explicitlyAssigned = assignedToUser || (assignedToRole && (!isMechanic || mechanicNotificationEnabled));
    if (!isManager && !explicitlyAssigned && !mechanicEligible) continue;
    const vehicle: any = vehicles.get(item.vehicle_id);
    alerts.push({
      key: `fleet-work-${context.user.id}-${item.id}`,
      source: "Fleet",
      kind: item.priority === "Critical" ? "fleet_critical_issue" : "fleet_work_assigned",
      title: `${vehicle ? `Unit ${vehicle.unit_number}: ` : ""}${item.title}`,
      detail: `${item.status} · ${item.priority} priority${item.due_date ? ` · Due ${item.due_date}` : ""}`,
      href: `/fleet-management/${item.vehicle_id}?tab=maintenance`,
      priority: item.priority === "Critical" ? "Critical" : item.priority === "High" ? "High" : "Normal",
      createdAt: item.reported_at,
    });
  }

  if (isManager) for (const vehicle of vehicleResult.data ?? []) {
    if (rules.notify_fleet_manager_on_status_change !== false && ["Attention", "Maintenance", "Out of Service"].includes(vehicle.status)) alerts.push({
      key: `fleet-status-${context.user.id}-${vehicle.id}-${vehicle.status.toLowerCase().replaceAll(" ", "-")}`,
      source: "Fleet",
      kind: "fleet_vehicle_status",
      title: `Unit ${vehicle.unit_number}: ${vehicle.status}`,
      detail: vehicle.status === "Out of Service" ? "This vehicle is unavailable and requires Fleet follow-up." : `Vehicle status changed to ${vehicle.status} and remains unresolved.`,
      href: `/fleet-management/${vehicle.id}`,
      priority: vehicle.status === "Out of Service" ? "Critical" : vehicle.status === "Maintenance" ? "High" : "Normal",
      createdAt: null,
    });
    const dueDates = [["service", vehicle.next_service_date], ["inspection", vehicle.inspection_due_date], ["registration", vehicle.registration_expiration_date]] as const;
    for (const [kind, date] of dueDates) if (date && dateValue(date) <= warningLimit) alerts.push({ key: `fleet-${kind}-${context.user.id}-${vehicle.id}`, source: "Fleet", kind: `fleet_${kind}_due`, title: `Unit ${vehicle.unit_number} ${kind[0].toUpperCase()}${kind.slice(1)} ${dateValue(date) < now ? "Overdue" : "Due Soon"}`, detail: `Configured date: ${date}`, href: `/fleet-management/${vehicle.id}`, priority: dateValue(date) < now ? "Critical" : "High", createdAt: date });
    if (vehicle.next_service_mileage && Number(vehicle.current_mileage) >= Number(vehicle.next_service_mileage)) alerts.push({ key: `fleet-service-mileage-${context.user.id}-${vehicle.id}`, source: "Fleet", kind: "fleet_service_mileage_due", title: `Unit ${vehicle.unit_number} Service Mileage Reached`, detail: `${Number(vehicle.current_mileage).toLocaleString()} miles recorded; service target was ${Number(vehicle.next_service_mileage).toLocaleString()}.`, href: `/fleet-management/${vehicle.id}`, priority: "High", createdAt: null });
    if (vehicle.next_service_hours && Number(vehicle.current_hours) >= Number(vehicle.next_service_hours)) alerts.push({ key: `fleet-service-hours-${context.user.id}-${vehicle.id}`, source: "Fleet", kind: "fleet_service_hours_due", title: `Unit ${vehicle.unit_number} Service Hours Reached`, detail: `${Number(vehicle.current_hours).toLocaleString()} hours recorded; service target was ${Number(vehicle.next_service_hours).toLocaleString()}.`, href: `/fleet-management/${vehicle.id}`, priority: "High", createdAt: null });
  }

  for (const item of equipmentResult.data ?? []) if ((item.is_required || item.is_critical) && ["Missing","Out of Service"].includes(item.status)) { const vehicle: any = vehicles.get(item.vehicle_id); alerts.push({ key: `fleet-equipment-${context.user.id}-${item.id}`, source: "Fleet", kind: "fleet_required_equipment_unavailable", title: `${vehicle ? `Unit ${vehicle.unit_number}: ` : ""}${item.name} ${item.status}`, detail: item.is_critical ? "Critical vehicle equipment requires immediate action." : "Required vehicle equipment requires follow-up.", href: `/fleet-management/${item.vehicle_id}?tab=equipment`, priority: item.is_critical ? "Critical" : "High", createdAt: null }); }
  return alerts;
}
