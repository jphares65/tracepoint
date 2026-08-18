import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

import {
  getOfficerQualificationReadiness,
} from "@/lib/tracepoint/off-duty-qualification-readiness";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

const COMMAND_ROLES = [
  "chief",
  "administrator",
  "department_admin",
  "admin",
  "command_staff",
];

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isCommandReviewer(context: any) {
  return (
    context.roleCodes.some((role: string) => COMMAND_ROLES.includes(role)) ||
    hasAnyServerPermission(context, [
      "review_off_duty_requests",
      "manage_firearms",
      "administer_department",
    ])
  );
}

async function loadRequest(context: any, requestId: string) {
  const { data, error } = await context.admin
    .from("off_duty_firearm_requests")
    .select("*")
    .eq("id", requestId)
    .eq("department_id", context.departmentId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

type OffDutyInspectionReadiness = {
  status: "Current" | "Due Soon" | "Overdue" | "Not Inspected" | "Failed";
  statusReason: string;
};

async function getOffDutyInspectionReadiness(
  context: any,
  requestId: string,
): Promise<OffDutyInspectionReadiness> {
  const [inspectionResult, rulesResult] = await Promise.all([
    context.admin
      .from("off_duty_firearm_inspections")
      .select("inspection_date,result,created_at")
      .eq("department_id", context.departmentId)
      .eq("request_id", requestId)
      .order("inspection_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    context.admin
      .from("department_rules")
      .select("inspection_interval_days,inspection_due_soon_days")
      .eq("department_id", context.departmentId)
      .maybeSingle(),
  ]);

  if (inspectionResult.error) {
    throw new Error(inspectionResult.error.message);
  }

  if (rulesResult.error) {
    throw new Error(rulesResult.error.message);
  }

  const inspection = inspectionResult.data;

  if (!inspection) {
    return {
      status: "Not Inspected",
      statusReason: "No firearm inspection has been recorded.",
    };
  }

  if (inspection.result !== "Pass") {
    return {
      status: "Failed",
      statusReason:
        "The most recent firearm inspection did not pass.",
    };
  }

  const inspectionIntervalDays =
    Number(rulesResult.data?.inspection_interval_days) || 180;

  const rawDueSoonDays =
    rulesResult.data?.inspection_due_soon_days;

  const inspectionDueSoonDays =
    rawDueSoonDays === null || rawDueSoonDays === undefined
      ? 30
      : Number(rawDueSoonDays);

  const inspectionDate = new Date(
    `${inspection.inspection_date}T00:00:00`,
  );

  if (Number.isNaN(inspectionDate.getTime())) {
    return {
      status: "Overdue",
      statusReason:
        "The most recent firearm inspection date is invalid.",
    };
  }

  const ageDays = Math.floor(
    (Date.now() - inspectionDate.getTime()) /
      (1000 * 60 * 60 * 24),
  );

  if (ageDays > inspectionIntervalDays) {
    return {
      status: "Overdue",
      statusReason:
        "The most recent passing firearm inspection has expired.",
    };
  }

  const remainingDays =
    inspectionIntervalDays - ageDays;

  if (remainingDays <= inspectionDueSoonDays) {
    return {
      status: "Due Soon",
      statusReason:
        `The firearm inspection remains current but expires in ${remainingDays} day${remainingDays === 1 ? "" : "s"}.`,
    };
  }

  return {
    status: "Current",
    statusReason:
      "The firearm has a current passing inspection.",
  };
}

async function resolveCommandNotifications(
  context: any,
  requestId: string,
) {
  const now = new Date().toISOString();

  const { error } = await context.admin
    .from("notification_events")
    .update({
      resolved_at: now,
      updated_at: now,
    })
    .eq("department_id", context.departmentId)
    .eq("notification_key", `off-duty-review-${requestId}`)
    .is("resolved_at", null);

  if (error) throw new Error(error.message);
}

async function createOfficerNotification(
  context: any,
  officerUserId: string,
  requestId: string,
  action: "Approve" | "Deny" | "Return",
  firearmLabel: string,
  notes: string | null,
  expirationDate: string | null,
) {
  const now = new Date().toISOString();

  const title =
    action === "Approve"
      ? "Off-Duty Firearm Approved"
      : action === "Deny"
        ? "Off-Duty Firearm Request Denied"
        : "Off-Duty Firearm Request Returned";

  const detail =
    action === "Approve"
      ? `${firearmLabel} has been approved for off-duty carry${
          expirationDate ? ` through ${expirationDate}` : ""
        }.`
      : `${firearmLabel}: ${notes ?? "Review the request for details."}`;

  const { error } = await context.admin
    .from("notification_events")
    .upsert({
      department_id: context.departmentId,
      user_id: officerUserId,
      notification_key: `off-duty-decision-${requestId}`,
      source: "Off-Duty",
      kind:
        action === "Approve"
          ? "off_duty_firearm_approved"
          : action === "Deny"
            ? "off_duty_firearm_denied"
            : "off_duty_firearm_returned",
      title,
      detail,
      href: "/off-duty-firearms",
      priority: action === "Approve" ? "Normal" : "High",
      fingerprint: JSON.stringify({
        requestId,
        action,
        notes,
        expirationDate,
      }),
      source_created_at: now,
      first_seen_at: now,
      last_seen_at: now,
      resolved_at: null,
      updated_at: now,
    });

  if (error) throw new Error(error.message);
}

async function loadOffDutyReviewerUserIds(context: any) {
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
      ...COMMAND_ROLES,
      ...(permissionRows ?? [])
        .map((row: any) => String(row.role_code ?? ""))
        .filter(Boolean),
    ]),
  );

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
  const userIds =
    await loadOffDutyReviewerUserIds(context);

  if (userIds.length === 0) return;

  const now = new Date().toISOString();

  const rows = userIds.map((userId) => ({
    department_id: context.departmentId,
    user_id: userId,
    notification_key: `off-duty-review-${requestId}`,
    source: "Off-Duty",
    kind: "off_duty_firearm_review_required",
    title: "Off-Duty Firearm Approval Request",
    detail: `${context.fullName} resubmitted ${firearmLabel} for command review.`,
    href: "/off-duty-firearms",
    priority: "High",
    fingerprint: JSON.stringify({
      requestId,
      status: "Pending Command Review",
      resubmittedAt: now,
    }),
    source_created_at: now,
    first_seen_at: now,
    last_seen_at: now,
    resolved_at: null,
    updated_at: now,
  }));

  const { error } = await context.admin
    .from("notification_events")
    .upsert(rows);

  if (error) throw new Error(error.message);
}

export async function PATCH(
  request: NextRequest,
  routeContext: RouteContext,
) {
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

  const { requestId } = await routeContext.params;

  const body = (await request.json().catch(() => ({}))) as {
    action?: "Resubmit" | "Approve" | "Deny" | "Return";
    notes?: string;
    effectiveDate?: string;
    expirationDate?: string;

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

  if (!["Resubmit", "Approve", "Deny", "Return"].includes(body.action ?? "")) {
    return NextResponse.json(
      { error: "Invalid off-duty firearm action." },
      { status: 400 },
    );
  }

  try {
    const existing = await loadRequest(context, requestId);

    if (!existing) {
      return NextResponse.json(
        { error: "Off-duty firearm request not found." },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();

    if (body.action === "Resubmit") {
      if (existing.officer_user_id !== context.userId) {
        return permissionDeniedResponse(
          "Only the submitting officer may resubmit this request.",
        );
      }

      if (existing.request_status !== "Returned for Correction") {
        return NextResponse.json(
          {
            error:
              "Only requests returned for correction may be resubmitted.",
          },
          { status: 409 },
        );
      }

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
      const { error: resubmitError } = await context.admin.rpc(
        "resubmit_off_duty_firearm_request",
        {
          p_department_id: context.departmentId,
          p_request_id: requestId,
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

      if (resubmitError) {
        throw new Error(resubmitError.message);
      }

      try {
        await createCommandNotifications(
          context,
          requestId,
          `${make} ${model} (${serial})`,
        );
      } catch (notificationError) {
        console.error(
          "Off-duty request was resubmitted but command notification creation failed:",
          notificationError,
        );
      }

      return NextResponse.json({ ok: true });
    }

    if (!isCommandReviewer(context)) {
      return permissionDeniedResponse(
        "Command authorization is required to review off-duty firearm requests.",
      );
    }

    if (existing.request_status !== "Pending Command Review") {
      return NextResponse.json(
        {
          error:
            "Only requests pending command review may receive a decision.",
        },
        { status: 409 },
      );
    }

    const notes = cleanText(body.notes);

    if (
      (body.action === "Deny" || body.action === "Return") &&
      !notes
    ) {
      return NextResponse.json(
        {
          error:
            "Decision notes are required when denying or returning a request.",
        },
        { status: 400 },
      );
    }

    if (
      body.action === "Approve" &&
      (!cleanText(body.effectiveDate) || !cleanText(body.expirationDate))
    ) {
      return NextResponse.json(
        {
          error:
            "Effective and expiration dates are required for approval.",
        },
        { status: 400 },
      );
    }

    const action = body.action as "Approve" | "Deny" | "Return";

    if (action === "Approve") {
      const qualificationReadiness =
        await getOfficerQualificationReadiness(
          context,
          String(existing.officer_user_id),
        );

      if (
        !["Current", "Due Soon"].includes(
          qualificationReadiness.status,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "This off-duty firearm request cannot be approved because the officer does not have a current qualifying record.",
            qualificationStatus:
              qualificationReadiness.status,
            qualificationReason:
              qualificationReadiness.statusReason,
          },
          { status: 409 },
        );
      }

      const inspectionReadiness =
        await getOffDutyInspectionReadiness(
          context,
          requestId,
        );

      if (
        !["Current", "Due Soon"].includes(
          inspectionReadiness.status,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "This off-duty firearm request cannot be approved because the firearm does not have a current passing inspection.",
            inspectionStatus: inspectionReadiness.status,
            inspectionReason: inspectionReadiness.statusReason,
          },
          { status: 409 },
        );
      }
    }

    const { error: decisionError } = await context.admin.rpc(
      "apply_off_duty_firearm_decision",
      {
        p_department_id: context.departmentId,
        p_request_id: requestId,
        p_actor_user_id: context.userId,
        p_actor_name: context.fullName,
        p_actor_role: context.primaryRoleLabel,
        p_action: action,
        p_notes: notes || null,
        p_effective_date:
          action === "Approve" ? body.effectiveDate : null,
        p_expiration_date:
          action === "Approve" ? body.expirationDate : null,
      },
    );

    if (decisionError) {
      throw new Error(decisionError.message);
    }

    try {
      await resolveCommandNotifications(context, requestId);
    } catch (notificationError) {
      console.error(
        "Off-duty decision was saved but command notification resolution failed:",
        notificationError,
      );
    }

    try {
      await createOfficerNotification(
        context,
        String(existing.officer_user_id),
        requestId,
        action,
        `${existing.make} ${existing.model} (${existing.serial_number})`,
        notes,
        action === "Approve"
          ? cleanText(body.expirationDate)
          : null,
      );
    } catch (notificationError) {
      console.error(
        "Off-duty decision was saved but officer notification creation failed:",
        notificationError,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The off-duty firearm request could not be updated.",
      },
      { status: 500 },
    );
  }
}
