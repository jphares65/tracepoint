import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 5000;

function resolveLimit(request: NextRequest) {
  const requested = Number(
    request.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT,
  );

  if (!Number.isFinite(requested)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(
    MAX_LIMIT,
    Math.max(1, Math.trunc(requested)),
  );
}

export async function GET(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  if (
    !hasAnyServerPermission(context, [
      "view_audit_log",
      "administer_department",
    ])
  ) {
    return permissionDeniedResponse(
      "Audit-log permission is required.",
    );
  }

  const limit = resolveLimit(request);

  try {
    const { data, error } = await context.admin
      .from("audit_log")
      .select(
        [
          "id",
          "entity_type",
          "entity_id",
          "action",
          "changed_by_user_id",
          "change_note",
          "changed_fields",
          "old_values",
          "new_values",
          "created_at",
        ].join(","),
      )
      .eq("department_id", context.departmentId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        {
          error:
            error.message ||
            "The audit log could not be loaded.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      events: data ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The audit log could not be loaded.",
      },
      { status: 500 },
    );
  }
}

