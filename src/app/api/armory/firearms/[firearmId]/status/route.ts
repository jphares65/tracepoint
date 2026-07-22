import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

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
      await context.admin
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

    const now = new Date().toISOString();

    const { error: updateError } = await context.admin
      .from("firearms")
      .update({
        condition_status: nextStatus,
        updated_at: now,
      })
      .eq("id", firearmId)
      .eq("department_id", context.departmentId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    const { error: historyError } = await context.admin
      .from("firearm_status_history")
      .insert({
        department_id: context.departmentId,
        firearm_id: firearmId,
        old_status: firearm.condition_status,
        new_status: nextStatus,
        changed_by_user_id: context.userId,
        notes: cleanText(body.notes),
      });

    if (historyError) {
      /*
       * Revert the status if the immutable history entry cannot be written.
       * A status change without its audit record is not acceptable.
       */
      await context.admin
        .from("firearms")
        .update({
          condition_status: firearm.condition_status,
          updated_at: now,
        })
        .eq("id", firearmId)
        .eq("department_id", context.departmentId);

      throw new Error(historyError.message);
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
