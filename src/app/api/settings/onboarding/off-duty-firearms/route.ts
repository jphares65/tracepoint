import { NextRequest, NextResponse } from "next/server";

import { buildEnrichOnlyUpdates } from "@/lib/onboarding/merge";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

const REQUEST_STATUSES = new Set([
  "Draft",
  "Pending Command Review",
  "Returned for Correction",
  "Approved",
  "Denied",
  "Withdrawn",
]);

const AUTHORIZATION_STATUSES = new Set([
  "Not Authorized",
  "Authorized",
  "Expiring Soon",
  "Expired",
  "Revoked",
]);

const COMPLIANCE_STATUSES = new Set([
  "Authorized",
  "At Risk",
  "Non-Compliant",
]);

const INSPECTION_STATUSES = new Set([
  "Not Inspected",
  "Current",
  "Due Soon",
  "Overdue",
]);

type OffDutyImportRequest = {
  departmentId?: string;
  officerUserId?: string;

  make?: string;
  model?: string;
  firearmType?: string;
  serialNumber?: string;
  caliber?: string;

  capacity?: string;
  optic?: string;
  weaponLight?: string;
  holster?: string;

  requestStatus?: string;
  authorizationStatus?: string;
  complianceStatus?: string;
  inspectionStatus?: string;

  approvalDate?: string;
  approvalEffectiveDate?: string;
  approvalExpirationDate?: string;

  notes?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

export async function POST(request: NextRequest) {
  const server = await createServerClient();

  const {
    data: { user },
    error: userError,
  } = await server.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Authentication is required." },
      { status: 401 },
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as OffDutyImportRequest;

  const departmentId = cleanText(body.departmentId);
  const officerUserId = cleanText(body.officerUserId);

  const make = cleanText(body.make);
  const model = cleanText(body.model);
  const firearmType = cleanText(body.firearmType);
  const serialNumber = cleanText(body.serialNumber);
  const caliber = cleanText(body.caliber);

  if (
    !departmentId ||
    !officerUserId ||
    !make ||
    !model ||
    !firearmType ||
    !serialNumber ||
    !caliber
  ) {
    return NextResponse.json(
      {
        error:
          "Department, officer, make, model, firearm type, serial number, and caliber are required.",
      },
      { status: 400 },
    );
  }

  const [
    reviewResult,
    firearmsResult,
    administerResult,
    platformAdminResult,
  ] = await Promise.all([
    server.rpc("has_department_permission", {
      p_department_id: departmentId,
      p_permission_code: "review_off_duty_requests",
    }),
    server.rpc("has_department_permission", {
      p_department_id: departmentId,
      p_permission_code: "manage_firearms",
    }),
    server.rpc("has_department_permission", {
      p_department_id: departmentId,
      p_permission_code: "administer_department",
    }),
    server.rpc("is_platform_admin"),
  ]);

  for (const result of [
    reviewResult,
    firearmsResult,
    administerResult,
    platformAdminResult,
  ]) {
    if (result.error) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }
  }

  if (
    !reviewResult.data &&
    !firearmsResult.data &&
    !administerResult.data &&
    !platformAdminResult.data
  ) {
    return NextResponse.json(
      {
        error:
          "Off-duty firearm management permission is required for this department.",
      },
      { status: 403 },
    );
  }

  const requestStatus =
    cleanText(body.requestStatus) ??
    "Pending Command Review";

  const authorizationStatus =
    cleanText(body.authorizationStatus) ??
    "Not Authorized";

  const complianceStatus =
    cleanText(body.complianceStatus) ??
    "At Risk";

  const inspectionStatus =
    cleanText(body.inspectionStatus) ??
    "Not Inspected";

  if (!REQUEST_STATUSES.has(requestStatus)) {
    return NextResponse.json(
      { error: "Invalid off-duty request status." },
      { status: 400 },
    );
  }

  if (!AUTHORIZATION_STATUSES.has(authorizationStatus)) {
    return NextResponse.json(
      { error: "Invalid authorization status." },
      { status: 400 },
    );
  }

  if (!COMPLIANCE_STATUSES.has(complianceStatus)) {
    return NextResponse.json(
      { error: "Invalid compliance status." },
      { status: 400 },
    );
  }

  if (!INSPECTION_STATUSES.has(inspectionStatus)) {
    return NextResponse.json(
      { error: "Invalid inspection status." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  try {
    const { data: membership, error: membershipError } =
      await admin
        .from("department_memberships")
        .select("user_id")
        .eq("department_id", departmentId)
        .eq("user_id", officerUserId)
        .eq("is_active", true)
        .maybeSingle();

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    if (!membership) {
      return NextResponse.json(
        {
          error:
            "The selected officer is not an active department member.",
        },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } =
      await admin
        .from("off_duty_firearm_requests")
        .select(
          "id,officer_user_id,make,model,firearm_type,serial_number,caliber,capacity,optic,weapon_light,holster,request_status,authorization_status,compliance_status,inspection_status,approval_date,approval_effective_date,approval_expiration_date,officer_notes",
        )
        .eq("department_id", departmentId)
        .ilike("serial_number", serialNumber)
        .limit(1)
        .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      const merge = buildEnrichOnlyUpdates(
        existing as Record<string, unknown>,
        {
          officer_user_id: officerUserId,
          make,
          model,
          firearm_type: firearmType,
          caliber,
          capacity: cleanText(body.capacity),
          optic: cleanText(body.optic),
          weapon_light: cleanText(body.weaponLight),
          holster: cleanText(body.holster),
          request_status: cleanText(body.requestStatus),
          authorization_status: cleanText(body.authorizationStatus),
          compliance_status: cleanText(body.complianceStatus),
          inspection_status: cleanText(body.inspectionStatus),
          approval_date: cleanText(body.approvalDate),
          approval_effective_date: cleanText(body.approvalEffectiveDate),
          approval_expiration_date: cleanText(body.approvalExpirationDate),
          officer_notes: cleanText(body.notes),
        },
        ["id", "serial_number"],
      );

      if (Object.keys(merge.updates).length > 0) {
        const { error: updateError } = await admin
          .from("off_duty_firearm_requests")
          .update(merge.updates as any)
          .eq("id", existing.id)
          .eq("department_id", departmentId);

        if (updateError) {
          throw new Error(updateError.message);
        }

        return NextResponse.json({
          ok: true,
          status: "updated",
          offDutyFirearmId: existing.id,
          changedFields: merge.changedFields,
          conflicts: merge.conflicts,
        });
      }

      return NextResponse.json({
        ok: true,
        status: "unchanged",
        offDutyFirearmId: existing.id,
        changedFields: [],
        conflicts: merge.conflicts,
      });
    }

    const now = new Date().toISOString();

    const { data: inserted, error: insertError } =
      await admin
        .from("off_duty_firearm_requests")
        .insert({
          department_id: departmentId,
          officer_user_id: officerUserId,

          make,
          model,
          firearm_type: firearmType,
          serial_number: serialNumber,
          caliber,

          capacity: cleanText(body.capacity),
          optic: cleanText(body.optic),
          weapon_light: cleanText(body.weaponLight),
          holster: cleanText(body.holster),

          request_status: requestStatus,
          authorization_status: authorizationStatus,
          compliance_status: complianceStatus,
          inspection_status: inspectionStatus,

          approval_date: cleanText(body.approvalDate),
          approval_effective_date:
            cleanText(body.approvalEffectiveDate),
          approval_expiration_date:
            cleanText(body.approvalExpirationDate),

          proof_ownership: false,
          proof_of_ownership_reviewed: false,
          qualification_reviewed: false,
          inspection_reviewed: false,
          policy_acknowledged: false,

          officer_notes: cleanText(body.notes),

          submitted_at: now,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: user.id,
      action: "off_duty_firearm_imported_during_onboarding",
      entity_type: "off_duty_firearm_request",
      entity_id: inserted.id,
      new_value: {
        officer_user_id: officerUserId,
        serial_number: serialNumber,
        request_status: requestStatus,
        authorization_status: authorizationStatus,
        compliance_status: complianceStatus,
        inspection_status: inspectionStatus,
        platform_admin: Boolean(platformAdminResult.data),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "created",
        offDutyFirearmId: inserted.id,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Off-duty firearm import failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}