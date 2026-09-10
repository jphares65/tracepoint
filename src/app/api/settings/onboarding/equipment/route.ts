import { NextRequest, NextResponse } from "next/server";

import { buildEnrichOnlyUpdates } from "@/lib/onboarding/merge";
import { accessFailureResponse, hasAnyServerPermission, resolveServerAccess } from "@/lib/tracepoint/server-access";

const VALID_LIFECYCLE = new Set([
  "active",
  "out_of_service",
]);

type EquipmentImportRequest = {
  departmentId?: string;
  equipmentType?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  lotNumber?: string;
  assignedToUserId?: string;
  issueDate?: string;
  expirationDate?: string;
  lastInspectionDate?: string;
  nextInspectionDate?: string;
  lifecycleStatus?: string;
  notes?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

export async function POST(request: NextRequest) {
  const body = (await request
    .json()
    .catch(() => ({}))) as EquipmentImportRequest;

  const departmentId = cleanText(body.departmentId);
  const equipmentTypeName = cleanText(body.equipmentType);

  if (!departmentId || !equipmentTypeName) {
    return NextResponse.json(
      {
        error:
          "Department and equipment type are required.",
      },
      { status: 400 },
    );
  }

  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (access.context.departmentId !== departmentId) {
    return NextResponse.json({ error: "The active agency does not match this request." }, { status: 403 });
  }
  if (!hasAnyServerPermission(access.context, ["manage_equipment", "administer_department"])) {
    return NextResponse.json(
      {
        error:
          "Equipment-management permission is required for this department.",
      },
      { status: 403 },
    );
  }

  const { admin, user, isSuperAdmin } = access.context;

  try {
    const { data: equipmentType, error: typeError } =
      await admin
        .from("equipment_types")
        .select("id,name")
        .eq("department_id", departmentId)
        .eq("is_active", true)
        .ilike("name", equipmentTypeName)
        .limit(1)
        .maybeSingle();

    if (typeError) {
      throw new Error(typeError.message);
    }

    if (!equipmentType) {
      return NextResponse.json(
        {
          error:
            `Equipment type "${equipmentTypeName}" is not configured for this department.`,
        },
        { status: 400 },
      );
    }

    const assignedToUserId = cleanText(body.assignedToUserId);

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
              "Assigned officer must be an active department member.",
          },
          { status: 400 },
        );
      }
    }

    const lifecycleStatus =
      cleanText(body.lifecycleStatus) ?? "active";

    if (!VALID_LIFECYCLE.has(lifecycleStatus)) {
      return NextResponse.json(
        { error: "Invalid equipment lifecycle status." },
        { status: 400 },
      );
    }

    const serialNumber = cleanText(body.serialNumber);

    if (serialNumber) {
      const { data: existing, error: existingError } =
        await admin
          .from("equipment_assets")
          .select(
            "id,equipment_type_id,manufacturer,model,serial_number,lot_number,assigned_user_id,issue_date,expiration_date,last_inspection_date,next_inspection_date,lifecycle_status,notes",
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
            equipment_type_id: equipmentType.id,
            manufacturer: cleanText(body.manufacturer),
            model: cleanText(body.model),
            lot_number: cleanText(body.lotNumber),
            assigned_user_id: assignedToUserId,
            issue_date: cleanText(body.issueDate),
            expiration_date: cleanText(body.expirationDate),
            last_inspection_date: cleanText(body.lastInspectionDate),
            next_inspection_date: cleanText(body.nextInspectionDate),
            lifecycle_status: cleanText(body.lifecycleStatus),
            notes: cleanText(body.notes),
          },
          ["id", "serial_number"],
        );

        if (Object.keys(merge.updates).length > 0) {
          const { error: updateError } = await admin
            .from("equipment_assets")
            .update(merge.updates)
            .eq("id", existing.id)
            .eq("department_id", departmentId);

          if (updateError) {
            throw new Error(updateError.message);
          }

          return NextResponse.json({
            ok: true,
            status: "updated",
            equipmentId: existing.id,
            changedFields: merge.changedFields,
            conflicts: merge.conflicts,
          });
        }

        return NextResponse.json({
          ok: true,
          status: "unchanged",
          equipmentId: existing.id,
          changedFields: [],
          conflicts: merge.conflicts,
        });
      }
    }

    const { data: inserted, error: insertError } =
      await admin
        .from("equipment_assets")
        .insert({
          department_id: departmentId,
          equipment_type_id: equipmentType.id,
          manufacturer: cleanText(body.manufacturer),
          model: cleanText(body.model),
          serial_number: serialNumber,
          lot_number: cleanText(body.lotNumber),
          assigned_user_id: assignedToUserId,
          issue_date: cleanText(body.issueDate),
          expiration_date: cleanText(body.expirationDate),
          last_inspection_date:
            cleanText(body.lastInspectionDate),
          next_inspection_date:
            cleanText(body.nextInspectionDate),
          lifecycle_status: lifecycleStatus,
          notes: cleanText(body.notes),
          document_url: null,
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    const auditPayload = {
      department_id: departmentId,
      actor_user_id: user.id,
      action: "equipment_imported_during_onboarding",
      entity_type: "equipment_asset",
      entity_id: inserted.id,
      new_value: {
        equipment_type_id: equipmentType.id,
        equipment_type_name: equipmentType.name,
        serial_number: serialNumber,
        assigned_user_id: assignedToUserId,
        platform_admin: isSuperAdmin,
      },
    };
    const auditResult = process.env.TRACEPOINT_DATA_PROVIDER === "postgres"
      ? await admin.rpc("record_onboarding_import_audit", {
          p_department_id: departmentId,
          p_action: auditPayload.action,
          p_entity_type: auditPayload.entity_type,
          p_entity_id: inserted.id,
          p_new_value: auditPayload.new_value,
        })
      : await admin.from("audit_events").insert(auditPayload);
    if (auditResult.error) throw new Error(auditResult.error.message);

    return NextResponse.json(
      {
        ok: true,
        status: "created",
        equipmentId: inserted.id,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Equipment import failed.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
