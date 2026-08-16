import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  accessFailureResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

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

async function contextForRequest() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "You must be signed in.",
      status: 401,
    } as const;
  }

  const admin = createAdminClient() as any;

  const { data: membership, error: membershipError } =
    await admin
      .from("department_memberships")
      .select("department_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

  if (membershipError) {
    return {
      error: membershipError.message,
      status: 500,
    } as const;
  }

  if (!membership?.department_id) {
    return {
      error: "No active department membership was found.",
      status: 403,
    } as const;
  }

  const departmentId = String(membership.department_id);

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
      error:
        "You do not have permission to manage certifications.",
      status: 403,
    } as const;
  }

  return {
    admin,
    user,
    departmentId,
  } as const;
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ certificationId: string }>;
  },
) {
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
  const context = await contextForRequest();

  if ("error" in context) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  }

  const { certificationId } = await params;

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

  const [
    existingResult,
    memberResult,
    typeResult,
  ] = await Promise.all([
    context.admin
      .from("training_certifications")
      .select("id")
      .eq("id", certificationId)
      .eq("department_id", context.departmentId)
      .eq("is_active", true)
      .maybeSingle(),

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

  if (existingResult.error) {
    return NextResponse.json(
      { error: existingResult.error.message },
      { status: 500 },
    );
  }

  if (!existingResult.data) {
    return NextResponse.json(
      { error: "Certification record not found." },
      { status: 404 },
    );
  }

  if (memberResult.error) {
    return NextResponse.json(
      { error: memberResult.error.message },
      { status: 500 },
    );
  }

  if (!memberResult.data) {
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
    .update({
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
      updated_by_user_id: context.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", certificationId)
    .eq("department_id", context.departmentId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    certification: data,
  });
}

export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ certificationId: string }>;
  },
) {
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
  const context = await contextForRequest();

  if ("error" in context) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  }

  const { certificationId } = await params;

  const { data, error } = await context.admin
    .from("training_certifications")
    .update({
      is_active: false,
      updated_by_user_id: context.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", certificationId)
    .eq("department_id", context.departmentId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Certification record not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}

