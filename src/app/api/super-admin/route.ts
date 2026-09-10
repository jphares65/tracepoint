import { NextRequest, NextResponse } from "next/server";

import { PlatformAdminOperationError, resolvePlatformAdminAccess } from "@/lib/platform/admin-access";

export const dynamic = "force-dynamic";

async function resolveSuperAdmin() {
  const result = await resolvePlatformAdminAccess();
  if (!result.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: result.status === 401 ? "Authentication is required." : "TracePoint platform administrator access is required." },
        {
          status: result.status,
          headers: { "Cache-Control": "no-store" },
        },
      ),
    };
  }

  return {
    ok: true as const,
    repository: result.repository,
  };
}

export async function GET() {
  const access = await resolveSuperAdmin();

  if (!access.ok) {
    return access.response;
  }

  let data;
  try { data = await access.repository.listEntitlements(); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Platform entitlements could not be loaded." }, { status: 500 }); }

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
  const access = await resolveSuperAdmin();

  if (!access.ok) {
    return access.response;
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
  const reason = typeof body.reason === "string" ? body.reason.trim() || undefined : undefined;
  try {
    await access.repository.setEntitlement({ departmentId, featureCode, isEnabled, reason });
  } catch (error) {
    if (error instanceof PlatformAdminOperationError && error.code === "P0002") {
      return NextResponse.json({ error: "Department or feature was not found." }, { status: 404 });
    }
    return NextResponse.json({ error: "Platform entitlement could not be updated." }, { status: 500 });
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
