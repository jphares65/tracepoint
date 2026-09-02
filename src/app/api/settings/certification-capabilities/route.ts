import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createPolicyReadRepository } from "@/lib/policy-metadata/read-repository";

const SUPPORTED_CAPABILITIES = new Set([
  "perform_firearm_inspections",
]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  const featureError = requireServerFeature(
    context,
    "certifications",
    "Certifications",
  );

  if (featureError) {
    return featureError;
  }

  let data;
  try {
    data = await createPolicyReadRepository(context.admin, context.departmentId).listCertificationCapabilities(context.departmentId);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Certification capabilities could not be loaded." }, { status: 500 });
  }

  return NextResponse.json({
    items: data,
  });
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  const canManage = hasAnyServerPermission(
    context,
    [
      "manage_certifications",
      "administer_department",
    ],
  );

  if (!canManage) {
    return NextResponse.json(
      {
        error:
          "Certification management permission is required.",
      },
      { status: 403 },
    );
  }

  const body =
    (await request.json().catch(() => ({}))) as {
      capabilityCode?: string;
      certificationTypeId?: string | null;
    };

  const capabilityCode = text(body.capabilityCode);
  const certificationTypeId =
    text(body.certificationTypeId);

  if (!SUPPORTED_CAPABILITIES.has(capabilityCode)) {
    return NextResponse.json(
      { error: "Unsupported operational capability." },
      { status: 400 },
    );
  }

  if (!certificationTypeId) {
    const { error } = await context.admin
      .from("department_certification_capabilities")
      .delete()
      .eq("department_id", context.departmentId)
      .eq("capability_code", capabilityCode);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      item: null,
    });
  }

  const {
    data: certificationType,
    error: typeError,
  } = await context.admin
    .from("certification_types")
    .select("id")
    .eq("department_id", context.departmentId)
    .eq("id", certificationTypeId)
    .maybeSingle();

  if (typeError) {
    return NextResponse.json(
      { error: typeError.message },
      { status: 500 },
    );
  }

  if (!certificationType) {
    return NextResponse.json(
      { error: "Certification type not found." },
      { status: 404 },
    );
  }

  const { data, error } = await context.admin
    .from("department_certification_capabilities")
    .upsert(
      {
        department_id: context.departmentId,
        capability_code: capabilityCode,
        certification_type_id: certificationTypeId,
        is_active: true,
        updated_by_user_id: context.userId,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "department_id,capability_code",
      },
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    item: data,
  });
}
