import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createTrainingReadRepository } from "@/lib/training/read-repository";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dateOrNull(value: unknown) {
  const result = text(value);
  return result || null;
}

function reminderDays(value: unknown) {
  if (!Array.isArray(value)) {
    return [180, 90, 60, 30, 14, 7, 0];
  }

  return [
    ...new Set(
      value
        .map(Number)
        .filter(
          (item) =>
            Number.isInteger(item) &&
            item >= 0 &&
            item <= 730,
        ),
    ),
  ].sort((a, b) => b - a);
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

  const [{ data: canManageCertifications }, { data: administrator }] =
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

  return {
    admin,
    user,
    departmentId,
    canManage: Boolean(
      canManageCertifications || administrator,
    ),
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
  const context = await getContext();

  if ("error" in context) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  }

  try {
    const data = await createTrainingReadRepository(context.admin, context.departmentId).getCertificationWorkspace(context.departmentId);
    return NextResponse.json({ ...data, canManage: context.canManage });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Certification records could not be loaded." }, { status: 500 });
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

  if (!context.canManage) {
    return NextResponse.json(
      {
        error:
          "You do not have permission to manage certifications.",
      },
      { status: 403 },
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as any;

  const userId = text(body.userId);
  const certificationTypeId = text(
    body.certificationTypeId,
  );

  if (!userId || !certificationTypeId) {
    return NextResponse.json(
      {
        error:
          "Officer and certification type are required.",
      },
      { status: 400 },
    );
  }

  const [{ data: member, error: memberError }, typeResult] =
    await Promise.all([
      context.admin
        .from("department_memberships")
        .select("user_id")
        .eq("department_id", context.departmentId)
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle(),

      context.admin
        .from("certification_types")
        .select(
          "id,name,issuing_organization,expiration_required",
        )
        .eq("department_id", context.departmentId)
        .eq("id", certificationTypeId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

  if (memberError) {
    return NextResponse.json(
      { error: memberError.message },
      { status: 500 },
    );
  }

  if (!member) {
    return NextResponse.json(
      {
        error:
          "The selected officer is not an active department member.",
      },
      { status: 400 },
    );
  }

  if (typeResult.error) {
    return NextResponse.json(
      { error: typeResult.error.message },
      { status: 500 },
    );
  }

  if (!typeResult.data) {
    return NextResponse.json(
      {
        error:
          "The selected certification type is not available for this department.",
      },
      { status: 400 },
    );
  }

  const certificationType = typeResult.data;

  const issueDate = dateOrNull(body.issueDate);
  const expirationDate = dateOrNull(body.expirationDate);

  if (
    certificationType.expiration_required &&
    !expirationDate
  ) {
    return NextResponse.json(
      {
        error:
          "An expiration date is required for this certification type.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await context.admin
    .from("training_certifications")
    .insert({
      department_id: context.departmentId,
      user_id: userId,
      certification_type_id: certificationType.id,
      certification_title: certificationType.name,
      issuing_organization:
        text(body.issuingOrganization) ||
        certificationType.issuing_organization ||
        null,
      credential_number:
        text(body.credentialNumber) || null,
      issue_date: issueDate,
      expiration_date: expirationDate,
      reminder_days: reminderDays(body.reminderDays),
      document_url: text(body.documentUrl) || null,
      notes: text(body.notes) || null,
      created_by_user_id: context.user.id,
      updated_by_user_id: context.user.id,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { certification: data },
    { status: 201 },
  );
}
