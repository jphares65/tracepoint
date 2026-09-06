import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { createRangeReadRepository } from "@/lib/range/read-repository";
import { TRAINING_ALERTS_WORKFLOW_PERMISSIONS } from "@/lib/tracepoint/permissions";

type RemediationPayload = {
  remediations?: unknown;
};

function normalizeRemediations(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function GET() {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "range_training",
    "Range & Training",
  );

  if (featureError) {
    return featureError;
  }
  if (!hasAnyServerPermission(resolved.context, TRAINING_ALERTS_WORKFLOW_PERMISSIONS)) {
    return permissionDeniedResponse("Agency-training management permission is required to view remediation records.");
  }
  const {
    admin,
    departmentId,
  } = resolved.context;

  try {
    const data = await createRangeReadRepository(admin, departmentId).getRemediations(departmentId);

    return NextResponse.json({
      remediations: normalizeRemediations(data?.remediations),
      updatedAt: data?.updated_at ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load remediation records.",
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    return accessFailureResponse(resolved);
  }

  const featureError = requireServerFeature(
    resolved.context,
    "range_training",
    "Range & Training",
  );

  if (featureError) {
    return featureError;
  }
  if (!hasAnyServerPermission(resolved.context, TRAINING_ALERTS_WORKFLOW_PERMISSIONS)) {
    return permissionDeniedResponse("Agency-training management permission is required to update remediation records.");
  }
  const {
    admin,
    user,
    departmentId,
  } = resolved.context;

  let payload: RemediationPayload;

  try {
    payload = (await request.json()) as RemediationPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid remediation payload." },
      { status: 400 },
    );
  }

  const remediations = normalizeRemediations(payload.remediations);

  try {
    const { error } = await admin
      .from("pilot_remediation_workspaces")
      .upsert(
        {
          department_id: departmentId,
          remediations,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "department_id",
        },
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: user.id,
      action: "pilot_remediations_saved",
      entity_type: "pilot_remediation_workspaces",
      entity_id: departmentId,
      summary: `Saved ${remediations.length} pilot remediation record${
        remediations.length === 1 ? "" : "s"
      }.`,
      previous_value: null,
      new_value: {
        remediation_count: remediations.length,
      },
    });

    return NextResponse.json({
      message: "Remediation records saved.",
      remediationCount: remediations.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save remediation records.",
      },
      { status: 500 },
    );
  }
}




