import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

type RouteContext = {
  params: Promise<{ firearmId: string }>;
};

function errorResponse(error: unknown, fallback: string) {
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : fallback,
    },
    { status: 500 },
  );
}

export async function PATCH(
  _request: Request,
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
if (!hasAnyServerPermission(context, ["manage_firearms"])) {
    return permissionDeniedResponse(
      "Firearm-management permission is required to restore a firearm.",
    );
  }

  const { firearmId } = await routeContext.params;

  try {
    const { data: firearm, error: firearmError } =
      await context.admin
        .from("firearms")
        .select("id,is_active,make,model,serial_number")
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

    if (firearm.is_active) {
      return NextResponse.json(
        { error: "This firearm is already active." },
        { status: 409 },
      );
    }

    const { data: restored, error: restoreError } =
      await context.admin
        .from("firearms")
        .update({
          is_active: true,
          archived_at: null,
          archived_by_user_id: null,
          archive_reason: null,
        })
        .eq("id", firearmId)
        .eq("department_id", context.departmentId)
        .eq("is_active", false)
        .select("id")
        .maybeSingle();

    if (restoreError) {
      throw new Error(restoreError.message);
    }

    if (!restored) {
      return NextResponse.json(
        {
          error:
            "The firearm could not be restored because its record changed.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      firearmId,
    });
  } catch (error) {
    return errorResponse(
      error,
      "The firearm could not be restored.",
    );
  }
}

