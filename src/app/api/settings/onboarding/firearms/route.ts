import { NextRequest, NextResponse } from "next/server";

import { buildEnrichOnlyUpdates } from "@/lib/onboarding/merge";
import { getLookupLastName, matchesPersonnelName } from "@/lib/onboarding/personnel-name";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

const VALID_FIREARM_TYPES = [
  "handgun",
  "rifle",
  "shotgun",
  "less_lethal",
  "other",
] as const;

const VALID_STATUSES = [
  "In Service",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
] as const;

type FirearmImportRequest = {
  departmentId?: string;
  make?: string;
  model?: string;
  serialNumber?: string;
  firearmType?: string;
  caliber?: string;
  assetNumber?: string;
  conditionStatus?: string;
  notes?: string;
  assignedToUserId?: string;
  assignedOfficerName?: string;
  badgeNumber?: string;
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

  const body = (await request.json().catch(() => ({}))) as FirearmImportRequest;

  const departmentId = cleanText(body.departmentId);

  if (!departmentId) {
    return NextResponse.json(
      { error: "A department is required for firearm import." },
      { status: 400 },
    );
  }

  const [manageResult, administerResult, platformAdminResult] =
    await Promise.all([
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
          "Firearm-management permission is required for this department.",
      },
      { status: 403 },
    );
  }

  const make = cleanText(body.make);
  const model = cleanText(body.model);
  const serialNumber = cleanText(body.serialNumber);
  const firearmType = (cleanText(body.firearmType) ?? "handgun") as
  "handgun" | "rifle" | "shotgun" | "less_lethal" | "other";
  const conditionStatus =
    cleanText(body.conditionStatus) ?? "In Service";
  let assignedToUserId = cleanText(body.assignedToUserId);
  const assignedOfficerName = cleanText(body.assignedOfficerName);
  const badgeNumber = cleanText(body.badgeNumber);

  if (!make || !serialNumber) {
    return NextResponse.json(
      { error: "Make and serial number are required." },
      { status: 400 },
    );
  }

  if (!VALID_FIREARM_TYPES.includes(firearmType as any)) {
    return NextResponse.json(
      { error: "Invalid firearm type." },
      { status: 400 },
    );
  }

  if (!VALID_STATUSES.includes(conditionStatus as any)) {
    return NextResponse.json(
      { error: "Invalid firearm status." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  try {
    if (!assignedToUserId && badgeNumber) {
      const { data: badgeMatches, error: badgeError } = await admin
        .from("department_memberships")
        .select("user_id")
        .eq("department_id", departmentId)
        .eq("badge_number", badgeNumber)
        .eq("is_active", true);

      if (badgeError) {
        throw new Error(badgeError.message);
      }

      if ((badgeMatches ?? []).length > 1) {
        return NextResponse.json(
          {
            error: `Badge number "${badgeNumber}" matched more than one active personnel record.`,
          },
          { status: 409 },
        );
      }

      if ((badgeMatches ?? []).length === 1) {
        assignedToUserId = badgeMatches![0].user_id;
      }
    }

    if (!assignedToUserId && assignedOfficerName) {
      const lastName = getLookupLastName(assignedOfficerName);

      const { data: profileMatches, error: profileError } = await admin
        .from("profiles")
        .select("id, full_name")
        .ilike("full_name", `%${lastName}%`);

      if (profileError) {
        throw new Error(profileError.message);
      }

      const matchingProfiles = (profileMatches ?? []).filter((profile) =>
        matchesPersonnelName(profile.full_name, assignedOfficerName),
      );

      const candidateIds = matchingProfiles.map((profile) => profile.id);

      if (candidateIds.length > 0) {
        const { data: membershipMatches, error: membershipError } =
          await admin
            .from("department_memberships")
            .select("user_id")
            .eq("department_id", departmentId)
            .eq("is_active", true)
            .in("user_id", candidateIds);

        if (membershipError) {
          throw new Error(membershipError.message);
        }

        if ((membershipMatches ?? []).length > 1) {
          return NextResponse.json(
            {
              error: `Officer "${assignedOfficerName}" matched more than one active personnel record. Include a badge number to disambiguate.`,
            },
            { status: 409 },
          );
        }

        if ((membershipMatches ?? []).length === 1) {
          assignedToUserId = membershipMatches![0].user_id;
        }
      }
    }

    if (
      !assignedToUserId &&
      (assignedOfficerName || badgeNumber)
    ) {
      return NextResponse.json(
        {
          error:
            "The assigned officer could not be matched to an active personnel record in the selected agency.",
        },
        { status: 400 },
      );
    }

    if (assignedToUserId) {
      const { data: membership, error: membershipError } =
        await admin
          .from("department_memberships")
          .select("user_id")
          .eq("department_id", departmentId)
          .eq("user_id", assignedToUserId)
          .eq("is_active", true)
          .maybeSingle();

      if (membershipError) {
        throw new Error(membershipError.message);
      }

      if (!membership) {
        return NextResponse.json(
          {
            error:
              "The assigned officer is not an active department member.",
          },
          { status: 400 },
        );
      }

      if (conditionStatus !== "In Service") {
        return NextResponse.json(
          {
            error:
              "Only an in-service firearm may be assigned during import.",
          },
          { status: 409 },
        );
      }
    }

    const { data: existing, error: existingError } =
      await admin
        .from("firearms")
        .select(
          "id,make,model,serial_number,firearm_type,caliber,asset_number,condition_status,notes",
        )
        .eq("department_id", departmentId)
        .ilike("serial_number", serialNumber)
        .limit(1)
        .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      if (assignedToUserId) {
        const { data: activeAssignment, error: assignmentLookupError } =
          await admin
            .from("firearm_assignments")
            .select("id, assigned_to_user_id")
            .eq("department_id", departmentId)
            .eq("firearm_id", existing.id)
            .is("returned_at", null)
            .limit(1)
            .maybeSingle();

        if (assignmentLookupError) {
          throw new Error(assignmentLookupError.message);
        }

        if (
          activeAssignment &&
          activeAssignment.assigned_to_user_id !== assignedToUserId
        ) {
          return NextResponse.json(
            {
              error:
                "This firearm is already actively assigned to a different officer. Review the assignment before importing.",
              status: "assignment_conflict",
              firearmId: existing.id,
              currentAssignedToUserId:
                activeAssignment.assigned_to_user_id,
              incomingAssignedToUserId: assignedToUserId,
            },
            { status: 409 },
          );
        }

        if (!activeAssignment) {
          const { error: assignmentInsertError } = await admin
            .from("firearm_assignments")
            .insert({
              department_id: departmentId,
              firearm_id: existing.id,
              assigned_to_user_id: assignedToUserId,
              assigned_by_user_id: user.id,
              assigned_at: new Date().toISOString(),
              condition_at_issue: conditionStatus,
              magazines_issued: 0,
            });

          if (assignmentInsertError) {
            throw new Error(
              `The firearm assignment could not be created: ${assignmentInsertError.message}`,
            );
          }

          await admin.from("audit_events").insert({
            department_id: departmentId,
            actor_user_id: user.id,
            action: "firearm_assignment_added_during_onboarding",
            entity_type: "firearm",
            entity_id: existing.id,
            new_value: {
              assigned_to_user_id: assignedToUserId,
              platform_admin: Boolean(platformAdminResult.data),
            },
          });
        }
      }

      const merge = buildEnrichOnlyUpdates(
        existing as Record<string, unknown>,
        {
          make,
          model,
          firearm_type: firearmType,
          caliber: cleanText(body.caliber),
          asset_number: cleanText(body.assetNumber),
          condition_status: cleanText(body.conditionStatus),
          notes: cleanText(body.notes),
        },
        ["id", "serial_number"],
      );

      if (Object.keys(merge.updates).length > 0) {
        const { error: updateError } = await admin
          .from("firearms")
          .update(merge.updates as {
            make?: string;
            model?: string;
            firearm_type?: "handgun" | "rifle" | "shotgun" | "less_lethal" | "other";
            caliber?: string;
            asset_number?: string | null;
            condition_status?: string;
            notes?: string | null;
          })
          .eq("id", existing.id)
          .eq("department_id", departmentId);

        if (updateError) {
          throw new Error(updateError.message);
        }

        await admin.from("audit_events").insert({
          department_id: departmentId,
          actor_user_id: user.id,
          action: "firearm_enriched_during_onboarding",
          entity_type: "firearm",
          entity_id: existing.id,
          new_value: {
            changed_fields: merge.changedFields,
            conflicts: merge.conflicts.map((conflict) => ({
              field: conflict.field,
              existingValue: String(conflict.existingValue ?? ""),
              incomingValue: String(conflict.incomingValue ?? ""),
            })),
            platform_admin: Boolean(platformAdminResult.data),
          },
        });

        return NextResponse.json({
          ok: true,
          status: "updated",
          firearmId: existing.id,
          changedFields: merge.changedFields,
          conflicts: merge.conflicts,
        });
      }

      return NextResponse.json({
        ok: true,
        status: "unchanged",
        firearmId: existing.id,
        changedFields: [],
        conflicts: merge.conflicts,
      });
    }

    const { data: inserted, error: insertError } =
      await admin
        .from("firearms")
        .insert({
          department_id: departmentId,
          make,
          model: model ?? "TBD / Unknown",
          serial_number: serialNumber,
          firearm_type: firearmType,
          caliber: cleanText(body.caliber) ?? "TBD / Unknown",
          asset_number: cleanText(body.assetNumber),
          condition_status: conditionStatus,
          notes: cleanText(body.notes),
          is_active: true,
          created_by: user.id,
        })
        .select("id")
        .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    if (assignedToUserId) {
      const { error: assignmentError } =
        await admin
          .from("firearm_assignments")
          .insert({
            department_id: departmentId,
            firearm_id: inserted.id,
            assigned_to_user_id: assignedToUserId,
            assigned_by_user_id: user.id,
            assigned_at: new Date().toISOString(),
            condition_at_issue: conditionStatus,
            magazines_issued: 0,
          });

      if (assignmentError) {
        await admin
          .from("firearms")
          .delete()
          .eq("id", inserted.id)
          .eq("department_id", departmentId);

        throw new Error(
          `The firearm assignment could not be created: ${assignmentError.message}`,
        );
      }
    }

    await admin.from("audit_events").insert({
      department_id: departmentId,
      actor_user_id: user.id,
      action: "firearm_imported_during_onboarding",
      entity_type: "firearm",
      entity_id: inserted.id,
      new_value: {
        serial_number: serialNumber,
        assigned_to_user_id: assignedToUserId,
        platform_admin: Boolean(platformAdminResult.data),
      },
    });

    return NextResponse.json(
      {
        ok: true,
        status: "created",
        firearmId: inserted.id,
        assignmentCreated: Boolean(assignedToUserId),
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Firearm import failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}












