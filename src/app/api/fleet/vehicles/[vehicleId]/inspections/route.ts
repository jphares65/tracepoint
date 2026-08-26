import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import {
  auditFleet,
  numeric,
  refreshFleetVehicle,
  text,
} from "@/lib/tracepoint/fleet-server";

export const dynamic = "force-dynamic";

const allowedConditions = new Set(["Pass", "Defect", "Critical"]);
const defaultChecklist = [
  { id: "body", label: "Body, windshield and mirrors" },
  { id: "tires", label: "Tires and wheels" },
  { id: "lights", label: "Lights, signals and siren" },
  { id: "controls", label: "Brakes, steering and controls" },
  { id: "fluids", label: "Fluids and visible leaks" },
  { id: "interior", label: "Seatbelts and interior condition" },
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> },
) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  const { vehicleId } = await params;
  const body = (await request.json().catch(() => ({}))) as any;

  const { data: vehicle, error: vehicleError } = await context.admin
    .from("fleet_vehicles")
    .select("id,unit_number,current_mileage,current_hours")
    .eq("department_id", context.departmentId)
    .eq("id", vehicleId)
    .maybeSingle();
  if (vehicleError || !vehicle)
    return NextResponse.json(
      { error: vehicleError?.message ?? "Vehicle was not found." },
      { status: vehicleError ? 500 : 404 },
    );

  const { data: rules } = await context.admin
    .from("fleet_rules")
    .select("*")
    .eq("department_id", context.departmentId)
    .maybeSingle();
  const permittedRoles = Array.isArray(rules?.inspection_role_codes)
    ? rules.inspection_role_codes
    : [];

  const userRoles = Array.isArray(context.roleCodes) ? context.roleCodes : [];

  const userPermissions = Array.isArray(context.permissions)
    ? context.permissions
    : [];

  const hasInspectionPermission =
    context.isSuperAdmin ||
    userPermissions.includes("administer_department") ||
    userPermissions.includes("perform_fleet_inspections") ||
    userPermissions.includes("manage_fleet") ||
    userPermissions.includes("manage_fleet_rules");

  if (
    permittedRoles.length &&
    !hasInspectionPermission &&
    !userRoles.some((role: string) => permittedRoles.includes(role))
  ) {
    return NextResponse.json(
      {
        error:
          "Your agency role or permissions do not allow vehicle inspections.",
      },
      { status: 403 },
    );
  }

  const rawChecklist = Array.isArray(body.checklist)
    ? body.checklist.slice(0, 200)
    : [];
  if (!rawChecklist.length)
    return NextResponse.json(
      { error: "The inspection checklist is required." },
      { status: 400 },
    );
  const submitted = new Map(
    rawChecklist.map((item: any) => [text(item?.id, 100), item]),
  );
  const configuredSource =
    Array.isArray(rules?.inspection_checklist) &&
    rules.inspection_checklist.length
      ? rules.inspection_checklist
      : defaultChecklist;

  const configured = configuredSource
    .filter((item: any) => item?.active !== false)
    .sort(
      (a: any, b: any) =>
        Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0),
    );
  const expected: any[] = configured.map((item: any, index: number) => ({
    id: text(item?.id, 100) || `item-${index + 1}`,
    label: text(item?.label, 200) || `Item ${index + 1}`,
    category: text(item?.category, 100) || "Vehicle Condition",
    equipmentId: null,
    required: item?.required !== false,
    critical: item?.critical === true,
    sort_order: Number(item?.sort_order ?? index + 1),
  }));
  if (rules?.inspection_include_required_equipment !== false) {
    const { data: equipment } = await context.admin
      .from("fleet_vehicle_equipment")
      .select("id,category,name,serial_number,status,is_required,is_critical")
      .eq("department_id", context.departmentId)
      .eq("vehicle_id", vehicleId)
      .or("is_required.eq.true,is_critical.eq.true")
      .neq("status", "Removed");
    for (const item of equipment ?? [])
      expected.push({
        id: `equipment:${item.id}`,
        label: `${item.category}: ${item.name}${item.serial_number ? ` · Serial ${item.serial_number}` : ""}`,
        category: item.category || "Required Equipment",
        equipmentId: item.id,
        required: true,
        critical: item.is_critical === true,
        existingStatus: item.status,
      });
  }
  const missingRequired = expected.filter(
    (expectedItem: any) =>
      expectedItem.required !== false && !submitted.has(expectedItem.id),
  );

  if (missingRequired.length) {
    return NextResponse.json(
      {
        error: `Complete all required inspection items: ${missingRequired
          .map((item: any) => item.label)
          .join(", ")}`,
      },
      { status: 400 },
    );
  }

  const checklist = expected
    .filter(
      (expectedItem: any) =>
        expectedItem.required !== false || submitted.has(expectedItem.id),
    )
    .map((expectedItem) => {
      const item: any = submitted.get(expectedItem.id) ?? {};
      return {
        ...expectedItem,
        condition: allowedConditions.has(item?.condition)
          ? item.condition === "Defect" && expectedItem.critical === true
            ? "Critical"
            : item.condition
          : expectedItem.existingStatus === "Out of Service"
            ? "Critical"
            : ["Missing", "Attention"].includes(expectedItem.existingStatus)
              ? expectedItem.critical === true
                ? "Critical"
                : "Defect"
              : "Pass",
        note: text(item?.note, 1000) || null,
      };
    });
  if (!checklist.length)
    return NextResponse.json(
      { error: "The agency inspection checklist is empty." },
      { status: 400 },
    );
  const defects = checklist.filter((item: any) => item.condition !== "Pass");
  const critical = defects.filter((item: any) => item.condition === "Critical");
  if (defects.some((item: any) => !item.note))
    return NextResponse.json(
      { error: "Add a short note for each defect." },
      { status: 400 },
    );

  const mileage = Math.round(
    numeric(body.mileage, vehicle.current_mileage ?? 0),
  );
  const hours = numeric(body.hours, vehicle.current_hours ?? 0);
  const result = critical.length
    ? "Failed"
    : defects.length
      ? "Passed with Defects"
      : "Passed";
  const record = {
    department_id: context.departmentId,
    vehicle_id: vehicleId,
    inspection_type: text(body.inspectionType, 100) || "Pre-Shift",
    result,
    mileage,
    hours,
    checklist,
    defect_count: defects.length,
    critical_defect_count: critical.length,
    notes: text(body.notes, 5000) || null,
    inspector_user_id: context.user.id,
  };

  const { data: inspection, error } = await context.admin
    .from("fleet_vehicle_inspections")
    .insert(record)
    .select("*")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  for (const item of checklist.filter((entry: any) => entry.equipmentId)) {
    const status =
      item.condition === "Pass"
        ? "Current"
        : item.condition === "Critical"
          ? "Out of Service"
          : "Attention";
    await context.admin
      .from("fleet_vehicle_equipment")
      .update({
        status,
        updated_by_user_id: context.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("department_id", context.departmentId)
      .eq("vehicle_id", vehicleId)
      .eq("id", item.equipmentId);
  }

  let workOrder = null;
  if (defects.length && rules?.inspection_defect_creates_work_order !== false) {
    const description = defects
      .map((item: any) => `${item.label}: ${item.note}`)
      .join("\n");
    const { data } = await context.admin
      .from("fleet_work_orders")
      .insert({
        department_id: context.departmentId,
        vehicle_id: vehicleId,
        record_type: "Inspection",
        title: `${record.inspection_type} inspection defects`,
        description,
        priority: critical.length ? "Critical" : "High",
        status: "Open",
        affects_availability:
          critical.length > 0 &&
          rules?.inspection_critical_out_of_service !== false,
        assigned_role_code:
          (rules?.mechanic_role_codes ?? ["mechanic"])[0] ?? "mechanic",
        mileage,
        hours,
        created_by_user_id: context.user.id,
        updated_by_user_id: context.user.id,
      })
      .select("*")
      .single();
    workOrder = data;
  }

  const frequencyDays = Math.max(
    1,
    Math.round(numeric(rules?.inspection_frequency_days, 1)),
  );
  const nextDue = new Date();
  nextDue.setUTCDate(nextDue.getUTCDate() + frequencyDays);
  await context.admin
    .from("fleet_vehicles")
    .update({
      current_mileage: Math.max(mileage, Number(vehicle.current_mileage) || 0),
      current_hours: Math.max(hours, Number(vehicle.current_hours) || 0),
      inspection_due_date: nextDue.toISOString().slice(0, 10),
      updated_by_user_id: context.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("department_id", context.departmentId)
    .eq("id", vehicleId);

  await auditFleet(
    context,
    "fleet_vehicle_inspected",
    "fleet_vehicle",
    vehicleId,
    { inspection, work_order_id: workOrder?.id ?? null },
  );
  const readiness = await refreshFleetVehicle(context, vehicleId);
  return NextResponse.json(
    { ok: true, inspection, workOrder, readiness },
    { status: 201 },
  );
}
