import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

function integer(
  value: unknown,
  fallback: number,
) {
  const parsed = Number(value);

  return Number.isInteger(parsed)
    ? parsed
    : fallback;
}

async function resolveContext() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return {
      error: accessFailureResponse(resolved),
    } as const;
  }

  const featureError = requireServerFeature(
    resolved.context,
    "off_duty",
    "Off-Duty Firearms",
  );

  if (featureError) {
    return {
      error: featureError,
    } as const;
  }

  return {
    context: resolved.context,
  } as const;
}

export async function GET() {
  const resolved = await resolveContext();

  if ("error" in resolved) {
    return resolved.error;
  }

  const { context } = resolved;

  const { data, error } =
    await context.admin
      .from("department_rules")
      .select(
        [
          "require_off_duty_inspection",
          "require_off_duty_qualification",
          "off_duty_renewal_days",
          "inspection_interval_days",
          "inspection_due_soon_days",
        ].join(","),
      )
      .eq(
        "department_id",
        context.departmentId,
      )
      .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    rules: {
      requireInspection:
        data?.require_off_duty_inspection !== false,

      requireQualification:
        data?.require_off_duty_qualification !== false,

      renewalDays:
        Number(data?.off_duty_renewal_days) || 365,

      inspectionIntervalDays:
        Number(data?.inspection_interval_days) || 180,

      inspectionDueSoonDays:
        data?.inspection_due_soon_days === null ||
        data?.inspection_due_soon_days === undefined
          ? 30
          : Number(data.inspection_due_soon_days),
    },
  });
}

export async function PATCH(
  request: NextRequest,
) {
  const resolved = await resolveContext();

  if ("error" in resolved) {
    return resolved.error;
  }

  const { context } = resolved;

  if (
    !hasAnyServerPermission(
      context,
      ["administer_department"],
    )
  ) {
    return NextResponse.json(
      {
        error:
          "Department administration permission is required to modify off-duty firearm policy.",
      },
      { status: 403 },
    );
  }

  const body =
    (await request.json().catch(
      () => ({}),
    )) as {
      requireInspection?: boolean;
      requireQualification?: boolean;
      renewalDays?: number;
      inspectionIntervalDays?: number;
      inspectionDueSoonDays?: number;
    };

  const renewalDays =
    integer(body.renewalDays, 365);

  const inspectionIntervalDays =
    integer(
      body.inspectionIntervalDays,
      180,
    );

  const inspectionDueSoonDays =
    integer(
      body.inspectionDueSoonDays,
      30,
    );

  if (
    renewalDays < 1 ||
    renewalDays > 3650
  ) {
    return NextResponse.json(
      {
        error:
          "Off-duty renewal must be between 1 and 3650 days.",
      },
      { status: 400 },
    );
  }

  if (
    inspectionIntervalDays < 1 ||
    inspectionIntervalDays > 3650
  ) {
    return NextResponse.json(
      {
        error:
          "Inspection validity must be between 1 and 3650 days.",
      },
      { status: 400 },
    );
  }

  if (
    inspectionDueSoonDays < 0 ||
    inspectionDueSoonDays >=
      inspectionIntervalDays
  ) {
    return NextResponse.json(
      {
        error:
          "Inspection warning must be zero or greater and less than the inspection validity period.",
      },
      { status: 400 },
    );
  }

  const { data, error } =
    await context.admin
      .from("department_rules")
      .update({
        require_off_duty_inspection:
          body.requireInspection !== false,

        require_off_duty_qualification:
          body.requireQualification !== false,

        off_duty_renewal_days:
          renewalDays,

        inspection_interval_days:
          inspectionIntervalDays,

        inspection_due_soon_days:
          inspectionDueSoonDays,

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "department_id",
        context.departmentId,
      )
      .select(
        [
          "require_off_duty_inspection",
          "require_off_duty_qualification",
          "off_duty_renewal_days",
          "inspection_interval_days",
          "inspection_due_soon_days",
        ].join(","),
      )
      .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    rules: {
      requireInspection:
        data.require_off_duty_inspection !== false,

      requireQualification:
        data.require_off_duty_qualification !== false,

      renewalDays:
        data.off_duty_renewal_days,

      inspectionIntervalDays:
        data.inspection_interval_days,

      inspectionDueSoonDays:
        data.inspection_due_soon_days,
    },
  });
}