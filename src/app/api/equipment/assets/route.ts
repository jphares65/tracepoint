import { NextRequest, NextResponse } from "next/server";

import {
  equipmentPermissionDenied,
  getEquipmentServerContext,
  nullableText,
  text,
} from "@/lib/tracepoint/equipment-server";
import { createEquipmentReadRepository } from "@/lib/equipment/read-repository";
import { equipmentAssignment, equipmentDate, equipmentIdentifierConflict } from "@/lib/equipment/write-validation";
import { sortFleetVehiclesByUnit } from "@/lib/fleet/unit-order";

export const dynamic = "force-dynamic";

const VALID_LIFECYCLE = new Set([
  "active",
  "out_of_service",
  "removed",
]);

const DATE_FIELDS = [
  ["issueDate", "issue_date", "Issue date"],
  ["expirationDate", "expiration_date", "Expiration date"],
  ["lastInspectionDate", "last_inspection_date", "Last inspection date"],
  ["nextInspectionDate", "next_inspection_date", "Next inspection date"],
] as const;

// Supplied dates only; an omitted field keeps the stored value.
function equipmentDates(body: Record<string, unknown>, existing: Record<string, unknown> = {}) {
  const dates: Record<string, string | null> = {};
  for (const [field, column, label] of DATE_FIELDS) {
    dates[column] = body[field] === undefined ? (existing[column] as string | null) ?? null : equipmentDate(body[field], label);
  }
  if ((body.issueDate !== undefined || body.expirationDate !== undefined) &&
      dates.issue_date && dates.expiration_date && dates.expiration_date < dates.issue_date) {
    throw new Error("Expiration date cannot be before the issue date.");
  }
  return dates;
}

export async function GET(request: NextRequest) {
  const context = await getEquipmentServerContext(request);

  if ("error" in context) return context.error;

  try {
    const result = await createEquipmentReadRepository(
      context.db,
      context.departmentId,
    ).getAssetDirectory({
      departmentId: context.departmentId,
      userId: context.user.id,
      canViewDepartment: context.canViewDepartment,
    });
    return NextResponse.json({
      ...result,
      vehicles: context.canManage
        ? sortFleetVehiclesByUnit((await context.admin
            .from("fleet_vehicles")
            .select("id,unit_number,make,model,status")
            .eq("department_id", context.departmentId)
            .neq("status", "Retired")).data ?? [])
        : [],
      canManage: context.canManage,
      canViewDepartment: context.canViewDepartment,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Equipment data could not be loaded." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const context = await getEquipmentServerContext();

  if ("error" in context) return context.error;
  if (!context.canManage) return equipmentPermissionDenied();

  const body = await request.json().catch(() => ({}));

  const equipmentTypeId = text(body.equipmentTypeId);
  let assignment;
  try { assignment = equipmentAssignment(body); }
  catch (assignmentError) { return NextResponse.json({ error: (assignmentError as Error).message }, { status: 400 }); }
  const { assignedUserId, assignedVehicleId, assignedLocation } = assignment;
  let dates;
  try { dates = equipmentDates(body); }
  catch (dateError) { return NextResponse.json({ error: (dateError as Error).message }, { status: 400 }); }

  if (!equipmentTypeId) {
    return NextResponse.json(
      { error: "Equipment type is required." },
      { status: 400 },
    );
  }

  const { data: type, error: typeError } =
    await context.db
      .from("equipment_types")
      .select("id")
      .eq("id", equipmentTypeId)
      .eq("department_id", context.departmentId)
      .eq("is_active", true)
      .maybeSingle();

  if (typeError) {
    return NextResponse.json(
      { error: typeError.message },
      { status: 500 },
    );
  }

  if (!type) {
    return NextResponse.json(
      { error: "Equipment type was not found." },
      { status: 404 },
    );
  }

  if (assignedUserId) {
    const { data: member, error: memberError } =
      await context.db
        .from("department_memberships")
        .select("user_id")
        .eq("department_id", context.departmentId)
        .eq("user_id", assignedUserId)
        .eq("is_active", true)
        .maybeSingle();

    if (memberError) {
      return NextResponse.json(
        { error: memberError.message },
        { status: 500 },
      );
    }

    if (!member) {
      return NextResponse.json(
        {
          error:
            "Assigned officer must be an active department member.",
        },
        { status: 400 },
      );
    }
  }

  if (assignedVehicleId) {
    const { data: vehicle } = await context.admin.from("fleet_vehicles").select("id")
      .eq("department_id", context.departmentId).eq("id", assignedVehicleId)
      .neq("status", "Retired").maybeSingle();
    if (!vehicle) return NextResponse.json(
      { error: "Assigned vehicle must belong to this agency." }, { status: 400 },
    );
  }

  const lifecycleStatus =
    text(body.lifecycleStatus) || "active";

  if (!VALID_LIFECYCLE.has(lifecycleStatus)) {
    return NextResponse.json(
      { error: "Invalid equipment lifecycle status." },
      { status: 400 },
    );
  }

  if (lifecycleStatus === "removed") {
    return NextResponse.json(
      {
        error:
          "Create equipment as active or out of service. Remove it through the edit workflow.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await context.db
    .from("equipment_assets")
    .insert({
      department_id: context.departmentId,
      equipment_type_id: equipmentTypeId,

      manufacturer: nullableText(body.manufacturer),
      model: nullableText(body.model),
      serial_number: nullableText(body.serialNumber),
      asset_number: nullableText(body.assetNumber),
      lot_number: nullableText(body.lotNumber),

      assigned_user_id: assignedUserId,
      assigned_vehicle_id: assignedVehicleId,
      assigned_location: assignedLocation,

      ...dates,

      lifecycle_status: lifecycleStatus,

      notes: nullableText(body.notes),
      document_url: nullableText(body.documentUrl),

      created_by: context.user.id,
      updated_by: context.user.id,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          equipmentIdentifierConflict(error.code)
            ? equipmentIdentifierConflict(error.code)
            : error.message,
      },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json(
    { item: data },
    { status: 201 },
  );
}

export async function PATCH(request: NextRequest) {
  const context = await getEquipmentServerContext();

  if ("error" in context) return context.error;
  if (!context.canManage) return equipmentPermissionDenied();

  const body = await request.json().catch(() => ({}));

  const id = text(body.id);

  if (!id) {
    return NextResponse.json(
      { error: "Equipment asset ID is required." },
      { status: 400 },
    );
  }

  const { data: existing, error: existingError } =
    await context.db
      .from("equipment_assets")
      .select("*")
      .eq("id", id)
      .eq("department_id", context.departmentId)
      .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      { error: existingError.message },
      { status: 500 },
    );
  }

  if (!existing) {
    return NextResponse.json(
      { error: "Equipment asset was not found." },
      { status: 404 },
    );
  }

  const equipmentTypeId =
    text(body.equipmentTypeId) ||
    String(existing.equipment_type_id);

  let assignment;
  try {
    assignment = equipmentAssignment({
      assignedUserId: body.assignedUserId === undefined ? existing.assigned_user_id : body.assignedUserId,
      assignedVehicleId: body.assignedVehicleId === undefined ? existing.assigned_vehicle_id : body.assignedVehicleId,
      assignedLocation: body.assignedLocation === undefined ? existing.assigned_location : body.assignedLocation,
    });
  } catch (assignmentError) { return NextResponse.json({ error: (assignmentError as Error).message }, { status: 400 }); }
  const { assignedUserId, assignedVehicleId, assignedLocation } = assignment;
  let dates;
  try { dates = equipmentDates(body, existing); }
  catch (dateError) { return NextResponse.json({ error: (dateError as Error).message }, { status: 400 }); }
  // Only a new holder must be active (or a vehicle in service): an item held by a
  // separated member or a retired vehicle can still change status or be returned.
  const userChanged = assignedUserId !== (existing.assigned_user_id ?? null);
  const vehicleChanged = assignedVehicleId !== (existing.assigned_vehicle_id ?? null);
  const assignmentChanged = userChanged || vehicleChanged || assignedLocation !== (existing.assigned_location ?? null);

  const { data: updateType } = await context.db.from("equipment_types").select("id")
    .eq("id", equipmentTypeId).eq("department_id", context.departmentId).eq("is_active", true).maybeSingle();
  if (!updateType) return NextResponse.json({ error: "Equipment type was not found in this agency." }, { status: 400 });

  if (assignedUserId && userChanged) {
    const { data: member } = await context.db.from("department_memberships").select("user_id")
      .eq("department_id", context.departmentId).eq("user_id", assignedUserId).eq("is_active", true).maybeSingle();
    if (!member) return NextResponse.json({ error: "Assigned officer must be an active department member." }, { status: 400 });
  }

  if (assignedVehicleId && vehicleChanged) {
    const { data: vehicle } = await context.admin.from("fleet_vehicles").select("id")
      .eq("department_id", context.departmentId).eq("id", assignedVehicleId)
      .neq("status", "Retired").maybeSingle();
    if (!vehicle) return NextResponse.json({ error: "Assigned vehicle must belong to this agency." }, { status: 400 });
  }

  const lifecycleStatus =
    text(body.lifecycleStatus) ||
    String(existing.lifecycle_status);

  if (!VALID_LIFECYCLE.has(lifecycleStatus)) {
    return NextResponse.json(
      { error: "Invalid equipment lifecycle status." },
      { status: 400 },
    );
  }

  const removalReason =
    nullableText(body.removalReason);
  const lifecycleChanged = lifecycleStatus !== existing.lifecycle_status;

  if (
    lifecycleStatus === "removed" &&
    !removalReason &&
    lifecycleChanged
  ) {
    return NextResponse.json(
      {
        error:
          "A removal reason is required when removing equipment.",
      },
      { status: 400 },
    );
  }

  if (lifecycleStatus === "out_of_service" && !removalReason && lifecycleChanged) {
    return NextResponse.json(
      { error: "A reason is required when taking equipment out of service." },
      { status: 400 },
    );
  }

  const { data, error } = await context.db
    .from("equipment_assets")
    .update({
      equipment_type_id: equipmentTypeId,

      manufacturer:
        body.manufacturer === undefined
          ? existing.manufacturer
          : nullableText(body.manufacturer),

      model:
        body.model === undefined
          ? existing.model
          : nullableText(body.model),

      serial_number:
        body.serialNumber === undefined
          ? existing.serial_number
          : nullableText(body.serialNumber),

      asset_number:
        body.assetNumber === undefined
          ? existing.asset_number
          : nullableText(body.assetNumber),

      lot_number:
        body.lotNumber === undefined
          ? existing.lot_number
          : nullableText(body.lotNumber),

      // Unchanged custody is not rewritten, so the custody trigger does not
      // re-validate a separated holder or retired vehicle. Removal clears the
      // officer explicitly so the history trigger closes the assignment.
      ...(assignmentChanged
        ? {
            assigned_user_id: lifecycleStatus === "removed" ? null : assignedUserId,
            assigned_vehicle_id: assignedVehicleId,
            assigned_location: assignedLocation,
          }
        : lifecycleStatus === "removed" && existing.assigned_user_id
          ? { assigned_user_id: null }
          : {}),

      ...dates,

      lifecycle_status: lifecycleStatus,

      notes:
        body.notes === undefined
          ? existing.notes
          : nullableText(body.notes),

      document_url:
        body.documentUrl === undefined
          ? existing.document_url
          : nullableText(body.documentUrl),

      removed_at:
        lifecycleStatus === "removed"
          ? existing.removed_at ?? new Date().toISOString()
          : null,

      removed_by:
        lifecycleStatus === "removed"
          ? existing.removed_by ?? context.user.id
          : null,

      // The out-of-service or removal reason; cleared when the item is active.
      removal_reason:
        lifecycleStatus === "active"
          ? null
          : lifecycleChanged
            ? removalReason
            : removalReason ?? existing.removal_reason,

      updated_by: context.user.id,
    })
    .eq("id", id)
    .eq("department_id", context.departmentId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          equipmentIdentifierConflict(error.code)
            ? equipmentIdentifierConflict(error.code)
            : error.message,
      },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ item: data });
}

