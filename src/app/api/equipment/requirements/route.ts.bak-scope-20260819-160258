import { NextRequest, NextResponse } from "next/server";

import {
  equipmentPermissionDenied,
  getEquipmentServerContext,
  nullableInteger,
  nullableText,
  text,
} from "@/lib/tracepoint/equipment-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getEquipmentServerContext();

  if ("error" in context) return context.error;

  const { data, error } = await context.admin
    .from("department_equipment_requirements")
    .select("*")
    .eq("department_id", context.departmentId)
    .order("created_at");

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    items: data ?? [],
    canManage: context.canManage,
  });
}

export async function POST(request: NextRequest) {
  const context = await getEquipmentServerContext();

  if ("error" in context) return context.error;
  if (!context.canManage) return equipmentPermissionDenied();

  const body = await request.json().catch(() => ({}));

  const equipmentTypeId = text(body.equipmentTypeId);

  if (!equipmentTypeId) {
    return NextResponse.json(
      { error: "Equipment type is required." },
      { status: 400 },
    );
  }

  const { data: type, error: typeError } =
    await context.admin
      .from("equipment_types")
      .select("id")
      .eq("id", equipmentTypeId)
      .eq("department_id", context.departmentId)
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

  const requiredQuantity =
    nullableInteger(body.requiredQuantity) ?? 1;

  const validDays = nullableInteger(body.validDays);
  const dueSoonDays = nullableInteger(body.dueSoonDays);

  const inspectionIntervalDays =
    nullableInteger(body.inspectionIntervalDays);

  const inspectionDueSoonDays =
    nullableInteger(body.inspectionDueSoonDays);

  if (requiredQuantity < 1 || requiredQuantity > 100) {
    return NextResponse.json(
      {
        error:
          "Required quantity must be between 1 and 100.",
      },
      { status: 400 },
    );
  }

  if (
    validDays !== null &&
    dueSoonDays !== null &&
    dueSoonDays >= validDays
  ) {
    return NextResponse.json(
      {
        error:
          "Expiration warning must be less than the validity period.",
      },
      { status: 400 },
    );
  }

  if (
    inspectionIntervalDays !== null &&
    inspectionDueSoonDays !== null &&
    inspectionDueSoonDays >= inspectionIntervalDays
  ) {
    return NextResponse.json(
      {
        error:
          "Inspection warning must be less than the inspection interval.",
      },
      { status: 400 },
    );
  }

  const payload = {
    department_id: context.departmentId,
    equipment_type_id: equipmentTypeId,

    is_required: body.isRequired !== false,
    required_quantity: requiredQuantity,

    valid_days: validDays,
    due_soon_days: dueSoonDays,

    inspection_interval_days:
      inspectionIntervalDays,

    inspection_due_soon_days:
      inspectionDueSoonDays,

    is_active: body.isActive !== false,

    notes: nullableText(body.notes),

    updated_by: context.user.id,
  };

  const { data, error } = await context.admin
    .from("department_equipment_requirements")
    .upsert(
      {
        ...payload,
        created_by: context.user.id,
      },
      {
        onConflict:
          "department_id,equipment_type_id",
      },
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ item: data });
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}
