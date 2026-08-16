import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

import {
  evaluateCertificationReadiness,
  summarizeCertificationReadiness,
} from "@/lib/tracepoint/certification-readiness";

export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return accessFailureResponse(access);
  }

  const context = access.context;

  if (
    !hasAnyServerPermission(context, [
      "manage_certifications",
      "view_command_dashboard",
      "view_analytics",
    ])
  ) {
    return permissionDeniedResponse(
      "You do not have permission to view department certification readiness.",
    );
  }

  const [
    membershipsResult,
    typesResult,
    requirementsResult,
    credentialsResult,
  ] = await Promise.all([
    context.admin
      .from("department_memberships")
      .select(
        "user_id,badge_number,rank_title,is_active",
      )
      .eq("department_id", context.departmentId)
      .eq("is_active", true),

    context.admin
      .from("certification_types")
      .select(
        "id,name,category,expiration_required,default_valid_days,default_due_soon_days,is_active",
      )
      .eq("department_id", context.departmentId)
      .eq("is_active", true),

    context.admin
      .from("department_certification_requirements")
      .select(
        "certification_type_id,is_required,is_active,valid_days,due_soon_days",
      )
      .eq("department_id", context.departmentId)
      .eq("is_active", true),

    context.admin
      .from("training_certifications")
      .select(
        "id,user_id,certification_type_id,issue_date,expiration_date,is_active",
      )
      .eq("department_id", context.departmentId)
      .eq("is_active", true),
  ]);

  if (membershipsResult.error) {
    return NextResponse.json(
      { error: membershipsResult.error.message },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (typesResult.error) {
    return NextResponse.json(
      { error: typesResult.error.message },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (requirementsResult.error) {
    return NextResponse.json(
      { error: requirementsResult.error.message },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (credentialsResult.error) {
    return NextResponse.json(
      { error: credentialsResult.error.message },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const memberships = membershipsResult.data ?? [];

  const userIds = memberships.map((row: any) =>
    String(row.user_id),
  );

  let profiles: any[] = [];

  if (userIds.length > 0) {
    const { data, error } = await context.admin
      .from("profiles")
      .select("id,full_name")
      .in("id", userIds);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    profiles = data ?? [];
  }

  const profilesById = new Map(
    profiles.map((profile: any) => [
      String(profile.id),
      profile,
    ]),
  );

  const members = memberships.map(
    (membership: any) => {
      const profile = profilesById.get(
        String(membership.user_id),
      );

      return {
        userId: String(membership.user_id),
        fullName:
          profile?.full_name ||
          membership.rank_title ||
          "Unnamed Officer",
        badgeNumber:
          membership.badge_number ?? null,
        rankTitle:
          membership.rank_title ?? null,
      };
    },
  );

  const certificationTypes = (
    typesResult.data ?? []
  ).map((row: any) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category ?? "General"),
    expirationRequired:
      row.expiration_required !== false,
    defaultValidDays:
      row.default_valid_days === null ||
      row.default_valid_days === undefined
        ? null
        : Number(row.default_valid_days),
    defaultDueSoonDays: Number(
      row.default_due_soon_days ?? 30,
    ),
  }));

  const requirements = (
    requirementsResult.data ?? []
  ).map((row: any) => ({
    certificationTypeId: String(
      row.certification_type_id,
    ),
    isRequired: row.is_required !== false,
    isActive: row.is_active !== false,
    validDays:
      row.valid_days === null ||
      row.valid_days === undefined
        ? null
        : Number(row.valid_days),
    dueSoonDays:
      row.due_soon_days === null ||
      row.due_soon_days === undefined
        ? null
        : Number(row.due_soon_days),
  }));

  const credentials = (
    credentialsResult.data ?? []
  )
    .filter(
      (row: any) =>
        row.certification_type_id,
    )
    .map((row: any) => ({
      id: String(row.id),
      userId: String(row.user_id),
      certificationTypeId: String(
        row.certification_type_id,
      ),
      issueDate: row.issue_date ?? null,
      expirationDate: row.expiration_date ?? null,
      isActive: row.is_active !== false,
    }));

  const rows = evaluateCertificationReadiness({
    members,
    certificationTypes,
    requirements,
    credentials,
  });

  const summary =
    summarizeCertificationReadiness(rows);

  return NextResponse.json(
    {
      summary,
      rows,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
