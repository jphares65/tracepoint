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

async function getContext() {
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

  const { data: membership, error: membershipError } = await admin
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

  const [
    certificationsResult,
    membershipsResult,
    typesResult,
    requirementsResult,
  ] = await Promise.all([
    context.admin
      .from("training_certifications")
      .select("*")
      .eq("department_id", context.departmentId)
      .eq("is_active", true)
      .order("expiration_date", {
        ascending: true,
        nullsFirst: false,
      }),

    context.admin
      .from("department_memberships")
      .select("user_id,badge_number,rank_title,is_active")
      .eq("department_id", context.departmentId)
      .eq("is_active", true),

    context.admin
      .from("certification_types")
      .select(
        "id,department_id,name,description,category,issuing_organization,expiration_required,default_valid_days,default_due_soon_days,is_active",
      )
      .eq("department_id", context.departmentId)
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true }),

    context.admin
      .from("department_certification_requirements")
      .select(
        "id,department_id,certification_type_id,is_required,valid_days,due_soon_days,is_active,notes",
      )
      .eq("department_id", context.departmentId)
      .eq("is_active", true),
  ]);

  if (certificationsResult.error) {
    return NextResponse.json(
      { error: certificationsResult.error.message },
      { status: 500 },
    );
  }

  if (membershipsResult.error) {
    return NextResponse.json(
      { error: membershipsResult.error.message },
      { status: 500 },
    );
  }

  if (typesResult.error) {
    return NextResponse.json(
      { error: typesResult.error.message },
      { status: 500 },
    );
  }

  if (requirementsResult.error) {
    return NextResponse.json(
      { error: requirementsResult.error.message },
      { status: 500 },
    );
  }

  const memberships = membershipsResult.data ?? [];

  const userIds = memberships.map((row: any) =>
    String(row.user_id),
  );

  let profiles: any[] = [];

  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } =
      await context.admin
        .from("profiles")
        .select("id,full_name")
        .in("id", userIds);

    if (profileError) {
      return NextResponse.json(
        { error: profileError.message },
        { status: 500 },
      );
    }

    profiles = profileRows ?? [];
  }

  const profilesById = new Map(
    profiles.map((profile: any) => [
      String(profile.id),
      profile,
    ]),
  );

  const members = memberships
    .map((membership: any) => {
      const profile = profilesById.get(
        String(membership.user_id),
      );

      return {
        user_id: String(membership.user_id),
        full_name:
          profile?.full_name ||
          membership.rank_title ||
          "Unnamed Officer",
        badge_number: membership.badge_number ?? null,
        rank_title: membership.rank_title ?? null,
        is_active: membership.is_active ?? true,
      };
    })
    .sort((left: any, right: any) =>
      left.full_name.localeCompare(right.full_name),
    );

  return NextResponse.json({
    certifications: certificationsResult.data ?? [],
    members,
    certificationTypes: typesResult.data ?? [],
    requirements: requirementsResult.data ?? [],
    canManage: context.canManage,
  });
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

