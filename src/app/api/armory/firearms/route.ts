import { NextRequest, NextResponse } from "next/server";
import { createArmoryReadRepository } from "@/lib/armory/read-repository";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";


const VALID_FIREARM_TYPES = [
  "handgun",
  "rifle",
  "shotgun",
  "less_lethal",
  "other",
] as const;

const VALID_STATUSES = [
  "In Service",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
] as const;

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function responseError(error: unknown, fallback: string) {
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : fallback,
    },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  const includeArchived =
    request.nextUrl.searchParams.get("includeArchived") === "true";

  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  const featureError = requireServerFeature(
    context,
    "firearms",
    "Firearms",
  );

  if (featureError) {
    return featureError;
  }
  const canViewAll = hasAnyServerPermission(context, [
    "manage_firearms",
    "manage_inspections",
    "view_command_dashboard",
  ]);
  const canManage = hasAnyServerPermission(context, ["manage_firearms"]);
  const canInspect = hasAnyServerPermission(context, [
    "manage_firearms",
    "manage_inspections",
  ]);

  try {
    const data = await createArmoryReadRepository(context.db, context.admin, context.departmentId, context.userId).getFirearmInventory({ departmentId: context.departmentId, userId: context.userId, includeArchived, canViewAll, canManage, canInspect });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseError(
      error,
      "The Armory records could not be loaded.",
    );
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  const featureError = requireServerFeature(
    context,
    "firearms",
    "Firearms",
  );

  if (featureError) {
    return featureError;
  }

  if (!hasAnyServerPermission(context, ["manage_firearms"])) {
    return permissionDeniedResponse(
      "Firearm-management permission is required to add inventory.",
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    make?: string;
    model?: string;
    serialNumber?: string;
    firearmType?: string;
    caliber?: string;
    assetNumber?: string;
    conditionStatus?: string;
    notes?: string;
    assignedToUserId?: string;
  };

  const make = cleanText(body.make);
  const model = cleanText(body.model);
  const serialNumber = cleanText(body.serialNumber);
  const firearmType = cleanText(body.firearmType) ?? "handgun";
  const conditionStatus = cleanText(body.conditionStatus) ?? "In Service";
  const assignedToUserId = cleanText(body.assignedToUserId);

  if (!make || !model || !serialNumber) {
    return NextResponse.json(
      { error: "Make, model, and serial number are required." },
      { status: 400 },
    );
  }

  if (!VALID_FIREARM_TYPES.includes(firearmType as (typeof VALID_FIREARM_TYPES)[number])) {
    return NextResponse.json(
      { error: "Invalid firearm type." },
      { status: 400 },
    );
  }

  if (!VALID_STATUSES.includes(conditionStatus as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json(
      { error: "Invalid firearm status." },
      { status: 400 },
    );
  }

  try {
    if (assignedToUserId) {
      const { data: membership, error: membershipError } =
        await context.db
          .from("department_memberships")
          .select("user_id")
          .eq("department_id", context.departmentId)
          .eq("user_id", assignedToUserId)
          .eq("is_active", true)
          .maybeSingle();

      if (membershipError) {
        throw new Error(membershipError.message);
      }

      if (!membership) {
        return NextResponse.json(
          {
            error:
              "The assigned officer is not an active department member.",
          },
          { status: 400 },
        );
      }

      if (conditionStatus !== "In Service") {
        return NextResponse.json(
          {
            error:
              "Only an in-service firearm may be assigned during import.",
          },
          { status: 409 },
        );
      }
    }

    const { data: existing, error: existingError } =
      await context.db
        .from("firearms")
        .select("id")
        .eq("department_id", context.departmentId)
        .ilike("serial_number", serialNumber)
        .limit(1)
        .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      return NextResponse.json(
        {
          error:
            "A firearm with this serial number already exists.",
        },
        { status: 409 },
      );
    }

    const { data: inserted, error: insertError } =
      await context.db
        .from("firearms")
        .insert({
          department_id: context.departmentId,
          make,
          model,
          serial_number: serialNumber,
          firearm_type: firearmType,
          caliber: cleanText(body.caliber) ?? "TBD / Unknown",
          asset_number: cleanText(body.assetNumber),
          condition_status: conditionStatus,
          notes: cleanText(body.notes),
          is_active: true,
          created_by: context.userId,
        })
        .select("id")
        .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    if (assignedToUserId) {
      const { error: assignmentError } = await context.db
        .from("firearm_assignments")
        .insert({
          department_id: context.departmentId,
          firearm_id: inserted.id,
          assigned_to_user_id: assignedToUserId,
          assigned_by_user_id: context.userId,
          assigned_at: new Date().toISOString(),
          condition_at_issue: conditionStatus,
          magazines_issued: 0,
        });

      if (assignmentError) {
        await context.db
          .from("firearms")
          .delete()
          .eq("id", inserted.id)
          .eq("department_id", context.departmentId);

        throw new Error(
          `The firearm assignment could not be created: ${assignmentError.message}`,
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        firearmId: inserted.id,
        assignmentCreated: Boolean(assignedToUserId),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    return NextResponse.json(
      {
        error:
          message.toLowerCase().includes("duplicate") ||
          message.toLowerCase().includes("unique")
            ? "A firearm with this serial number already exists."
            : message || "The firearm could not be added.",
      },
      {
        status:
          message.toLowerCase().includes("duplicate") ||
          message.toLowerCase().includes("unique")
            ? 409
            : 500,
      },
    );
  }
}




