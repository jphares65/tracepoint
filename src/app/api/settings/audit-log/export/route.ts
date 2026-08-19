import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 1000;

export async function GET() {
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

  try {
    const events: Array<Record<string, unknown>> = [];

    let from = 0;

    while (true) {
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
        .range(from, from + BATCH_SIZE - 1);

      if (error) {
        return NextResponse.json(
          {
            error:
              error.message ||
              "The complete audit log could not be loaded.",
          },
          { status: 500 },
        );
      }

      const batch = data ?? [];

      events.push(...batch);

      if (batch.length < BATCH_SIZE) {
        break;
      }

      from += BATCH_SIZE;
    }

    return NextResponse.json({
      events,
      count: events.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The complete audit log could not be loaded.",
      },
      { status: 500 },
    );
  }
}
