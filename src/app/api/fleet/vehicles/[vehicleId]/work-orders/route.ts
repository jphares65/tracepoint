import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { auditFleet, canPerformFleetMaintenance, nullableDate, nullableText, numeric, refreshFleetVehicle, text } from "@/lib/tracepoint/fleet-server";

const maintenanceTypes = new Set(["Preventive Maintenance", "Repair", "Recall"]);
const statuses = new Set(["Open", "Assigned", "Scheduled", "In Progress", "Awaiting Parts", "Completed", "Cancelled"]);
const priorities = new Set(["Normal", "High", "Critical"]);

async function updateVehicleService(context: any, vehicleId: string, body: any, completed: boolean) {
  const update: Record<string, unknown> = { updated_by_user_id: context.user.id, updated_at: new Date().toISOString() };
  if (body.mileage !== undefined) update.current_mileage = Math.round(numeric(body.mileage));
  if (body.hours !== undefined) update.current_hours = numeric(body.hours);
  if (body.nextServiceDate !== undefined) update.next_service_date = nullableDate(body.nextServiceDate);
  if (body.nextServiceMileage !== undefined) update.next_service_mileage = numeric(body.nextServiceMileage) || null;
  if (body.nextServiceHours !== undefined) update.next_service_hours = numeric(body.nextServiceHours) || null;
  if (completed) {
    update.last_service_date = new Date().toISOString().slice(0, 10);
    update.last_service_mileage = Math.round(numeric(body.mileage)) || null;
    update.last_service_hours = numeric(body.hours) || null;
  }
  await context.admin.from("fleet_vehicles").update(update).eq("department_id", context.departmentId).eq("id", vehicleId);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { vehicleId } = await params;
  const body = (await request.json().catch(() => ({}))) as any;
  const { data: vehicle } = await context.admin.from("fleet_vehicles").select("id").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle();
  if (!vehicle) return NextResponse.json({ error: "Vehicle was not found." }, { status: 404 });
  const { data: rules } = await context.admin.from("fleet_rules").select("*").eq("department_id", context.departmentId).maybeSingle();
  const requestedType = text(body.recordType);
  const isIssue = requestedType === "Issue" || !requestedType;
  const canMaintain = canPerformFleetMaintenance(context, rules);
  if (!isIssue && !canMaintain) return NextResponse.json({ error: "Mechanic or Fleet Manager access is required to add maintenance." }, { status: 403 });
  const title = text(body.title, 250);
  if (!title) return NextResponse.json({ error: "Issue or maintenance title is required." }, { status: 400 });
  const status = canMaintain && statuses.has(text(body.status)) ? text(body.status) : "Open";
  const priority = priorities.has(text(body.priority)) ? text(body.priority) : "Normal";
  const assignedRole = isIssue ? (rules?.mechanic_role_codes ?? ["mechanic"])[0] ?? "mechanic" : nullableText(body.assignedRoleCode, 100) ?? (rules?.mechanic_role_codes ?? ["mechanic"])[0] ?? "mechanic";
  const record = {
    department_id: context.departmentId,
    vehicle_id: vehicleId,
    record_type: isIssue ? "Issue" : maintenanceTypes.has(requestedType) ? requestedType : "Preventive Maintenance",
    issue_category: isIssue ? nullableText(body.issueCategory, 100) : null,
    title,
    description: nullableText(body.description, 5000),
    priority,
    status,
    affects_availability: body.affectsAvailability === true,
    assigned_role_code: assignedRole,
    mechanic_name: canMaintain ? nullableText(body.mechanicName, 200) : null,
    vendor: canMaintain ? nullableText(body.vendor, 200) : null,
    mileage: Math.round(numeric(body.mileage)) || null,
    hours: numeric(body.hours) || null,
    scheduled_for: canMaintain ? nullableDate(body.scheduledFor) : null,
    due_date: canMaintain ? nullableDate(body.dueDate) : null,
    labor_cost: canMaintain ? numeric(body.laborCost) || null : null,
    parts_cost: canMaintain ? numeric(body.partsCost) || null : null,
    total_cost: canMaintain ? numeric(body.totalCost) || null : null,
    resolution: canMaintain ? nullableText(body.resolution, 5000) : null,
    notes: nullableText(body.notes, 5000),
    started_at: status === "In Progress" ? new Date().toISOString() : null,
    completed_at: status === "Completed" ? new Date().toISOString() : null,
    created_by_user_id: context.user.id,
    updated_by_user_id: context.user.id,
  };
  const { data, error } = await context.admin.from("fleet_work_orders").insert(record).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try { await auditFleet(context, isIssue ? "fleet_issue_reported" : "fleet_maintenance_created", "fleet_vehicle", vehicleId, { work_order: data }); }
  catch (auditError) { await context.admin.from("fleet_work_orders").delete().eq("id", data.id); return NextResponse.json({ error: auditError instanceof Error ? auditError.message : "Audit failed." }, { status: 500 }); }
  await updateVehicleService(context, vehicleId, body, status === "Completed" && !isIssue);
  const readiness = await refreshFleetVehicle(context, vehicleId);
  return NextResponse.json({ ok: true, item: data, readiness }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { vehicleId } = await params;
  const body = (await request.json().catch(() => ({}))) as any;
  const { data: rules } = await context.admin.from("fleet_rules").select("*").eq("department_id", context.departmentId).maybeSingle();
  if (!canPerformFleetMaintenance(context, rules)) return NextResponse.json({ error: "Mechanic or Fleet Manager access is required." }, { status: 403 });
  const id = text(body.id, 100);
  const reason = text(body.reason, 1000);
  if (!id || !reason) return NextResponse.json({ error: "Work-order ID and update reason are required." }, { status: 400 });
  const { data: previous } = await context.admin.from("fleet_work_orders").select("*").eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).eq("id", id).maybeSingle();
  if (!previous) return NextResponse.json({ error: "Work order was not found." }, { status: 404 });
  const status = statuses.has(text(body.status)) ? text(body.status) : previous.status;
  const update: Record<string, unknown> = {
    record_type: maintenanceTypes.has(text(body.recordType)) ? text(body.recordType) : previous.record_type,
    title: text(body.title, 250) || previous.title,
    description: body.description !== undefined ? nullableText(body.description, 5000) : previous.description,
    priority: priorities.has(text(body.priority)) ? text(body.priority) : previous.priority,
    status,
    affects_availability: body.affectsAvailability !== undefined ? body.affectsAvailability === true : previous.affects_availability,
    assigned_role_code: body.assignedRoleCode !== undefined ? nullableText(body.assignedRoleCode, 100) : previous.assigned_role_code,
    mechanic_name: body.mechanicName !== undefined ? nullableText(body.mechanicName, 200) : previous.mechanic_name,
    vendor: body.vendor !== undefined ? nullableText(body.vendor, 200) : previous.vendor,
    mileage: body.mileage !== undefined ? Math.round(numeric(body.mileage)) || null : previous.mileage,
    hours: body.hours !== undefined ? numeric(body.hours) || null : previous.hours,
    scheduled_for: body.scheduledFor !== undefined ? nullableDate(body.scheduledFor) : previous.scheduled_for,
    due_date: body.dueDate !== undefined ? nullableDate(body.dueDate) : previous.due_date,
    resolution: body.resolution !== undefined ? nullableText(body.resolution, 5000) : previous.resolution,
    notes: body.notes !== undefined ? nullableText(body.notes, 5000) : previous.notes,
    labor_cost: body.laborCost !== undefined ? numeric(body.laborCost) || null : previous.labor_cost,
    parts_cost: body.partsCost !== undefined ? numeric(body.partsCost) || null : previous.parts_cost,
    total_cost: body.totalCost !== undefined ? numeric(body.totalCost) || null : previous.total_cost,
    started_at: status === "In Progress" && !previous.started_at ? new Date().toISOString() : previous.started_at,
    completed_at: status === "Completed" ? previous.completed_at ?? new Date().toISOString() : null,
    updated_by_user_id: context.user.id,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await context.admin.from("fleet_work_orders").update(update).eq("department_id", context.departmentId).eq("vehicle_id", vehicleId).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try { await auditFleet(context, "fleet_work_order_updated", "fleet_vehicle", vehicleId, { reason, previous, current: data }); }
  catch (auditError) { return NextResponse.json({ error: auditError instanceof Error ? auditError.message : "Audit failed." }, { status: 500 }); }
  await updateVehicleService(context, vehicleId, body, status === "Completed" && previous.record_type !== "Issue");
  const readiness = await refreshFleetVehicle(context, vehicleId);
  return NextResponse.json({ ok: true, item: data, readiness });
}
