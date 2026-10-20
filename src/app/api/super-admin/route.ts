import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createPlatformReadRepository } from "@/lib/platform/read-repository";
import { PlatformAdminOperationError, resolvePlatformAdminAccess, type PlatformAdminRepository } from "@/lib/platform/admin-access";

export const dynamic = "force-dynamic";

// The AWS runtime has no service-role client: platform entitlements are read
// and written only through the platform-administrator database functions.
async function resolvePostgresSuperAdmin() {
  const access = await resolvePlatformAdminAccess();
  if (!access.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: access.status === 401 ? "Authentication is required." : access.status === 403 ? "TracePoint platform administrator access is required." : "Platform administrator access could not be verified." },
        { status: access.status, headers: { "Cache-Control": "no-store" } },
      ),
    };
  }
  return { ok: true as const, repository: access.repository };
}

async function postgresPatch(request: NextRequest, repository: PlatformAdminRepository) {
  const body = await request.json().catch(() => ({}));
  const departmentId = typeof body.departmentId === "string" ? body.departmentId.trim() : "";
  const featureCode = typeof body.featureCode === "string" ? body.featureCode.trim() : "";
  if (!departmentId || !featureCode || typeof body.isEnabled !== "boolean") {
    return NextResponse.json({ error: "departmentId, featureCode, and isEnabled are required." }, { status: 400 });
  }
  const isEnabled = body.isEnabled as boolean;
  const reason = typeof body.reason === "string" ? body.reason.trim() || undefined : undefined;
  try {
    await repository.setEntitlement({ departmentId, featureCode, isEnabled, reason });
  } catch (error) {
    const code = error instanceof PlatformAdminOperationError ? error.code : undefined;
    if (code === "P0002" || code === "22P02") return NextResponse.json({ error: "Department or feature was not found." }, { status: 404 });
    return NextResponse.json({ error: "Platform entitlement could not be updated." }, { status: code === "42501" ? 403 : 500 });
  }
  return NextResponse.json({ ok: true, departmentId, featureCode, isEnabled }, { headers: { "Cache-Control": "no-store" } });
}

async function resolveSuperAdmin() {
  const result = await resolveServerAccess();

  if (!result.ok) {
    return {
      ok: false as const,
      response: accessFailureResponse(result),
    };
  }

  if (!result.context.isSuperAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error:
            "TracePoint platform administrator access is required.",
        },
        {
          status: 403,
          headers: { "Cache-Control": "no-store" },
        },
      ),
    };
  }

  return {
    ok: true as const,
    context: result.context,
  };
}

export async function GET() {
  if (process.env.TRACEPOINT_DATA_PROVIDER === "postgres") {
    const platform = await resolvePostgresSuperAdmin();
    if (!platform.ok) return platform.response;
    try {
      const data = await platform.repository.listEntitlements();
      return NextResponse.json(
        { departments: data.departments, features: data.features, entitlements: data.entitlements },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json({ error: "Platform entitlements could not be loaded." }, { status: 500 });
    }
  }

  const access = await resolveSuperAdmin();

  if (!access.ok) {
    return access.response;
  }

  const { admin } = access.context;

  let data;
  try { data = await createPlatformReadRepository(admin, true).listEntitlements(); }
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
  if (process.env.TRACEPOINT_DATA_PROVIDER === "postgres") {
    const platform = await resolvePostgresSuperAdmin();
    return platform.ok ? postgresPatch(request, platform.repository) : platform.response;
  }

  const access = await resolveSuperAdmin();

  if (!access.ok) {
    return access.response;
  }

  const { admin, user } = access.context;

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

  const [
    departmentResult,
    featureResult,
    currentResult,
  ] = await Promise.all([
    admin
      .from("departments")
      .select("id")
      .eq("id", departmentId)
      .maybeSingle(),

    admin
      .from("feature_catalog")
      .select("code,is_active")
      .eq("code", featureCode)
      .maybeSingle(),

    admin
      .from("department_features")
      .select("is_enabled")
      .eq("department_id", departmentId)
      .eq("feature_code", featureCode)
      .maybeSingle(),
  ]);

  if (departmentResult.error) {
    return NextResponse.json(
      { error: departmentResult.error.message },
      { status: 500 },
    );
  }

  if (!departmentResult.data) {
    return NextResponse.json(
      { error: "Department was not found." },
      { status: 404 },
    );
  }

  if (featureResult.error) {
    return NextResponse.json(
      { error: featureResult.error.message },
      { status: 500 },
    );
  }

  if (
    !featureResult.data ||
    featureResult.data.is_active !== true
  ) {
    return NextResponse.json(
      { error: "Feature was not found or is inactive." },
      { status: 404 },
    );
  }

  if (currentResult.error) {
    return NextResponse.json(
      { error: currentResult.error.message },
      { status: 500 },
    );
  }

  const previousEnabled =
    currentResult.data?.is_enabled ?? true;

  const now = new Date().toISOString();

  const { error: entitlementError } = await admin
    .from("department_features")
    .upsert(
      {
        department_id: departmentId,
        feature_code: featureCode,
        is_enabled: isEnabled,
        enabled_at: isEnabled ? now : null,
        disabled_at: isEnabled ? null : now,
        updated_at: now,
        updated_by: user.id,
      },
      {
        onConflict: "department_id,feature_code",
      },
    );

  if (entitlementError) {
    return NextResponse.json(
      { error: entitlementError.message },
      { status: 500 },
    );
  }

  if (previousEnabled !== isEnabled) {
    const reason =
      typeof body.reason === "string"
        ? body.reason.trim() || null
        : null;

    const { error: eventError } = await admin
      .from("department_feature_events")
      .insert({
        department_id: departmentId,
        feature_code: featureCode,
        previous_enabled: previousEnabled,
        new_enabled: isEnabled,
        actor_user_id: user.id,
        reason,
      });

    if (eventError) {
      return NextResponse.json(
        { error: eventError.message },
        { status: 500 },
      );
    }
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
