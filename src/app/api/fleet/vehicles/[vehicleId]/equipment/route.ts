import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { auditFleet, canManageFleet, nullableDate, nullableText, numeric, refreshFleetVehicle, text } from "@/lib/tracepoint/fleet-server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ vehicleId: string }> }) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { data: rules } = await context.admin.from("fleet_rules").select("fleet_manager_role_codes").eq("department_id", context.departmentId).maybeSingle();
  if (!canManageFleet(context, rules)) return NextResponse.json({ error: "Fleet Manager access is required." }, { status: 403 });
  const { vehicleId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { data: vehicle } = await context.admin.from("fleet_vehicles").select("id").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle();
  if (!vehicle) return NextResponse.json({ error: "Vehicle was not found." }, { status: 404 });
  const linkedEquipmentAssetId = nullableText(body.linkedEquipmentAssetId, 100);
  if (linkedEquipmentAssetId) {
    const { data: existing } = await context.admin.from("fleet_vehicle_equipment").select("id,vehicle_id").eq("department_id", context.departmentId).eq("linked_equipment_asset_id", linkedEquipmentAssetId).neq("status", "Removed").limit(1).maybeSingle();
    if (existing) return NextResponse.json({ error: existing.vehicle_id === vehicleId ? "This equipment is already linked to this vehicle." : "This equipment is already linked to another vehicle." }, { status: 409 });
  }
  const name = text(body.name, 250);
  if (!name) return NextResponse.json({ error: "Equipment name is required." }, { status: 400 });
  const record = {
    department_id: context.departmentId, vehicle_id: vehicleId,
    source_type: body.sourceType === "Linked Inventory" ? "Linked Inventory" : "Fleet Checklist",
    linked_equipment_asset_id: linkedEquipmentAssetId,
    category: text(body.category, 150) || "General", name,
    make: nullableText(body.make, 150), model: nullableText(body.model, 150),
    year: numeric(body.year) || null, serial_number: nullableText(body.serialNumber, 250),
    tuning_fork_serial_number: nullableText(body.tuningForkSerialNumber, 250),
    warranty_expiration_date: nullableDate(body.warrantyExpirationDate),
    static_ip: nullableText(body.staticIp, 100), quantity: Math.max(1, Math.round(numeric(body.quantity, 1))),
    is_required: body.isRequired === true, is_critical: body.isCritical === true,
    status: ["Current","Attention","Missing","Out of Service","Removed"].includes(text(body.status)) ? text(body.status) : "Current",
    notes: nullableText(body.notes, 5000), created_by_user_id: context.user.id, updated_by_user_id: context.user.id,
  };
  const { data, error } = await context.admin.from("fleet_vehicle_equipment").insert(record).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try { await auditFleet(context, "fleet_vehicle_equipment_added", "fleet_vehicle", vehicleId, { equipment: data }); }
  catch (auditError) { await context.admin.from("fleet_vehicle_equipment").delete().eq("id", data.id); return NextResponse.json({ error: auditError instanceof Error ? auditError.message : "Audit failed." }, { status: 500 }); }
  await refreshFleetVehicle(context, vehicleId);
  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}
