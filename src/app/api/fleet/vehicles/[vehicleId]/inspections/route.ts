/* eslint-disable @typescript-eslint/no-explicit-any -- legacy dynamic database boundary */
import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  featureDisabledResponse,
  hasServerFeature,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { FLEET_WORK_ORDER_FIELDS_WITHOUT_COST } from "@/lib/fleet/read-repository-core";
import {
  canSubmitFleetInspection,
  canViewFleetCosts,
  numeric,
  optionalNumeric,
  reconcileFleetAudit,
  recordInspectionAudit,
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
  const access = await resolveServerAccess(request);
  if (!access.ok) return accessFailureResponse(access);
  const context = access.context;
  if (!hasServerFeature(context, "fleet")) return featureDisabledResponse("Fleet");
  const { vehicleId } = await params;
  const body = (await request.json().catch(() => ({}))) as any;
  await reconcileFleetAudit(context);

  const { data: rules, error: rulesError } = await context.admin
    .from("fleet_rules")
    .select("*")
    .eq("department_id", context.departmentId)
    .maybeSingle();
  if (rulesError) {
    return NextResponse.json(
      { error: "Fleet inspection authorization could not be verified." },
      { status: 500 },
    );
  }
  // One eligibility rule shared with the database (public.can_submit_fleet_inspection, migration 055).
  if (!canSubmitFleetInspection(context, rules)) {
    return permissionDeniedResponse("Your agency role or permissions do not allow vehicle inspections.");
  }

  const { data: vehicle, error: vehicleError } = await context.admin
    .from("fleet_vehicles")
    .select("id,unit_number,current_mileage,current_hours,inspection_due_date,status,open_issue_count")
    .eq("department_id", context.departmentId)
    .eq("id", vehicleId)
    .maybeSingle();
  if (vehicleError || !vehicle)
    return NextResponse.json(
      { error: vehicleError?.message ?? "Vehicle was not found." },
      { status: vehicleError ? 500 : 404 },
    );

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

  const inspected = expected.filter(
    (expectedItem: any) =>
      expectedItem.required !== false || submitted.has(expectedItem.id),
  );
  // UX-RB2-1 (C33): every item needs an explicit Pass, Defect or Critical. An
  // unanswered item is never saved as Pass or inferred from the equipment record.
  const unanswered = inspected.filter(
    (expectedItem: any) =>
      !allowedConditions.has((submitted.get(expectedItem.id) as any)?.condition),
  );
  if (unanswered.length) {
    return NextResponse.json(
      {
        error: `Choose Pass, Defect or Critical for: ${unanswered
          .map((item: any) => item.label)
          .join(", ")}`,
        code: "inspection_items_not_answered",
        items: unanswered.map((item: any) => ({ id: item.id, label: item.label })),
      },
      { status: 400 },
    );
  }

  const checklist = inspected.map((expectedItem) => {
    const item: any = submitted.get(expectedItem.id);
    return {
      ...expectedItem,
      condition:
        item.condition === "Defect" && expectedItem.critical === true
          ? "Critical"
          : item.condition,
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
    optionalNumeric(body.mileage) ?? numeric(vehicle.current_mileage),
  );
  const hours = optionalNumeric(body.hours) ?? numeric(vehicle.current_hours);
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

  // The data client cannot span statements in one transaction, so every side
  // effect is checked. A critical inspection is a safety record: it is never
  // reversed, and the vehicle is held Out of Service when a later step fails.
  // Other inspections reverse the earlier steps and are reported as not saved.
  const undo: Array<() => Promise<unknown>> = [
    async () => (await context.admin.from("fleet_vehicle_inspections").delete().eq("department_id", context.departmentId).eq("id", inspection.id)).error,
  ];
  let workOrder: any = null;
  const fail = async (step: string, cause: unknown) => {
    const detail = cause instanceof Error ? cause.message : text((cause as any)?.message, 500);
    if (critical.length) {
      const held = await holdOutOfService(step);
      const audit = await recordInspectionAudit(context, inspection, workOrder?.id ?? null);
      console.error("Critical fleet inspection incomplete.", { inspectionId: inspection.id, step, detail, held });
      return NextResponse.json(
        {
          ok: false,
          error: `The inspection and its critical defect were saved, but ${step} failed${detail ? ` (${detail})` : ""}. ${held ? "The vehicle is Out of Service." : "The vehicle could not be marked Out of Service: do not use it and tell a fleet manager now."} Do not submit the inspection again; tell a fleet manager.`,
          inspection,
          workOrder,
          vehicleOutOfService: held,
          audit,
        },
        { status: 500 },
      );
    }
    let reversed = true;
    let inspectionKept = false;
    for (const [index, action] of [...undo.entries()].reverse()) {
      let failed = true;
      try { failed = Boolean(await action()); }
      catch { failed = true; }
      if (failed) reversed = false;
      if (failed && index === 0) inspectionKept = true;
    }
    if (reversed)
      return NextResponse.json(
        { error: `The inspection was not saved because ${step} failed${detail ? ` (${detail})` : ""}. No changes were kept; submit the inspection again.` },
        { status: 500 },
      );
    // The inspection record could not be removed, so its audit entry is still due.
    const audit = inspectionKept ? await recordInspectionAudit(context, inspection, null) : undefined;
    return NextResponse.json(
      {
        ok: false,
        error: `The inspection could not be completed because ${step} failed${detail ? ` (${detail})` : ""}. Some changes could not be reversed${inspectionKept ? " and the inspection record was kept" : ""}. Do not submit it again; tell a fleet manager.`,
        ...(inspectionKept ? { inspection, audit } : {}),
      },
      { status: 500 },
    );
  };
  // Writes only status and status_reason, and only to take the vehicle out of
  // service; it never restores or relaxes anything.
  const holdOutOfService = async (step: string) => {
    const { data: current } = await context.admin.from("fleet_vehicles").select("status").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle();
    if (current && !["Available", "Attention"].includes(current.status)) return true;
    const { data: heldVehicle } = await context.admin
      .from("fleet_vehicles")
      .update({
        status: "Out of Service",
        status_reason: `Critical inspection defect; ${step} did not complete. Review before returning to service.`,
        updated_at: new Date().toISOString(),
      })
      .eq("department_id", context.departmentId)
      .eq("id", vehicleId)
      .in("status", ["Available", "Attention"])
      .select("status")
      .maybeSingle();
    if (heldVehicle) return true;
    const { data: after } = await context.admin.from("fleet_vehicles").select("status").eq("department_id", context.departmentId).eq("id", vehicleId).maybeSingle();
    return Boolean(after && !["Available", "Attention"].includes(after.status));
  };

  for (const item of checklist.filter((entry: any) => entry.equipmentId)) {
    const status =
      item.condition === "Pass"
        ? "Current"
        : item.condition === "Critical"
          ? "Out of Service"
          : "Attention";
    const { data: updatedEquipment, error: equipmentError } = await context.admin
      .from("fleet_vehicle_equipment")
      .update({
        status,
        updated_by_user_id: context.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("department_id", context.departmentId)
      .eq("vehicle_id", vehicleId)
      .eq("id", item.equipmentId)
      .select("id")
      .maybeSingle();
    if (equipmentError || !updatedEquipment)
      return fail("updating vehicle equipment status", equipmentError);
    undo.push(async () => (await context.admin
      .from("fleet_vehicle_equipment")
      .update({ status: item.existingStatus, updated_at: new Date().toISOString() })
      .eq("department_id", context.departmentId)
      .eq("vehicle_id", vehicleId)
      .eq("id", item.equipmentId)).error);
  }

  if (defects.length && rules?.inspection_defect_creates_work_order !== false) {
    const description = defects
      .map((item: any) => `${item.label}: ${item.note}`)
      .join("\n");
    const { data, error: workOrderError } = await context.admin
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
      .select(canViewFleetCosts(context) ? "*" : FLEET_WORK_ORDER_FIELDS_WITHOUT_COST)
      .single();
    if (workOrderError || !data)
      return fail("creating the defect work order", workOrderError);
    workOrder = data;
    undo.push(async () => (await context.admin.from("fleet_work_orders").delete().eq("department_id", context.departmentId).eq("id", data.id)).error);
  }

  const frequencyDays = Math.max(
    1,
    Math.round(numeric(rules?.inspection_frequency_days, 1)),
  );
  const nextDue = new Date();
  nextDue.setUTCDate(nextDue.getUTCDate() + frequencyDays);
  const { data: updatedVehicle, error: vehicleUpdateError } = await context.admin
    .from("fleet_vehicles")
    .update({
      current_mileage: Math.max(mileage, Number(vehicle.current_mileage) || 0),
      current_hours: Math.max(hours, Number(vehicle.current_hours) || 0),
      inspection_due_date: nextDue.toISOString().slice(0, 10),
      updated_by_user_id: context.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("department_id", context.departmentId)
    .eq("id", vehicleId)
    .select("id")
    .maybeSingle();
  if (vehicleUpdateError || !updatedVehicle)
    return fail("updating the vehicle", vehicleUpdateError);
  undo.push(async () => (await context.admin
    .from("fleet_vehicles")
    .update({
      current_mileage: vehicle.current_mileage,
      current_hours: vehicle.current_hours,
      inspection_due_date: vehicle.inspection_due_date ?? null,
      status: vehicle.status,
      open_issue_count: vehicle.open_issue_count,
      updated_at: new Date().toISOString(),
    })
    .eq("department_id", context.departmentId)
    .eq("id", vehicleId)).error);

  let readiness;
  try {
    readiness = await refreshFleetVehicle(context, vehicleId);
  } catch (refreshError) {
    return fail("recalculating vehicle readiness", refreshError);
  }

  // The inspection and its safety status stand even when the audit entry
  // cannot be written yet; the response says so instead of reversing them.
  const audit = await recordInspectionAudit(context, inspection, workOrder?.id ?? null);
  return NextResponse.json(
    { ok: true, inspection, workOrder, readiness, audit },
    { status: 201 },
  );
}
