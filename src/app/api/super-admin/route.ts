import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

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
  const access = await resolveSuperAdmin();

  if (!access.ok) {
    return access.response;
  }

  const { admin } = access.context;

  const [
    departmentsResult,
    featuresResult,
    entitlementsResult,
  ] = await Promise.all([
    admin
      .from("departments")
      .select("id,name,short_name")
      .order("name"),

    admin
      .from("feature_catalog")
      .select(
        "code,display_name,description,sort_order,is_active",
      )
      .eq("is_active", true)
      .order("sort_order"),

    admin
      .from("department_features")
      .select(
        "department_id,feature_code,is_enabled,enabled_at,disabled_at,updated_at,updated_by",
      ),
  ]);

  if (departmentsResult.error) {
    return NextResponse.json(
      { error: departmentsResult.error.message },
      { status: 500 },
    );
  }

  if (featuresResult.error) {
    return NextResponse.json(
      { error: featuresResult.error.message },
      { status: 500 },
    );
  }

  if (entitlementsResult.error) {
    return NextResponse.json(
      { error: entitlementsResult.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      departments: departmentsResult.data ?? [],
      features: featuresResult.data ?? [],
      entitlements: entitlementsResult.data ?? [],
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
