import { NextRequest, NextResponse } from "next/server";

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

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

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
if (!hasAnyServerPermission(context, ["manage_firearms"])) {
    return permissionDeniedResponse(
      "Firearm-management permission is required to archive a firearm.",
    );
  }

  const { firearmId } = await routeContext.params;
  const body = (await request.json().catch(() => ({}))) as {
    archiveReason?: string;
    notReturnedReason?: string;
  };

  const archiveReason = cleanText(body.archiveReason);
  const notReturnedReason = cleanText(body.notReturnedReason);

  if (!archiveReason) {
    return NextResponse.json(
      { error: "An archive reason is required." },
      { status: 400 },
    );
  }

  try {
    const { data: firearm, error: firearmError } =
      await context.db
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

    if (!firearm.is_active) {
      return NextResponse.json(
        { error: "This firearm is already archived." },
        { status: 409 },
      );
    }

    const { data: activeAssignment, error: assignmentError } =
      await context.db
        .from("firearm_assignments")
        .select("id")
        .eq("department_id", context.departmentId)
        .eq("firearm_id", firearmId)
        .is("returned_at", null)
        .maybeSingle();

    if (assignmentError) {
      throw new Error(assignmentError.message);
    }

    if (activeAssignment && !notReturnedReason) {
      return NextResponse.json(
        {
          error:
            "This firearm is currently assigned. Return it before archiving it, or record why it was not returned (for example lost or stolen).",
        },
        { status: 400 },
      );
    }

    if (activeAssignment) {
      // A lost or stolen firearm closes its assignment as not returned, so the
      // custody record never asserts a physical return.
      const now = new Date().toISOString();
      const { data: closed, error: closeError } = await context.db
        .from("firearm_assignments")
        .update({
          returned_by_user_id: context.userId,
          returned_at: now,
          condition_at_return: "Not Returned",
          magazines_returned: 0,
          magazine_discrepancy_reason: `Not returned: ${notReturnedReason}`,
          updated_at: now,
        })
        .eq("id", activeAssignment.id)
        .eq("department_id", context.departmentId)
        .is("returned_at", null)
        .select("id")
        .maybeSingle();

      if (closeError) {
        throw new Error(closeError.message);
      }

      if (!closed) {
        return NextResponse.json(
          {
            error:
              "The firearm could not be archived because its assignment changed.",
          },
          { status: 409 },
        );
      }
    }

    const { data: archived, error: archiveError } =
      await context.db
        .from("firearms")
        .update({
          is_active: false,
          archived_at: new Date().toISOString(),
          archived_by_user_id: context.userId,
          archive_reason: archiveReason,
        })
        .eq("id", firearmId)
        .eq("department_id", context.departmentId)
        .eq("is_active", true)
        .select("id")
        .maybeSingle();

    if (archiveError) {
      throw new Error(archiveError.message);
    }

    if (!archived) {
      return NextResponse.json(
        {
          error:
            "The firearm could not be archived because its record changed.",
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
      "The firearm could not be archived.",
    );
  }
}

