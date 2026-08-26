import { NextRequest, NextResponse } from "next/server";

import { recordDataExport } from "@/lib/tracepoint/export-audit-server";
import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  if (!hasAnyServerPermission(context, ["administer_department"])) {
    return permissionDeniedResponse(
      "Department-administrator permission is required.",
    );
  }

  const body = await request.json().catch(() => ({}));
  const exportType = text(body.exportType, 100);
  const fileName = text(body.fileName, 255) || null;
  const formatText = text(body.format, 10).toLowerCase();

  if (!exportType || !["csv", "pdf"].includes(formatText)) {
    return NextResponse.json(
      { error: "exportType and a supported format are required." },
      { status: 400 },
    );
  }

  const parsedCount = Number(body.recordCount);
  const recordCount = Number.isFinite(parsedCount)
    ? Math.max(0, Math.floor(parsedCount))
    : null;

  try {
    const result = await recordDataExport(context, {
      exportType,
      fileName,
      format: formatText as "csv" | "pdf",
      recordCount,
      source: "settings_import_export",
    });

    return NextResponse.json({ ok: true, logged: result.logged });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The data export could not be audited.",
      },
      { status: 500 },
    );
  }
}
