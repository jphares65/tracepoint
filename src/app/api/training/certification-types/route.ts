import { NextRequest, NextResponse } from "next/server";

import { createCertificationTypeCatalogRepository } from "@/lib/certifications/type-catalog-repository";
import {
  accessFailureResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  return Number.isInteger(parsed) ? parsed : null;
}

async function getContext() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return {
      error: resolved.error,
      status: resolved.status,
    } as const;
  }

  const {
    admin,
    user,
    departmentId,
  } = resolved.context;

  const [{ data: manager }, { data: administrator }] =
    await Promise.all([
      admin.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "manage_certifications",
      }),
      admin.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "administer_department",
      }),
    ]);

  if (!manager && !administrator) {
    return {
      error: "You do not have permission to manage certification types.",
      status: 403,
    } as const;
  }

  return {
    admin,
    user,
    departmentId,
  } as const;
}

export async function GET() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "certifications",
    "Certifications",
  );

  if (featureError) {
    return featureError;
  }

  const { admin, departmentId } = resolved.context;

  try {
    const data = await createCertificationTypeCatalogRepository(
      admin,
      departmentId,
    ).listTypes({ departmentId });

    return NextResponse.json({ items: data });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Certification types could not be loaded.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "certifications",
    "Certifications",
  );

  if (featureError) {
    return featureError;
  }
  const context = await getContext();

  if ("error" in context) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const name = text(body.name);
  const category = text(body.category) || "General";
  const description = text(body.description) || null;
  const issuingOrganization = text(body.issuingOrganization) || null;

  const expirationRequired = body.expirationRequired !== false;
  const defaultValidDays = integerOrNull(body.defaultValidDays);

  const rawDueSoon = integerOrNull(body.defaultDueSoonDays);
  const defaultDueSoonDays = rawDueSoon === null ? 30 : rawDueSoon;

  if (!name) {
    return NextResponse.json(
      { error: "Certification type name is required." },
      { status: 400 },
    );
  }

  if (
    defaultValidDays !== null &&
    (defaultValidDays < 1 || defaultValidDays > 36500)
  ) {
    return NextResponse.json(
      { error: "Default validity must be between 1 and 36500 days." },
      { status: 400 },
    );
  }

  if (
    defaultDueSoonDays < 0 ||
    defaultDueSoonDays > 36500
  ) {
    return NextResponse.json(
      { error: "Due-soon warning must be between 0 and 36500 days." },
      { status: 400 },
    );
  }

  if (
    defaultValidDays !== null &&
    defaultDueSoonDays >= defaultValidDays
  ) {
    return NextResponse.json(
      {
        error:
          "Due-soon warning must be less than the certification validity period.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await context.admin
    .from("certification_types")
    .insert({
      department_id: context.departmentId,
      name,
      description,
      category,
      issuing_organization: issuingOrganization,
      expiration_required: expirationRequired,
      default_valid_days: defaultValidDays,
      default_due_soon_days: defaultDueSoonDays,
      is_active: true,
      created_by_user_id: context.user.id,
      updated_by_user_id: context.user.id,
    })
    .select("*")
    .single();

  if (error) {
    const duplicate =
      error.code === "23505" ||
      String(error.message).toLowerCase().includes("duplicate");

    return NextResponse.json(
      {
        error: duplicate
          ? "A certification type with this name already exists."
          : error.message,
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  return NextResponse.json(
    { certificationType: data },
    { status: 201 },
  );
}

export async function PATCH(request: NextRequest) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "certifications",
    "Certifications",
  );

  if (featureError) {
    return featureError;
  }
  const context = await getContext();

  if ("error" in context) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const certificationTypeId = text(body.certificationTypeId);
  const name = text(body.name);
  const category = text(body.category) || "General";
  const description = text(body.description) || null;
  const issuingOrganization = text(body.issuingOrganization) || null;

  const expirationRequired = body.expirationRequired !== false;
  const defaultValidDays = integerOrNull(body.defaultValidDays);

  const rawDueSoon = integerOrNull(body.defaultDueSoonDays);
  const defaultDueSoonDays = rawDueSoon === null ? 30 : rawDueSoon;

  if (!certificationTypeId || !name) {
    return NextResponse.json(
      { error: "Certification type and name are required." },
      { status: 400 },
    );
  }

  if (
    defaultValidDays !== null &&
    (defaultValidDays < 1 || defaultValidDays > 36500)
  ) {
    return NextResponse.json(
      { error: "Default validity must be between 1 and 36500 days." },
      { status: 400 },
    );
  }

  if (
    defaultValidDays !== null &&
    defaultDueSoonDays >= defaultValidDays
  ) {
    return NextResponse.json(
      {
        error:
          "Due-soon warning must be less than the certification validity period.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await context.admin
    .from("certification_types")
    .update({
      name,
      description,
      category,
      issuing_organization: issuingOrganization,
      expiration_required: expirationRequired,
      default_valid_days: defaultValidDays,
      default_due_soon_days: defaultDueSoonDays,
      updated_by_user_id: context.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", certificationTypeId)
    .eq("department_id", context.departmentId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Certification type not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    certificationType: data,
  });
}
