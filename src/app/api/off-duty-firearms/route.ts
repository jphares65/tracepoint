import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

import {
  getOfficerQualificationReadiness,
} from "@/lib/tracepoint/off-duty-qualification-readiness";

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canManageOffDutyInspections(context: any) {
  return hasAnyServerPermission(context, [
    "manage_inspections",
    "manage_firearms",
    "review_off_duty_requests",
    "administer_department",
  ]);
}

function isCommandReviewer(context: any) {
  return (
    context.roleCodes.some((role: string) =>
      [
        "chief",
        "administrator",
        "department_admin",
        "admin",
        "command_staff",
      ].includes(role),
    ) ||
    hasAnyServerPermission(context, [
      "review_off_duty_requests",
      "manage_firearms",
      "administer_department",
    ])
  );
}

async function loadOfficerIdentities(
  admin: any,
  departmentId: string,
  userIds: string[],
) {
  if (userIds.length === 0) {
    return new Map<
      string,
      { name: string; badge: string; unit: string }
    >();
  }

  const [profilesResult, membershipsResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id,full_name")
      .in("id", userIds),

    admin
      .from("department_memberships")
      .select("user_id,badge_number,unit_name")
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .in("user_id", userIds),
  ]);

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }

  if (membershipsResult.error) {
    throw new Error(membershipsResult.error.message);
  }

  const membershipMap = new Map<
    string,
    { badge: string; unit: string }
  >(
    (membershipsResult.data ?? []).map((row: any) => [
      String(row.user_id),
      {
        badge: cleanText(row.badge_number) ?? "",
        unit: cleanText(row.unit_name) ?? "",
      },
    ] as const),
  );

  return new Map<
    string,
    { name: string; badge: string; unit: string }
  >(
    (profilesResult.data ?? []).map((row: any) => {
      const userId = String(row.id);
      const membership = membershipMap.get(userId);

      return [
        userId,
        {
          name: cleanText(row.full_name) ?? "Unknown User",
          badge: membership?.badge ?? "",
          unit: membership?.unit ?? "",
        },
      ] as const;
    }),
  );
}

async function loadRequests(context: any) {
  let query = context.admin
    .from("off_duty_firearm_requests")
    .select("*")
    .eq("department_id", context.departmentId)
    .order("submitted_at", { ascending: false });

  if (
    !isCommandReviewer(context) &&
    !canManageOffDutyInspections(context)
  ) {
    query = query.eq("officer_user_id", context.userId);
  }

  const { data: requestRows, error: requestError } = await query;

  if (requestError) throw new Error(requestError.message);

  const requestIds = (requestRows ?? []).map((row: any) => String(row.id));

  const { data: historyRows, error: historyError } =
    requestIds.length > 0
      ? await context.admin
          .from("off_duty_firearm_history")
          .select("*")
          .eq("department_id", context.departmentId)
          .in("request_id", requestIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };

  if (historyError) throw new Error(historyError.message);

  const { data: inspectionRows, error: inspectionError } =
    requestIds.length > 0
      ? await context.admin
          .from("off_duty_firearm_inspections")
          .select(
            "request_id,inspection_date,result,created_at",
          )
          .eq("department_id", context.departmentId)
          .in("request_id", requestIds)
          .order("inspection_date", { ascending: false })
          .order("created_at", { ascending: false })
      : { data: [], error: null };

  if (inspectionError) {
    throw new Error(inspectionError.message);
  }

  const { data: rulesRow, error: rulesError } =
    await context.admin
      .from("department_rules")
      .select("inspection_interval_days,inspection_due_soon_days")
      .eq("department_id", context.departmentId)
      .maybeSingle();

  if (rulesError) {
    throw new Error(rulesError.message);
  }

  const inspectionIntervalDays =
    Number(rulesRow?.inspection_interval_days) || 180;

  const rawInspectionDueSoonDays =
    rulesRow?.inspection_due_soon_days;

  const inspectionDueSoonDays =
    rawInspectionDueSoonDays === null ||
    rawInspectionDueSoonDays === undefined
      ? 30
      : Number(rawInspectionDueSoonDays);

  const latestInspectionByRequest = new Map<string, any>();

  for (const row of inspectionRows ?? []) {
    const requestId = String(row.request_id);

    if (!latestInspectionByRequest.has(requestId)) {
      latestInspectionByRequest.set(requestId, row);
    }
  }

  function inspectionStatusForRequest(
    requestId: string,
  ): "Current" | "Due Soon" | "Overdue" | "Not Inspected" {
    const inspection =
      latestInspectionByRequest.get(requestId);

    if (!inspection || inspection.result !== "Pass") {
      return "Not Inspected";
    }

    const inspectedAt = new Date(
      `${inspection.inspection_date}T00:00:00`,
    ).getTime();

    const today = new Date();
    const todayAt = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    ).getTime();

    const daysSinceInspection = Math.floor(
      (todayAt - inspectedAt) / 86_400_000,
    );

    if (
      !Number.isFinite(daysSinceInspection) ||
      daysSinceInspection > inspectionIntervalDays
    ) {
      return "Overdue";
    }

    const remainingDays =
      inspectionIntervalDays - daysSinceInspection;

    if (remainingDays <= inspectionDueSoonDays) {
      return "Due Soon";
    }

    return "Current";
  }

  const userIds = Array.from(
    new Set(
      [
        ...(requestRows ?? []).map((row: any) => row.officer_user_id),
        ...(requestRows ?? []).map((row: any) => row.reviewed_by_user_id),
      ]
        .filter(Boolean)
        .map(String),
    ),
  );

  const officerIdentities = await loadOfficerIdentities(
    context.admin,
    context.departmentId,
    userIds,
  );

  const historyByRequest = new Map<string, any[]>();

  for (const row of historyRows ?? []) {
    const requestId = String(row.request_id);

    if (!historyByRequest.has(requestId)) {
      historyByRequest.set(requestId, []);
    }

    historyByRequest.get(requestId)!.push({
      id: String(row.id),
      action: row.action,
      actor: row.actor_name,
      actorRole: row.actor_role,
      timestamp: row.created_at,
      notes: row.notes ?? undefined,
    });
  }

  const records = await Promise.all(
    (requestRows ?? []).map(async (row: any) => {
      const qualificationReadiness =
        await getOfficerQualificationReadiness(
          context,
          String(row.officer_user_id),
        );

      const today = new Date();
      const todayAt = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      ).getTime();

      const effectiveAt = row.approval_effective_date
        ? new Date(
            `${row.approval_effective_date}T00:00:00`,
          ).getTime()
        : null;

      const expirationAt = row.approval_expiration_date
        ? new Date(
            `${row.approval_expiration_date}T00:00:00`,
          ).getTime()
        : null;

      let authorizationStatus = "Not Authorized";

      if (row.authorization_status === "Revoked") {
        authorizationStatus = "Revoked";
      } else if (row.request_status === "Approved") {
        if (
          expirationAt !== null &&
          Number.isFinite(expirationAt) &&
          expirationAt < todayAt
        ) {
          authorizationStatus = "Expired";
        } else if (
          effectiveAt !== null &&
          Number.isFinite(effectiveAt) &&
          effectiveAt > todayAt
        ) {
          authorizationStatus = "Not Authorized";
        } else {
          authorizationStatus = "Authorized";
        }
      }

      const inspectionStatus =
        inspectionStatusForRequest(String(row.id));

      const compliance =
        authorizationStatus === "Authorized" &&
        ["Current", "Due Soon"].includes(
          qualificationReadiness.status,
        ) &&
        ["Current", "Due Soon"].includes(
          inspectionStatus,
        )
          ? "Authorized"
          : authorizationStatus === "Expired" ||
              authorizationStatus === "Revoked" ||
              qualificationReadiness.status === "Overdue" ||
              inspectionStatus === "Overdue"
            ? "Non-Compliant"
            : "At Risk";

      return {
        id: String(row.id),
    officerId: String(row.officer_user_id),
    officer:
      officerIdentities.get(String(row.officer_user_id))?.name ?? "Unknown Officer",
    badge:
      officerIdentities.get(String(row.officer_user_id))?.badge ?? "",
    unit:
      officerIdentities.get(String(row.officer_user_id))?.unit ?? "",
    make: row.make,
    model: row.model,
    firearmType: row.firearm_type,
    serial: row.serial_number,
    caliber: row.caliber,
    capacity: row.capacity ?? "",
    optic: row.optic ?? "",
    weaponLight: row.weapon_light ?? "",
    holster: row.holster ?? "",
    proofOwnership: row.proof_ownership === true,
    qualificationReviewed: row.qualification_reviewed === true,
    inspectionReviewed: row.inspection_reviewed === true,
    policyAcknowledged: row.policy_acknowledged === true,
    officerNotes: row.officer_notes ?? "",
    requestStatus: row.request_status,
    authorizationStatus,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedBy: row.reviewed_by_user_id
      ? officerIdentities.get(String(row.reviewed_by_user_id))?.name ?? "Unknown Reviewer"
      : undefined,
    approvalDate: row.approval_effective_date ?? undefined,
    approvalExpires: row.approval_expiration_date ?? undefined,
    decisionNotes: row.decision_notes ?? undefined,
        lastQual: qualificationReadiness.status,
        qualificationStatus: qualificationReadiness.status,
        qualificationReason: qualificationReadiness.statusReason,
        inspectionStatus,
        compliance,
        auditTrail: historyByRequest.get(String(row.id)) ?? [],
      };
    }),
  );

  return records;
}

async function loadOffDutyReviewerUserIds(context: any) {
  const legacyCommandRoles = [
    "chief",
    "administrator",
    "department_admin",
    "admin",
    "command_staff",
  ];

  const { data: permissionRows, error: permissionError } =
    await context.admin
      .from("department_role_permissions")
      .select("role_code,permission_code")
      .eq("department_id", context.departmentId)
      .in("permission_code", [
        "review_off_duty_requests",
        "manage_firearms",
        "administer_department",
      ]);

  if (permissionError) {
    throw new Error(permissionError.message);
  }

  const reviewerRoleCodes = Array.from(
    new Set([
      ...legacyCommandRoles,
      ...(permissionRows ?? [])
        .map((row: any) => String(row.role_code ?? ""))
        .filter(Boolean),
    ]),
  );

  if (reviewerRoleCodes.length === 0) {
    return [];
  }

  const { data: membershipRows, error: membershipError } =
    await context.admin
      .from("department_membership_roles")
      .select("user_id,role_code")
      .eq("department_id", context.departmentId)
      .in("role_code", reviewerRoleCodes);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  return Array.from(
    new Set(
      (membershipRows ?? [])
        .map((row: any) => String(row.user_id ?? ""))
        .filter(Boolean),
    ),
  );
}

async function createCommandNotifications(
  context: any,
  requestId: string,
  firearmLabel: string,
) {
  const commandUserIds =
    await loadOffDutyReviewerUserIds(context);

  if (commandUserIds.length === 0) return;

  const now = new Date().toISOString();

  const notifications = commandUserIds.map((userId) => ({
    department_id: context.departmentId,
    user_id: userId,
    notification_key: `off-duty-review-${requestId}`,
    source: "Off-Duty",
    kind: "off_duty_firearm_review_required",
    title: "Off-Duty Firearm Approval Request",
    detail: `${context.fullName} submitted ${firearmLabel} for command review.`,
    href: "/off-duty-firearms",
    priority: "High",
    fingerprint: JSON.stringify({
      requestId,
      status: "Pending Command Review",
    }),
    source_created_at: now,
    first_seen_at: now,
    last_seen_at: now,
    resolved_at: null,
    updated_at: now,
  }));

  const { error } = await context.admin
    .from("notification_events")
    .upsert(notifications);

  if (error) throw new Error(error.message);
}

export async function GET() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const context = resolved.context;

  const featureError = requireServerFeature(
    context,
    "off_duty",
    "Off-Duty Firearms",
  );

  if (featureError) {
    return featureError;
  }

  try {
    const records = await loadRequests(context);

    return NextResponse.json({
      records,
      currentUser: {
        id: context.userId,
        name: context.fullName,
        badge: context.badgeNumber,
        unit: context.unitName,
        role: context.primaryRoleLabel,
      },
      canReview: isCommandReviewer(context),
      canManageInspections:
        canManageOffDutyInspections(context),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Off-duty firearm requests could not be loaded.",
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

  const context = resolved.context;

  const featureError = requireServerFeature(
    context,
    "off_duty",
    "Off-Duty Firearms",
  );

  if (featureError) {
    return featureError;
  }

  const body = (await request.json().catch(() => ({}))) as {
    make?: string;
    model?: string;
    firearmType?: string;
    serial?: string;
    caliber?: string;
    capacity?: string;
    optic?: string;
    weaponLight?: string;
    holster?: string;
    proofOwnership?: boolean;
    qualificationReviewed?: boolean;
    inspectionReviewed?: boolean;
    policyAcknowledged?: boolean;
    officerNotes?: string;
  };

  const make = cleanText(body.make);
  const model = cleanText(body.model);
  const firearmType = cleanText(body.firearmType);
  const serial = cleanText(body.serial);
  const caliber = cleanText(body.caliber);

  if (!make || !model || !firearmType || !serial || !caliber) {
    return NextResponse.json(
      {
        error:
          "Make, model, firearm type, serial number, and caliber are required.",
      },
      { status: 400 },
    );
  }

  if (body.policyAcknowledged !== true) {
    return NextResponse.json(
      {
        error:
          "The off-duty firearm policy acknowledgement is required.",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  try {
    const { data: createdRequestId, error: submitError } =
      await context.admin.rpc(
        "submit_off_duty_firearm_request",
        {
          p_department_id: context.departmentId,
          p_officer_user_id: context.userId,
          p_actor_name: context.fullName,
          p_actor_role: context.primaryRoleLabel,
          p_make: make,
          p_model: model,
          p_firearm_type: firearmType,
          p_serial_number: serial,
          p_caliber: caliber,
          p_capacity: cleanText(body.capacity),
          p_optic: cleanText(body.optic),
          p_weapon_light: cleanText(body.weaponLight),
          p_holster: cleanText(body.holster),
          p_proof_ownership: body.proofOwnership === true,
          p_qualification_reviewed:
            body.qualificationReviewed === true,
          p_inspection_reviewed:
            body.inspectionReviewed === true,
          p_policy_acknowledged: true,
          p_officer_notes: cleanText(body.officerNotes),
        },
      );

    if (submitError) {
      throw new Error(submitError.message);
    }

    if (!createdRequestId) {
      throw new Error(
        "The off-duty firearm request was not created.",
      );
    }

    const requestId = String(createdRequestId);

    try {
      await createCommandNotifications(
        context,
        requestId,
        `${make} ${model} (${serial})`,
      );
    } catch (notificationError) {
      console.error(
        "Off-duty request was saved but command notification creation failed:",
        notificationError,
      );
    }

    const records = await loadRequests(context);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        records,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The off-duty firearm request could not be submitted.";

    if (
      message.includes(
        "off_duty_firearm_requests_department_id_serial_number_key",
      ) ||
      message.toLowerCase().includes("duplicate key")
    ) {
      return NextResponse.json(
        {
          error:
            "An off-duty firearm request with this serial number already exists for the department.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
