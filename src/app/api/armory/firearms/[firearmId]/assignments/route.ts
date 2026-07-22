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

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function wholeNumber(value: unknown) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
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

export async function POST(
  request: NextRequest,
  routeContext: RouteContext,
) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  if (
    !hasAnyServerPermission(context, ["manage_firearms"])
  ) {
    return permissionDeniedResponse(
      "Firearm-management permission is required to issue a firearm.",
    );
  }

  const { firearmId } = await routeContext.params;
  const body = (await request.json().catch(() => ({}))) as {
    assignedToUserId?: string;
    notes?: string;
    magazinesIssued?: number;
    magazineDescription?: string | null;
  };

  const assignedToUserId = cleanText(body.assignedToUserId);
  const magazinesIssued = wholeNumber(
    body.magazinesIssued ?? 0,
  );

  if (!assignedToUserId) {
    return NextResponse.json(
      { error: "Select an officer before assigning the firearm." },
      { status: 400 },
    );
  }

  if (magazinesIssued === null) {
    return NextResponse.json(
      {
        error:
          "Magazines issued must be a whole number of zero or greater.",
      },
      { status: 400 },
    );
  }

  try {
    const { data: targetMembership, error: membershipError } =
      await context.admin
        .from("department_memberships")
        .select("user_id")
        .eq("department_id", context.departmentId)
        .eq("user_id", assignedToUserId)
        .eq("is_active", true)
        .maybeSingle();

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    if (!targetMembership) {
      return NextResponse.json(
        {
          error:
            "The selected officer is not an active department member.",
        },
        { status: 400 },
      );
    }

    const { data: firearm, error: firearmError } =
      await context.admin
        .from("firearms")
        .select("id,condition_status")
        .eq("id", firearmId)
        .eq("department_id", context.departmentId)
        .eq("is_active", true)
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

    if (firearm.condition_status !== "In Service") {
      return NextResponse.json(
        {
          error:
            "Only an in-service firearm may be issued.",
        },
        { status: 409 },
      );
    }

    const { data: existing, error: existingError } =
      await context.admin
        .from("firearm_assignments")
        .select("id")
        .eq("department_id", context.departmentId)
        .eq("firearm_id", firearmId)
        .is("returned_at", null)
        .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      return NextResponse.json(
        {
          error:
            "This firearm already has an active assignment.",
        },
        { status: 409 },
      );
    }

    const { error: insertError } = await context.admin
      .from("firearm_assignments")
      .insert({
        department_id: context.departmentId,
        firearm_id: firearmId,
        assigned_to_user_id: assignedToUserId,
        assigned_by_user_id: context.userId,
        assigned_at: new Date().toISOString(),
        condition_at_issue: firearm.condition_status,
        notes: cleanText(body.notes),
        magazines_issued: magazinesIssued,
        magazine_description: cleanText(
          body.magazineDescription,
        ),
      });

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(
      error,
      "The firearm could not be assigned.",
    );
  }
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
    !hasAnyServerPermission(context, ["manage_firearms"])
  ) {
    return permissionDeniedResponse(
      "Firearm-management permission is required to return a firearm.",
    );
  }

  const { firearmId } = await routeContext.params;
  const body = (await request.json().catch(() => ({}))) as {
    magazinesReturned?: number;
    discrepancyReason?: string | null;
  };

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

    const { data: activeAssignment, error: assignmentError } =
      await context.admin
        .from("firearm_assignments")
        .select("id,magazines_issued")
        .eq("department_id", context.departmentId)
        .eq("firearm_id", firearmId)
        .is("returned_at", null)
        .maybeSingle();

    if (assignmentError) {
      throw new Error(assignmentError.message);
    }

    if (!activeAssignment) {
      return NextResponse.json(
        {
          error:
            "This firearm does not have an active assignment.",
        },
        { status: 409 },
      );
    }

    const expected = Number(
      activeAssignment.magazines_issued ?? 0,
    );
    const returned =
      body.magazinesReturned === undefined
        ? expected
        : wholeNumber(body.magazinesReturned);

    if (returned === null) {
      return NextResponse.json(
        {
          error:
            "Magazines returned must be a whole number of zero or greater.",
        },
        { status: 400 },
      );
    }

    const discrepancyReason = cleanText(
      body.discrepancyReason,
    );

    if (returned !== expected && !discrepancyReason) {
      return NextResponse.json(
        {
          error:
            "A discrepancy reason is required when returned magazines do not match the issued quantity.",
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { error: updateError } = await context.admin
      .from("firearm_assignments")
      .update({
        returned_by_user_id: context.userId,
        returned_at: now,
        condition_at_return:
          firearm.condition_status ?? null,
        magazines_returned: returned,
        magazine_discrepancy_reason:
          returned === expected ? null : discrepancyReason,
        updated_at: now,
      })
      .eq("id", activeAssignment.id)
      .eq("department_id", context.departmentId)
      .is("returned_at", null);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(
      error,
      "The firearm could not be returned.",
    );
  }
}
