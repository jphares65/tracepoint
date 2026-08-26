import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { loadCompleteAuditFeed } from "@/lib/tracepoint/audit-server";

export const dynamic = "force-dynamic";

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
    return permissionDeniedResponse("Audit-log permission is required.");
  }

  try {
    const events = await loadCompleteAuditFeed(
      context.admin,
      context.departmentId,
    );

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
