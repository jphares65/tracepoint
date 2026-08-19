import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

import {
  evaluateEquipmentReadiness,
  summarizeEquipmentReadiness,
} from "@/lib/tracepoint/equipment-readiness";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return accessFailureResponse(access);
  }

  const context = access.context;

  const featureError = requireServerFeature(
    context,
    "equipment_readiness",
    "Equipment Readiness",
  );

  if (featureError) {
    return featureError;
  }

  const admin = context.admin;
  const departmentId = context.departmentId;
  const userId = context.userId;

  const canViewDepartment = hasAnyServerPermission(context, [
    "manage_equipment",
    "administer_department",
    "view_command_dashboard",
    "view_analytics",
  ]);

  let membersQuery = admin
    .from("department_memberships")
    .select(
      "user_id,badge_number,rank_title,is_active",
    )
    .eq("department_id", departmentId)
    .eq("is_active", true);

  let assetsQuery = admin
    .from("equipment_assets")
    .select(
      [
        "id",
        "equipment_type_id",
        "assigned_user_id",
        "manufacturer",
        "model",
        "serial_number",
        "lot_number",
        "issue_date",
        "expiration_date",
        "last_inspection_date",
        "next_inspection_date",
        "lifecycle_status",
      ].join(","),
    )
    .eq("department_id", departmentId)
    .neq("lifecycle_status", "removed");

  if (!canViewDepartment) {
    membersQuery = membersQuery.eq("user_id", userId);

    assetsQuery = assetsQuery.eq("assigned_user_id", userId);
  }

  const [
    membersResult,
    typesResult,
    requirementsResult,
    assetsResult,
  ] = await Promise.all([
    membersQuery,

    admin
      .from("equipment_types")
      .select(
        [
          "id",
          "name",
          "category",
          "expiration_required",
          "default_valid_days",
          "default_due_soon_days",
          "inspection_required",
          "default_inspection_interval_days",
          "default_inspection_due_soon_days",
          "is_active",
        ].join(","),
      )
      .eq("department_id", departmentId)
      .eq("is_active", true),

    admin
      .from("department_equipment_requirements")
      .select(
        [
          "equipment_type_id",
          "is_required",
          "required_quantity",
          "valid_days",
          "due_soon_days",
          "inspection_interval_days",
          "inspection_due_soon_days",
          "is_active",
        ].join(","),
      )
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .eq("is_required", true),

    assetsQuery,
  ]);

  for (const result of [
    membersResult,
    typesResult,
    requirementsResult,
    assetsResult,
  ]) {
    if (result.error) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }
  }

  const memberRows = membersResult.data ?? [];

  const userIds = memberRows.map(
    (row: any) => String(row.user_id),
  );

  let profiles: any[] = [];

  if (userIds.length > 0) {
    const { data, error } = await admin
      .from("profiles")
      .select("id,full_name")
      .in("id", userIds);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
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

  const members = memberRows.map(
    (row: any) => ({
      userId: String(row.user_id),

      fullName:
        text(
          profilesById.get(
            String(row.user_id),
          )?.full_name,
        ) ||
        text(row.rank_title) ||
        "Unnamed Officer",

      badgeNumber:
        row.badge_number ?? null,

      rankTitle:
        row.rank_title ?? null,
    }),
  );

  const equipmentTypes = (
    typesResult.data ?? []
  ).map((row: any) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(
      row.category ?? "General",
    ),

    expirationRequired:
      row.expiration_required === true,

    defaultValidDays:
      row.default_valid_days === null ||
      row.default_valid_days === undefined
        ? null
        : Number(row.default_valid_days),

    defaultDueSoonDays: Number(
      row.default_due_soon_days ?? 30,
    ),

    inspectionRequired:
      row.inspection_required === true,

    defaultInspectionIntervalDays:
      row.default_inspection_interval_days ===
        null ||
      row.default_inspection_interval_days ===
        undefined
        ? null
        : Number(
            row.default_inspection_interval_days,
          ),

    defaultInspectionDueSoonDays: Number(
      row.default_inspection_due_soon_days ??
        30,
    ),
  }));

  const requirements = (
    requirementsResult.data ?? []
  ).map((row: any) => ({
    equipmentTypeId: String(
      row.equipment_type_id,
    ),

    isRequired:
      row.is_required !== false,

    isActive:
      row.is_active !== false,

    requiredQuantity: Math.max(
      1,
      Number(row.required_quantity ?? 1),
    ),

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

    inspectionIntervalDays:
      row.inspection_interval_days === null ||
      row.inspection_interval_days === undefined
        ? null
        : Number(
            row.inspection_interval_days,
          ),

    inspectionDueSoonDays:
      row.inspection_due_soon_days === null ||
      row.inspection_due_soon_days === undefined
        ? null
        : Number(
            row.inspection_due_soon_days,
          ),
  }));

  const assets = (
    assetsResult.data ?? []
  ).map((row: any) => ({
    id: String(row.id),

    userId:
      row.assigned_user_id
        ? String(row.assigned_user_id)
        : null,

    equipmentTypeId: String(
      row.equipment_type_id,
    ),

    manufacturer:
      row.manufacturer ?? null,

    model:
      row.model ?? null,

    serialNumber:
      row.serial_number ?? null,

    lotNumber:
      row.lot_number ?? null,

    issueDate:
      row.issue_date ?? null,

    expirationDate:
      row.expiration_date ?? null,

    lastInspectionDate:
      row.last_inspection_date ?? null,

    nextInspectionDate:
      row.next_inspection_date ?? null,

    lifecycleStatus:
      row.lifecycle_status,
  }));

  const rows =
    evaluateEquipmentReadiness({
      members,
      equipmentTypes,
      requirements,
      assets,
    });

  const summary =
    summarizeEquipmentReadiness(rows);

  return NextResponse.json(
    {
      scope: canViewDepartment
        ? "department"
        : "self",

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
