import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { loadAuditFeed } from "@/lib/tracepoint/audit-server";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 5000;

function resolveLimit(request: NextRequest) {
  const requested = Number(
    request.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT,
  );

  if (!Number.isFinite(requested)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(requested)));
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
    return permissionDeniedResponse("Audit-log permission is required.");
  }

  const limit = resolveLimit(request);

  try {
    const events = await loadAuditFeed(
      context.admin,
      context.departmentId,
      limit,
    );

    return NextResponse.json({ events });
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
