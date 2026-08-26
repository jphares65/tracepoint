import { NextRequest, NextResponse } from "next/server";

import { loadCompleteAuditFeed } from "@/lib/tracepoint/audit-server";
import { recordDataExport } from "@/lib/tracepoint/export-audit-server";
import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

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
    return permissionDeniedResponse("Audit-log permission is required.");
  }

  try {
    const events = await loadCompleteAuditFeed(
      context.admin,
      context.departmentId,
    );

    const purpose = request.nextUrl.searchParams.get("purpose");

    if (purpose !== "complete_report") {
      await recordDataExport(context, {
        exportType: "complete_audit_history",
        fileName: null,
        format: "json",
        recordCount: events.length,
        source: "audit_log_export_api",
      });
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
