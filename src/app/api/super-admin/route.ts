import { NextRequest, NextResponse } from "next/server";

import {
  PlatformAdminOperationError,
  resolvePlatformAdminAccess,
} from "@/lib/platform/admin-access";
import { PlatformReadRepositoryError } from "@/lib/platform/read-repository-core";

export const dynamic = "force-dynamic";

function logEntitlementFailure(operation: "read" | "write", error: unknown) {
  console.error(JSON.stringify({
    event: "platform_entitlement_operation_failed",
    operation,
    code: error instanceof PlatformAdminOperationError
      ? error.code ?? "unknown"
      : error instanceof PlatformReadRepositoryError
        ? error.code ?? "unknown"
        : "unknown",
  }));
}

export async function GET() {
  const access = await resolvePlatformAdminAccess();
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 500 ? "Platform administrator access could not be verified." : "TracePoint platform administrator access is required." },
      { status: access.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let data;
  try {
    data = await access.repository.listEntitlements();
  } catch (error) {
    logEntitlementFailure("read", error);
    return NextResponse.json(
      { error: "Platform entitlements could not be loaded." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
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
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 500 ? "Platform administrator access could not be verified." : "TracePoint platform administrator access is required." },
      { status: access.status, headers: { "Cache-Control": "no-store" } },
    );
  }

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
    logEntitlementFailure("write", error);
    return NextResponse.json(
      { error: "Platform entitlement could not be updated." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
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
