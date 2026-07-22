import { NextRequest, NextResponse } from "next/server";

import {
  cleanPersonalRifleText,
  getInitialPersonalRifleStatus,
  getPersonalRifleAccess,
  getPersonalRifleExpirationDate,
  getPersonalRifleRequestContext,
  getPersonalRifleRules,
  recordPersonalRifleHistory,
} from "@/lib/tracepoint/personal-rifle-server";

type RouteContext = {
  params: Promise<{ rifleId: string }>;
};

const REQUIRED_INSPECTION_CHECKS = [
  "serial_verified",
  "safe_function",
  "department_specifications",
  "optic_sights",
  "sling_light",
  "trigger_muzzle",
] as const;

function serializeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function checklistComplete(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const checklist = value as Record<string, unknown>;
  return REQUIRED_INSPECTION_CHECKS.every((key) => checklist[key] === true);
}

export async function PATCH(
  request: NextRequest,
  routeContext: RouteContext,
) {
  const { rifleId } = await routeContext.params;
  const context = await getPersonalRifleRequestContext();

  if (context.error || !context.user || !context.admin || !context.departmentId) {
    return NextResponse.json(
      { error: context.error ?? "Personal rifle access could not be resolved." },
      { status: context.user ? 403 : 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    any
  >;
  const action = String(body.action ?? "");

  try {
    const { admin, departmentId, user } = context;

    const [{ data: rifle, error: rifleError }, rules, access] =
      await Promise.all([
        admin
          .from("personal_rifles")
          .select("*")
          .eq("id", rifleId)
          .eq("department_id", departmentId)
          .maybeSingle(),
        getPersonalRifleRules(admin, departmentId),
        getPersonalRifleAccess(admin, departmentId, user.id),
      ]);

    if (rifleError) throw new Error(rifleError.message);
    if (!rifle) {
      return NextResponse.json(
        { error: "Personal rifle record not found." },
        { status: 404 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const notes = cleanPersonalRifleText(body.notes);
    let nextStatus = String(rifle.status);
    let historyAction = "";
    let historyNotes = notes;
    let historyMetadata: Record<string, unknown> = {};
    let updates: Record<string, unknown> = { updated_at: nowIso };

    if (action === "owner_save" || action === "owner_submit") {
      if (rifle.owner_user_id !== user.id) {
        return NextResponse.json(
          { error: "Only the owner may edit this rifle record." },
          { status: 403 },
        );
      }
      if (!["Draft", "Correction Requested"].includes(rifle.status)) {
        return NextResponse.json(
          { error: "This record is no longer editable by the owner." },
          { status: 409 },
        );
      }

      const form = body.rifle ?? {};
      const manufacturer = cleanPersonalRifleText(form.manufacturer);
      const model = cleanPersonalRifleText(form.model);
      const serialNumber = cleanPersonalRifleText(form.serialNumber);
      const caliber = cleanPersonalRifleText(form.caliber);

      if (!manufacturer || !model || !serialNumber || !caliber) {
        return NextResponse.json(
          {
            error:
              "Manufacturer, model, serial number, and caliber are required.",
          },
          { status: 400 },
        );
      }
      if (!form.ownershipConfirmed) {
        return NextResponse.json(
          { error: "Ownership confirmation is required." },
          { status: 400 },
        );
      }
      if (
        action === "owner_submit" &&
        rules.require_personal_rifle_spec_acknowledgment &&
        !form.specificationAcknowledged
      ) {
        return NextResponse.json(
          { error: "Department specification acknowledgment is required." },
          { status: 400 },
        );
      }

      const { data: duplicate, error: duplicateError } = await admin
        .from("personal_rifles")
        .select("id")
        .eq("department_id", departmentId)
        .ilike("serial_number", serialNumber)
        .neq("id", rifleId)
        .limit(1)
        .maybeSingle();

      if (duplicateError) throw new Error(duplicateError.message);
      if (duplicate) {
        return NextResponse.json(
          { error: "A personal rifle with this serial number already exists." },
          { status: 409 },
        );
      }

      nextStatus =
        action === "owner_submit"
          ? getInitialPersonalRifleStatus(rules)
          : "Draft";

      const immediatelyApproved = nextStatus === "Approved";

      updates = {
        ...updates,
        manufacturer,
        model,
        serial_number: serialNumber,
        caliber,
        barrel_length: cleanPersonalRifleText(form.barrelLength),
        operating_system: cleanPersonalRifleText(form.operatingSystem),
        stock_brace_configuration: cleanPersonalRifleText(
          form.stockBraceConfiguration,
        ),
        sights_optic: cleanPersonalRifleText(form.sightsOptic),
        weapon_mounted_light: cleanPersonalRifleText(
          form.weaponMountedLight,
        ),
        sling: cleanPersonalRifleText(form.sling),
        trigger: cleanPersonalRifleText(form.trigger),
        muzzle_device: cleanPersonalRifleText(form.muzzleDevice),
        magazine_type: cleanPersonalRifleText(form.magazineType),
        other_modifications: cleanPersonalRifleText(form.otherModifications),
        ownership_confirmed: true,
        specification_acknowledged: Boolean(
          form.specificationAcknowledged,
        ),
        status: nextStatus,
        correction_notes: null,
        submitted_at:
          action === "owner_submit" ? nowIso : rifle.submitted_at,
        approval_date: immediatelyApproved
          ? nowIso.slice(0, 10)
          : rifle.approval_date,
        expiration_date: immediatelyApproved
          ? getPersonalRifleExpirationDate(rules, now)
          : rifle.expiration_date,
      };
      historyAction =
        action === "owner_submit" ? "Owner Submitted" : "Owner Saved Draft";
    } else if (action === "request_correction") {
      if (!access.canArmorerReview) {
        return NextResponse.json(
          { error: "Armorer review permission is required." },
          { status: 403 },
        );
      }
      if (rifle.status !== "Pending Armorer Review") {
        return NextResponse.json(
          { error: "This rifle is not pending armorer review." },
          { status: 409 },
        );
      }
      if (!notes) {
        return NextResponse.json(
          { error: "A correction reason is required." },
          { status: 400 },
        );
      }

      nextStatus = "Correction Requested";
      updates = {
        ...updates,
        status: nextStatus,
        correction_notes: notes,
        armorer_reviewed_by: user.id,
        armorer_reviewed_at: nowIso,
        armorer_decision_notes: notes,
      };
      historyAction = "Correction Requested";
    } else if (action === "armorer_approve") {
      if (!access.canArmorerReview) {
        return NextResponse.json(
          { error: "Armorer review permission is required." },
          { status: 403 },
        );
      }
      if (rifle.status !== "Pending Armorer Review") {
        return NextResponse.json(
          { error: "This rifle is not pending armorer review." },
          { status: 409 },
        );
      }
      if (
        rules.require_personal_rifle_armorer_inspection &&
        !checklistComplete(body.checklist)
      ) {
        return NextResponse.json(
          { error: "Complete every required armorer inspection item." },
          { status: 400 },
        );
      }
      if (
        rules.require_personal_rifle_armorer_inspection &&
        !cleanPersonalRifleText(body.inspectionDate)
      ) {
        return NextResponse.json(
          { error: "Inspection date is required." },
          { status: 400 },
        );
      }
      if (
        rules.require_personal_rifle_qualification &&
        body.qualificationVerified !== true
      ) {
        return NextResponse.json(
          { error: "Qualification must be verified before approval." },
          { status: 400 },
        );
      }

      nextStatus = rules.require_personal_rifle_chief_approval
        ? "Pending Chief Approval"
        : "Approved";

      updates = {
        ...updates,
        status: nextStatus,
        correction_notes: null,
        inspection_date: cleanPersonalRifleText(body.inspectionDate),
        armorer_checklist:
          body.checklist && typeof body.checklist === "object"
            ? body.checklist
            : {},
        qualification_verified: Boolean(body.qualificationVerified),
        qualification_verified_by: body.qualificationVerified
          ? user.id
          : null,
        qualification_verified_at: body.qualificationVerified
          ? nowIso
          : null,
        armorer_reviewed_by: user.id,
        armorer_reviewed_at: nowIso,
        armorer_decision_notes: notes,
        approval_date:
          nextStatus === "Approved" ? nowIso.slice(0, 10) : rifle.approval_date,
        expiration_date:
          nextStatus === "Approved"
            ? getPersonalRifleExpirationDate(rules, now)
            : rifle.expiration_date,
      };
      historyAction = "Armorer Approved";
      historyMetadata = {
        checklist: body.checklist ?? {},
        inspectionDate: body.inspectionDate ?? null,
        qualificationVerified: Boolean(body.qualificationVerified),
      };
    } else if (action === "armorer_deny") {
      if (!access.canArmorerReview) {
        return NextResponse.json(
          { error: "Armorer review permission is required." },
          { status: 403 },
        );
      }
      if (rifle.status !== "Pending Armorer Review") {
        return NextResponse.json(
          { error: "This rifle is not pending armorer review." },
          { status: 409 },
        );
      }
      if (!notes) {
        return NextResponse.json(
          { error: "A denial reason is required." },
          { status: 400 },
        );
      }

      nextStatus = "Armorer Denied";
      updates = {
        ...updates,
        status: nextStatus,
        armorer_reviewed_by: user.id,
        armorer_reviewed_at: nowIso,
        armorer_decision_notes: notes,
        armorer_checklist:
          body.checklist && typeof body.checklist === "object"
            ? body.checklist
            : {},
        inspection_date: cleanPersonalRifleText(body.inspectionDate),
      };
      historyAction = "Armorer Denied";
    } else if (action === "chief_approve") {
      if (!access.canChiefReview) {
        return NextResponse.json(
          { error: "Chief approval permission is required." },
          { status: 403 },
        );
      }
      if (rifle.status !== "Pending Chief Approval") {
        return NextResponse.json(
          { error: "This rifle is not pending Chief approval." },
          { status: 409 },
        );
      }

      nextStatus = "Approved";
      updates = {
        ...updates,
        status: nextStatus,
        chief_reviewed_by: user.id,
        chief_reviewed_at: nowIso,
        chief_decision_notes: notes,
        approval_date: nowIso.slice(0, 10),
        expiration_date: getPersonalRifleExpirationDate(rules, now),
      };
      historyAction = "Chief Approved";
    } else if (action === "chief_deny") {
      if (!access.canChiefReview) {
        return NextResponse.json(
          { error: "Chief approval permission is required." },
          { status: 403 },
        );
      }
      if (rifle.status !== "Pending Chief Approval") {
        return NextResponse.json(
          { error: "This rifle is not pending Chief approval." },
          { status: 409 },
        );
      }
      if (!notes) {
        return NextResponse.json(
          { error: "A denial reason is required." },
          { status: 400 },
        );
      }

      nextStatus = "Denied";
      updates = {
        ...updates,
        status: nextStatus,
        chief_reviewed_by: user.id,
        chief_reviewed_at: nowIso,
        chief_decision_notes: notes,
      };
      historyAction = "Chief Denied";
    } else if (action === "suspend") {
      if (!access.canChiefReview) {
        return NextResponse.json(
          { error: "Command permission is required." },
          { status: 403 },
        );
      }
      if (rifle.status !== "Approved") {
        return NextResponse.json(
          { error: "Only an approved rifle may be suspended." },
          { status: 409 },
        );
      }
      if (!notes) {
        return NextResponse.json(
          { error: "A suspension reason is required." },
          { status: 400 },
        );
      }

      nextStatus = "Suspended";
      updates = {
        ...updates,
        status: nextStatus,
        suspension_notes: notes,
      };
      historyAction = "Approval Suspended";
    } else if (action === "reinstate") {
      if (!access.canChiefReview) {
        return NextResponse.json(
          { error: "Command permission is required." },
          { status: 403 },
        );
      }
      if (rifle.status !== "Suspended") {
        return NextResponse.json(
          { error: "Only a suspended rifle may be reinstated." },
          { status: 409 },
        );
      }

      nextStatus = "Approved";
      updates = {
        ...updates,
        status: nextStatus,
        suspension_notes: null,
      };
      historyAction = "Approval Reinstated";
    } else if (action === "revoke") {
      if (!access.canChiefReview) {
        return NextResponse.json(
          { error: "Command permission is required." },
          { status: 403 },
        );
      }
      if (!["Approved", "Suspended"].includes(rifle.status)) {
        return NextResponse.json(
          { error: "Only an approved or suspended rifle may be revoked." },
          { status: 409 },
        );
      }
      if (!notes) {
        return NextResponse.json(
          { error: "A revocation reason is required." },
          { status: 400 },
        );
      }

      nextStatus = "Revoked";
      updates = {
        ...updates,
        status: nextStatus,
        revocation_notes: notes,
      };
      historyAction = "Approval Revoked";
    } else {
      return NextResponse.json(
        { error: "Unsupported personal rifle action." },
        { status: 400 },
      );
    }

    const { error: updateError } = await admin
      .from("personal_rifles")
      .update(updates)
      .eq("id", rifleId)
      .eq("department_id", departmentId);

    if (updateError) throw new Error(updateError.message);

    await recordPersonalRifleHistory(admin, {
      departmentId,
      rifleId,
      actorUserId: user.id,
      fromStatus: String(rifle.status),
      toStatus: nextStatus,
      action: historyAction,
      notes: historyNotes,
      metadata: historyMetadata,
    });

    return NextResponse.json({
      ok: true,
      personalRifleId: rifleId,
      status: nextStatus,
    });
  } catch (error) {
    const message = serializeError(
      error,
      "The personal rifle workflow could not be updated.",
    );
    const duplicate =
      message.toLowerCase().includes("duplicate") ||
      message.toLowerCase().includes("unique");

    return NextResponse.json(
      {
        error: duplicate
          ? "A personal rifle with this serial number already exists."
          : message,
      },
      { status: duplicate ? 409 : 500 },
    );
  }
}
