import { NextRequest, NextResponse } from "next/server";

import {
  equipmentPermissionDenied,
  getEquipmentServerContext,
  nullableText,
  text,
} from "@/lib/tracepoint/equipment-server";
import { createEquipmentReadRepository } from "@/lib/equipment/read-repository";

export const dynamic = "force-dynamic";

const VALID_LIFECYCLE = new Set([
  "active",
  "out_of_service",
  "removed",
]);

export async function GET() {
  const context = await getEquipmentServerContext();

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
  const assignedUserId =
    nullableText(body.assignedUserId);

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
      lot_number: nullableText(body.lotNumber),

      assigned_user_id: assignedUserId,

      issue_date: nullableText(body.issueDate),
      expiration_date:
        nullableText(body.expirationDate),

      last_inspection_date:
        nullableText(body.lastInspectionDate),

      next_inspection_date:
        nullableText(body.nextInspectionDate),

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
          error.code === "23505"
            ? "An equipment record with this serial number already exists."
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

  const assignedUserId =
    body.assignedUserId === undefined
      ? existing.assigned_user_id
      : nullableText(body.assignedUserId);

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

  if (
    lifecycleStatus === "removed" &&
    !removalReason &&
    existing.lifecycle_status !== "removed"
  ) {
    return NextResponse.json(
      {
        error:
          "A removal reason is required when removing equipment.",
      },
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

      lot_number:
        body.lotNumber === undefined
          ? existing.lot_number
          : nullableText(body.lotNumber),

      assigned_user_id: assignedUserId,

      issue_date:
        body.issueDate === undefined
          ? existing.issue_date
          : nullableText(body.issueDate),

      expiration_date:
        body.expirationDate === undefined
          ? existing.expiration_date
          : nullableText(body.expirationDate),

      last_inspection_date:
        body.lastInspectionDate === undefined
          ? existing.last_inspection_date
          : nullableText(body.lastInspectionDate),

      next_inspection_date:
        body.nextInspectionDate === undefined
          ? existing.next_inspection_date
          : nullableText(body.nextInspectionDate),

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

      removal_reason:
        lifecycleStatus === "removed"
          ? removalReason ?? existing.removal_reason
          : null,

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
          error.code === "23505"
            ? "An equipment record with this serial number already exists."
            : error.message,
      },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ item: data });
}

