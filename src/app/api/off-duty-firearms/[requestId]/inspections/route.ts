import { NextRequest, NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  permissionDeniedResponse,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

import {
  certificationCapabilityDeniedResponse,
  evaluateCertificationCapability,
} from "@/lib/tracepoint/certification-capability";
import { createOffDutyReadRepository } from "@/lib/off-duty-firearms/read-repository";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function loadProfileNames(
  repository: ReturnType<typeof createOffDutyReadRepository>,
  departmentId: string,
  userIds: string[],
) {
  const uniqueIds = Array.from(
    new Set(userIds.filter(Boolean)),
  );

  if (uniqueIds.length === 0) {
    return new Map<string, string>();
  }

  const data = await repository.listProfiles(departmentId, uniqueIds);

  return new Map(
    data.map((row: any) => [
      String(row.id),
      cleanText(row.full_name) ?? "Unknown User",
    ]),
  );
}

function isInspectionManager(context: any) {
  return hasAnyServerPermission(context, [
    "manage_inspections",
    "manage_firearms",
    "review_off_duty_requests",
    "administer_department",
  ]);
}

async function loadOffDutyRequest(context: any, requestId: string) {
  const { data, error } = await context.admin
    .from("off_duty_firearm_requests")
    .select("id,department_id,officer_user_id,make,model,serial_number")
    .eq("id", requestId)
    .eq("department_id", context.departmentId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function GET(
  _request: NextRequest,
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
  const repository = createOffDutyReadRepository(context.admin, context.departmentId);
  const offDutyRequest = await repository.getRequest(context.departmentId, requestId);

  if (!offDutyRequest) {
    return NextResponse.json(
      { error: "Off-duty firearm request was not found." },
      { status: 404 },
    );
  }

  const canReview = isInspectionManager(context);
  const isOwner =
    String(offDutyRequest.officer_user_id) === context.userId;

  if (!canReview && !isOwner) {
    return permissionDeniedResponse(
      "You do not have access to this off-duty firearm inspection history.",
    );
  }

  let data;
  try { data = await repository.listRequestInspections(context.departmentId, requestId); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Inspections could not be loaded." }, { status: 500 }); }

    const inspectorNames = await loadProfileNames(
    repository,
    context.departmentId,
    (data ?? []).map((row: any) =>
      String(row.inspected_by_user_id ?? ""),
    ),
  );

  const inspections = (data ?? []).map((row: any) => ({
    id: String(row.id),
    inspectionDate: row.inspection_date,
    result: row.result,
    notes: row.notes ?? undefined,
    inspectedBy:
      inspectorNames.get(String(row.inspected_by_user_id)) ??
      "Unknown User",
    inspectedByUserId: String(row.inspected_by_user_id),
    createdAt: row.created_at,
  }));

  return NextResponse.json({
    requestId,
    inspections,
  });
}

export async function POST(
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

  if (!isInspectionManager(context)) {
    return permissionDeniedResponse(
      "Inspection management permission is required to record an off-duty firearm inspection.",
    );
  }

  const certificationEligibility =
    await evaluateCertificationCapability({
      request,
      context,
      capabilityCode: "perform_firearm_inspections",
    });

  if (
    certificationEligibility.configured &&
    !certificationEligibility.eligible
  ) {
    return certificationCapabilityDeniedResponse(
      certificationEligibility,
    );
  }

  const { requestId } = await routeContext.params;

  const offDutyRequest = await loadOffDutyRequest(
    context,
    requestId,
  );

  if (!offDutyRequest) {
    return NextResponse.json(
      { error: "Off-duty firearm request was not found." },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    inspectionDate?: string;
    result?: "Pass" | "Fail";
    notes?: string;
  };

  const inspectionDate = cleanText(body.inspectionDate);
  const result = body.result;
  const notes = cleanText(body.notes);

  if (!inspectionDate) {
    return NextResponse.json(
      { error: "Inspection date is required." },
      { status: 400 },
    );
  }

  if (!["Pass", "Fail"].includes(result ?? "")) {
    return NextResponse.json(
      { error: "Inspection result must be Pass or Fail." },
      { status: 400 },
    );
  }

  const { data: inspection, error: inspectionError } =
    await context.admin.rpc(
      "record_off_duty_firearm_inspection",
      {
        p_department_id: context.departmentId,
        p_request_id: requestId,
        p_inspected_by_user_id: context.userId,
        p_inspection_date: inspectionDate,
        p_result: result,
        p_notes: notes || null,
      },
    );

  if (inspectionError) {
    return NextResponse.json(
      { error: inspectionError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    inspection,
  });
}
