import { NextRequest, NextResponse } from "next/server";

import {
  equipmentPermissionDenied,
  getEquipmentServerContext,
  nullableInteger,
  nullableText,
  text,
} from "@/lib/tracepoint/equipment-server";
import { createEquipmentReadRepository } from "@/lib/equipment/read-repository";

export const dynamic = "force-dynamic";

const VALID_SCOPE_TYPES = new Set([
  "all",
  "rank",
  "unit",
  "officer",
]);

function normalizeScopeType(value: unknown) {
  const scopeType = text(value).toLowerCase() || "all";

  return VALID_SCOPE_TYPES.has(scopeType)
    ? scopeType
    : "";
}

function normalizeScopeValue(
  scopeType: string,
  value: unknown,
) {
  if (scopeType === "all") return "";

  return text(value);
}

async function validateScope(
  context: Awaited<ReturnType<typeof getEquipmentServerContext>>,
  scopeType: string,
  scopeValue: string,
) {
  if ("error" in context) {
    return {
      error: "Unable to resolve equipment access.",
      status: 500,
    };
  }

  if (!VALID_SCOPE_TYPES.has(scopeType)) {
    return {
      error: "Invalid equipment requirement scope.",
      status: 400,
    };
  }

  if (scopeType === "all") {
    return null;
  }

  if (!scopeValue) {
    return {
      error:
        scopeType === "rank"
          ? "A rank/title is required for a rank-scoped equipment requirement."
          : scopeType === "unit"
            ? "A unit is required for a unit-scoped equipment requirement."
            : "An officer is required for an officer-scoped equipment requirement.",
      status: 400,
    };
  }

  if (scopeType === "officer") {
    const { data, error } = await context.db
      .from("department_memberships")
      .select("user_id")
      .eq("department_id", context.departmentId)
      .eq("user_id", scopeValue)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return {
        error: error.message,
        status: 500,
      };
    }

    if (!data) {
      return {
        error:
          "The selected officer is not an active member of this department.",
        status: 400,
      };
    }
  }

  return null;
}

export async function GET() {
  const context = await getEquipmentServerContext();

  if ("error" in context) return context.error;

  try {
    const items = await createEquipmentReadRepository(
      context.db,
      context.departmentId,
    ).listRequirements({ departmentId: context.departmentId });
    return NextResponse.json({ items, canManage: context.canManage });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Equipment requirements could not be loaded." },
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

  const scopeType = normalizeScopeType(
    body.scopeType,
  );

  if (!scopeType) {
    return NextResponse.json(
      {
        error:
          "Scope must be all, rank, unit, or officer.",
      },
      { status: 400 },
    );
  }

  const scopeValue = normalizeScopeValue(
    scopeType,
    body.scopeValue,
  );

  const scopeError = await validateScope(
    context,
    scopeType,
    scopeValue,
  );

  if (scopeError) {
    return NextResponse.json(
      { error: scopeError.error },
      { status: scopeError.status },
    );
  }

  const requiredQuantity =
    nullableInteger(body.requiredQuantity) ?? 1;

  const validDays =
    nullableInteger(body.validDays);

  const dueSoonDays =
    nullableInteger(body.dueSoonDays);

  const inspectionIntervalDays =
    nullableInteger(body.inspectionIntervalDays);

  const inspectionDueSoonDays =
    nullableInteger(body.inspectionDueSoonDays);

  if (
    requiredQuantity < 1 ||
    requiredQuantity > 100
  ) {
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
    inspectionDueSoonDays >=
      inspectionIntervalDays
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

    scope_type: scopeType,
    scope_value: scopeValue,

    is_required: body.isRequired !== false,
    required_quantity: requiredQuantity,

    affects_readiness:
      body.affectsReadiness !== false,

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

  const { data, error } = await context.db
    .from("department_equipment_requirements")
    .upsert(
      {
        ...payload,
        created_by: context.user.id,
      },
      {
        onConflict:
          "department_id,equipment_type_id,scope_type,scope_value",
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

  return NextResponse.json({
    item: data,
  });
}

export async function PATCH(
  request: NextRequest,
) {
  return POST(request);
}
