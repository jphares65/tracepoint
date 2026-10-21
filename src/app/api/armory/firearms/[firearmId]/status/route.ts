import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import {
  changeFirearmStatus,
  hasOpenAssignment,
} from "@/lib/armory/firearm-status-change";

type RouteContext = {
  params: Promise<{ firearmId: string }>;
};

const VALID_STATUSES = [
  "In Service",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
] as const;

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

export async function PATCH(
  request: NextRequest,
  routeContext: RouteContext,
) {
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
if (
    !hasAnyServerPermission(context, [
      "manage_firearms",
      "manage_inspections",
    ])
  ) {
    return permissionDeniedResponse(
      "Armory or inspection-management permission is required to change firearm status.",
    );
  }

  const { firearmId } = await routeContext.params;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    notes?: string;
  };

  if (!VALID_STATUSES.includes(body.status as any)) {
    return NextResponse.json(
      { error: "Invalid firearm status." },
      { status: 400 },
    );
  }

  try {
    const { data: firearm, error: firearmError } =
      await context.db
        .from("firearms")
        .select("id,condition_status")
        .eq("id", firearmId)
        .eq("department_id", context.departmentId)
        .maybeSingle();

    if (firearmError) {
      throw new Error(firearmError.message);
    }

    if (!firearm) {
      return NextResponse.json(
        { error: "Firearm not found for this department." },
        { status: 404 },
      );
    }

    const nextStatus = body.status as
      (typeof VALID_STATUSES)[number];

    if (nextStatus === firearm.condition_status) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    // A retired firearm must be back in the armory first.
    if (
      nextStatus === "Retired" &&
      (await hasOpenAssignment(context.db, context.departmentId, firearmId))
    ) {
      return NextResponse.json(
        {
          error:
            "This firearm is currently issued. Return it before retiring it.",
        },
        { status: 409 },
      );
    }

    const changed = await changeFirearmStatus(context.db, {
      departmentId: context.departmentId,
      firearmId,
      userId: context.userId,
      fromStatus: firearm.condition_status,
      toStatus: nextStatus,
      notes: cleanText(body.notes),
    });

    if (!changed) {
      return NextResponse.json(
        {
          error:
            "The firearm status could not be updated because its record changed.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The firearm status could not be updated.",
      },
      { status: 500 },
    );
  }
}

