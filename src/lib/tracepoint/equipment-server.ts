import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";

export async function getEquipmentServerContext() {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 },
      ),
    } as const;
  }

  const admin = createAdminClient() as any;

  const { data: membership, error: membershipError } =
    await admin
      .from("department_memberships")
      .select("department_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

  if (membershipError) {
    return {
      error: NextResponse.json(
        { error: membershipError.message },
        { status: 500 },
      ),
    } as const;
  }

  if (!membership?.department_id) {
    return {
      error: NextResponse.json(
        { error: "No active department membership was found." },
        { status: 403 },
      ),
    } as const;
  }

  const departmentId = String(membership.department_id);

  const { data: roles, error: roleError } = await admin
    .from("department_membership_roles")
    .select("role_code")
    .eq("department_id", departmentId)
    .eq("user_id", user.id);

  if (roleError) {
    return {
      error: NextResponse.json(
        { error: roleError.message },
        { status: 500 },
      ),
    } as const;
  }

  const roleCodes = (roles ?? []).map((row: any) =>
    String(row.role_code),
  );

  let permissionRows: any[] = [];

  if (roleCodes.length > 0) {
    const { data, error } = await admin
      .from("department_role_permissions")
      .select("permission_code")
      .eq("department_id", departmentId)
      .in("role_code", roleCodes)
      .in("permission_code", [
        "manage_equipment",
        "administer_department",
        "view_command_dashboard",
        "view_analytics",
      ]);

    if (error) {
      return {
        error: NextResponse.json(
          { error: error.message },
          { status: 500 },
        ),
      } as const;
    }

    permissionRows = data ?? [];
  }

  const permissions = new Set(
    permissionRows.map((row: any) =>
      String(row.permission_code),
    ),
  );

  return {
    admin,
    user,
    departmentId,
    canManage:
      permissions.has("manage_equipment") ||
      permissions.has("administer_department"),
    canViewDepartment:
      permissions.size > 0,
  } as const;
}

export function equipmentPermissionDenied() {
  return NextResponse.json(
    { error: "You do not have permission to manage equipment." },
    { status: 403 },
  );
}

export function text(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

export function nullableText(value: unknown) {
  const valueText = text(value);
  return valueText || null;
}

export function nullableInteger(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed)
    ? parsed
    : null;
}
