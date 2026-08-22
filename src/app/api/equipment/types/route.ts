import { NextRequest, NextResponse } from "next/server";

import {
  equipmentPermissionDenied,
  getEquipmentServerContext,
  nullableInteger,
  nullableText,
  text,
} from "@/lib/tracepoint/equipment-server";

export const dynamic = "force-dynamic";

function validateDays(
  value: number | null,
  label: string,
  allowZero = false,
) {
  if (value === null) return null;

  const minimum = allowZero ? 0 : 1;

  if (value < minimum || value > 36500) {
    return `${label} must be between ${minimum} and 36500 days.`;
  }

  return null;
}

export async function GET() {
  const context = await getEquipmentServerContext();

  if ("error" in context) return context.error;

  const { data, error } = await context.db
    .from("equipment_types")
    .select("*")
    .eq("department_id", context.departmentId)
    .order("category")
    .order("name");

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

  const name = text(body.name);
  const category = text(body.category) || "General";

  if (!name) {
    return NextResponse.json(
      { error: "Equipment type name is required." },
      { status: 400 },
    );
  }

  const defaultValidDays =
    nullableInteger(body.defaultValidDays);

  const defaultDueSoonDays =
    nullableInteger(body.defaultDueSoonDays) ?? 30;

  const defaultInspectionIntervalDays =
    nullableInteger(body.defaultInspectionIntervalDays);

  const defaultInspectionDueSoonDays =
    nullableInteger(body.defaultInspectionDueSoonDays) ?? 30;

  const validationErrors = [
    validateDays(defaultValidDays, "Default validity"),
    validateDays(defaultDueSoonDays, "Expiration warning", true),
    validateDays(
      defaultInspectionIntervalDays,
      "Inspection interval",
    ),
    validateDays(
      defaultInspectionDueSoonDays,
      "Inspection warning",
      true,
    ),
  ].filter(Boolean);

  if (
    defaultValidDays !== null &&
    defaultDueSoonDays >= defaultValidDays
  ) {
    validationErrors.push(
      "Expiration warning must be less than the validity period.",
    );
  }

  if (
    defaultInspectionIntervalDays !== null &&
    defaultInspectionDueSoonDays >=
      defaultInspectionIntervalDays
  ) {
    validationErrors.push(
      "Inspection warning must be less than the inspection interval.",
    );
  }

  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: validationErrors[0] },
      { status: 400 },
    );
  }

  const { data, error } = await context.db
    .from("equipment_types")
    .insert({
      department_id: context.departmentId,
      name,
      category,
      description: nullableText(body.description),

      expiration_required:
        body.expirationRequired === true,

      default_valid_days: defaultValidDays,
      default_due_soon_days: defaultDueSoonDays,

      inspection_required:
        body.inspectionRequired === true,

      default_inspection_interval_days:
        defaultInspectionIntervalDays,

      default_inspection_due_soon_days:
        defaultInspectionDueSoonDays,

      is_active: body.isActive !== false,

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
            ? "An equipment type with this name already exists."
            : error.message,
      },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  return NextResponse.json({ item: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const context = await getEquipmentServerContext();

  if ("error" in context) return context.error;
  if (!context.canManage) return equipmentPermissionDenied();

  const body = await request.json().catch(() => ({}));
  const id = text(body.id);
  const name = text(body.name);

  if (!id || !name) {
    return NextResponse.json(
      { error: "Equipment type ID and name are required." },
      { status: 400 },
    );
  }

  const defaultValidDays =
    nullableInteger(body.defaultValidDays);

  const defaultDueSoonDays =
    nullableInteger(body.defaultDueSoonDays) ?? 30;

  const defaultInspectionIntervalDays =
    nullableInteger(body.defaultInspectionIntervalDays);

  const defaultInspectionDueSoonDays =
    nullableInteger(body.defaultInspectionDueSoonDays) ?? 30;

  if (
    defaultValidDays !== null &&
    defaultDueSoonDays >= defaultValidDays
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
    defaultInspectionIntervalDays !== null &&
    defaultInspectionDueSoonDays >=
      defaultInspectionIntervalDays
  ) {
    return NextResponse.json(
      {
        error:
          "Inspection warning must be less than the inspection interval.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await context.db
    .from("equipment_types")
    .update({
      name,
      category: text(body.category) || "General",
      description: nullableText(body.description),

      expiration_required:
        body.expirationRequired === true,

      default_valid_days: defaultValidDays,
      default_due_soon_days: defaultDueSoonDays,

      inspection_required:
        body.inspectionRequired === true,

      default_inspection_interval_days:
        defaultInspectionIntervalDays,

      default_inspection_due_soon_days:
        defaultInspectionDueSoonDays,

      is_active: body.isActive !== false,

      updated_by: context.user.id,
    })
    .eq("id", id)
    .eq("department_id", context.departmentId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "An equipment type with this name already exists."
            : error.message,
      },
      { status: error.code === "23505" ? 409 : 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Equipment type was not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ item: data });
}
