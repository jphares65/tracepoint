import { NextRequest, NextResponse } from "next/server";

import {
  PlatformAdminOperationError,
  resolvePlatformAdminAccess,
  type PlatformAdminAccessResult,
} from "@/lib/platform/admin-access";
import { unexpectedErrorResponse } from "@/lib/tracepoint/api-errors";

export const dynamic = "force-dynamic";

// Platform entitlements are read and written only through the authorized
// provider repository: on AWS, the platform-administrator database functions
// (there is no service-role client); otherwise the server-owned provider
// after the platform-administrator check.
function platformAccessFailure(access: Extract<PlatformAdminAccessResult, { ok: false }>) {
  return NextResponse.json(
    {
      error: access.status === 401
        ? "Authentication is required."
        : access.status === 403
          ? "TracePoint platform administrator access is required."
          : "Platform administrator access could not be verified.",
    },
    { status: access.status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  const access = await resolvePlatformAdminAccess();
  if (!access.ok) return platformAccessFailure(access);

  let data;
  try {
    data = await access.repository.listEntitlements();
  } catch (error) {
    return unexpectedErrorResponse("Platform entitlements read", error, "Platform entitlements could not be loaded.");
  }

  return NextResponse.json(
    {
      departments: data.departments,
      features: data.features,
      entitlements: data.entitlements,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function PATCH(request: NextRequest) {
  const access = await resolvePlatformAdminAccess();
  if (!access.ok) return platformAccessFailure(access);

  const body = await request.json().catch(() => ({}));

  const departmentId =
    typeof body.departmentId === "string"
      ? body.departmentId.trim()
      : "";

  const featureCode =
    typeof body.featureCode === "string"
      ? body.featureCode.trim()
      : "";

  if (
    !departmentId ||
    !featureCode ||
    typeof body.isEnabled !== "boolean"
  ) {
    return NextResponse.json(
      {
        error:
          "departmentId, featureCode, and isEnabled are required.",
      },
      { status: 400 },
    );
  }

  const isEnabled = body.isEnabled as boolean;
  try {
    await access.repository.setEntitlement({
      departmentId,
      featureCode,
      isEnabled,
      reason:
        typeof body.reason === "string"
          ? body.reason.trim() || undefined
          : undefined,
    });
  } catch (error) {
    const code = error instanceof PlatformAdminOperationError ? error.code : undefined;
    if (code === "P0002" || code === "22P02") {
      return NextResponse.json({ error: "Department or feature was not found." }, { status: 404 });
    }
    return unexpectedErrorResponse(
      "Platform entitlement update",
      error,
      "Platform entitlement could not be updated.",
      code === "42501" ? 403 : 500,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      departmentId,
      featureCode,
      isEnabled,
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
