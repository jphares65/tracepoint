import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

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

  const [manageResult, administerResult, platformAdminResult] =
    await Promise.all([
      server.rpc("has_department_permission", {
        p_department_id: departmentId,
        p_permission_code: "manage_equipment",
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
          "Equipment-management permission is required for this department.",
      },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

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
          .select("id")
          .eq("department_id", departmentId)
          .ilike("serial_number", serialNumber)
          .limit(1)
          .maybeSingle();

      if (existingError) {
        throw new Error(existingError.message);
      }

      if (existing) {
        return NextResponse.json(
          {
            error:
              "An equipment record with this serial number already exists.",
          },
          { status: 409 },
        );
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

    await admin.from("audit_events").insert({
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
        platform_admin: Boolean(platformAdminResult.data),
      },
    });

    return NextResponse.json(
      {
        ok: true,
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