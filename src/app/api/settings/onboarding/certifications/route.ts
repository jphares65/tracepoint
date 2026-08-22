import { NextRequest, NextResponse } from "next/server";

import { buildEnrichOnlyUpdates } from "@/lib/onboarding/merge";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

type CertificationImportRequest = {
  departmentId?: string;
  userId?: string;
  certificationTitle?: string;
  issuingOrganization?: string;
  credentialNumber?: string;
  issueDate?: string;
  expirationDate?: string;
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
    .catch(() => ({}))) as CertificationImportRequest;

  const departmentId = cleanText(body.departmentId);
  const userId = cleanText(body.userId);
  const certificationTitle = cleanText(body.certificationTitle);

  if (!departmentId || !userId || !certificationTitle) {
    return NextResponse.json(
      {
        error:
          "Department, officer, and certification title are required.",
      },
      { status: 400 },
    );
  }

  const [manageResult, administerResult, platformAdminResult] =
    await Promise.all([
      server.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "manage_certifications",
      }),
      server.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "administer_department",
      }),
      server.rpc("is_platform_admin"),
    ]);

  if (manageResult.error) {
    return NextResponse.json(
      { error: manageResult.error.message },
      { status: 500 },
    );
  }

  if (administerResult.error) {
    return NextResponse.json(
      { error: administerResult.error.message },
      { status: 500 },
    );
  }

  if (platformAdminResult.error) {
    return NextResponse.json(
      { error: platformAdminResult.error.message },
      { status: 500 },
    );
  }

  if (
    !manageResult.data &&
    !administerResult.data &&
    !platformAdminResult.data
  ) {
    return NextResponse.json(
      {
        error:
          "Certification-management permission is required for this department.",
      },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

  try {
    const [
      { data: membership, error: membershipError },
      { data: certificationType, error: typeError },
    ] = await Promise.all([
      admin
        .from("department_memberships")
        .select("user_id")
        .eq("department_id", departmentId)
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle(),

      admin
        .from("certification_types")
        .select(
          "id,name,issuing_organization,expiration_required",
        )
        .eq("department_id", departmentId)
        .eq("is_active", true)
        .ilike("name", certificationTitle)
        .limit(1)
        .maybeSingle(),
    ]);

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

    if (typeError) {
      throw new Error(typeError.message);
    }

    if (!certificationType) {
      return NextResponse.json(
        {
          error:
            `Certification type "${certificationTitle}" is not configured for this department.`,
        },
        { status: 400 },
      );
    }

    const issueDate = cleanText(body.issueDate);
    const expirationDate = cleanText(body.expirationDate);

    if (
      certificationType.expiration_required &&
      !expirationDate
    ) {
      return NextResponse.json(
        {
          error:
            `An expiration date is required for "${certificationType.name}".`,
        },
        { status: 400 },
      );
    }

    const credentialNumber = cleanText(body.credentialNumber);

    if (!credentialNumber && !issueDate && !expirationDate) {
      return NextResponse.json(
        {
          error:
            "A credential number, issue date, or expiration date is required to safely reconcile this certification without creating a duplicate.",
        },
        { status: 400 },
      );
    }

    const { data: existingRows, error: existingError } =
      await admin
        .from("training_certifications")
        .select(
          "id,issuing_organization,credential_number,issue_date,expiration_date,notes",
        )
        .eq("department_id", departmentId)
        .eq("user_id", userId)
        .eq("certification_type_id", certificationType.id);

    if (existingError) {
      throw new Error(existingError.message);
    }

    const matches = (existingRows ?? []).filter((row) => {
      if (credentialNumber) {
        return (
          row.credential_number?.trim().toLowerCase() ===
          credentialNumber.toLowerCase()
        );
      }

      if (issueDate) {
        return row.issue_date === issueDate;
      }

      return row.expiration_date === expirationDate;
    });

    if (matches.length > 1) {
      return NextResponse.json(
        {
          error:
            "Multiple existing certifications match this record. Manual review is required before import.",
        },
        { status: 409 },
      );
    }

    const existing = matches[0] ?? null;

    if (existing) {
      const merge = buildEnrichOnlyUpdates(
        existing as Record<string, unknown>,
        {
          issuing_organization:
            cleanText(body.issuingOrganization) ??
            certificationType.issuing_organization ??
            null,
          credential_number: credentialNumber,
          issue_date: issueDate,
          expiration_date: expirationDate,
          notes: cleanText(body.notes),
        },
        ["id"],
      );

      if (Object.keys(merge.updates).length > 0) {
        const { error: updateError } = await admin
          .from("training_certifications")
          .update({
            ...merge.updates,
            updated_by_user_id: user.id,
          } as any)
          .eq("id", existing.id)
          .eq("department_id", departmentId);

        if (updateError) {
          throw new Error(updateError.message);
        }

        return NextResponse.json({
          ok: true,
          status: "updated",
          certificationId: existing.id,
          changedFields: merge.changedFields,
          conflicts: merge.conflicts,
        });
      }

      return NextResponse.json({
        ok: true,
        status: "unchanged",
        certificationId: existing.id,
        changedFields: [],
        conflicts: merge.conflicts,
      });
    }
    const { data: inserted, error: insertError } =
      await admin
        .from("training_certifications")
        .insert({
          department_id: departmentId,
          user_id: userId,
          certification_type_id: certificationType.id,
          certification_title: certificationType.name,
          issuing_organization:
            cleanText(body.issuingOrganization) ??
            certificationType.issuing_organization ??
            null,
          credential_number: cleanText(body.credentialNumber),
          issue_date: issueDate,
          expiration_date: expirationDate,
          reminder_days: [180, 90, 60, 30, 14, 7, 0],
          document_url: null,
          notes: cleanText(body.notes),
          created_by_user_id: user.id,
          updated_by_user_id: user.id,
        })
        .select("id")
        .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: user.id,
      action: "certification_imported_during_onboarding",
      entity_type: "training_certification",
      entity_id: inserted.id,
      new_value: {
        user_id: userId,
        certification_type_id: certificationType.id,
        certification_title: certificationType.name,
        platform_admin: Boolean(platformAdminResult.data),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "created",
        certificationId: inserted.id,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Certification import failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}