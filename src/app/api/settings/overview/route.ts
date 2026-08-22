import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await resolveServerAccess();

  if (!access.ok) {
    return accessFailureResponse(access);
  }

  const context = access.context;
  const db = context.db;
  const departmentId = context.departmentId;

  const canManageUsers = hasAnyServerPermission(context, [
    "manage_users",
    "administer_department",
  ]);

  const canViewSecurity = hasAnyServerPermission(context, [
    "administer_department",
  ]);

  const [
    departmentResult,
    rulesResult,
    securityResult,
    rolesResult,
    permissionsResult,
    rolePermissionsResult,
  ] = await Promise.all([
    db
      .from("departments")
      .select(
        "id,name,short_name,state,county,agency_type,sworn_officers,civilian_staff,timezone,primary_contact_user_id,patch_url,accent_color,login_theme",
      )
      .eq("id", departmentId)
      .single(),

    db
      .from("department_rules")
      .select("*")
      .eq("department_id", departmentId)
      .maybeSingle(),

    canViewSecurity
      ? db
          .from("department_security_settings")
          .select("*")
          .eq("department_id", departmentId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    context.admin
      .from("roles")
      .select("code,display_name,description,sort_order")
      .order("sort_order"),

    context.admin
      .from("permissions")
      .select("code,display_name,description"),

    db
      .from("department_role_permissions")
      .select("role_code,permission_code")
      .eq("department_id", departmentId),
  ]);

  let membersResult: { data: any[]; error: any } = {
    data: [],
    error: null,
  };

  if (canManageUsers) {
    const result = await context.admin.rpc(
      "get_department_members",
      {
        p_department_id: departmentId,
      },
    );

    membersResult = {
      data: result.data ?? [],
      error: result.error,
    };
  }

  const firstError = [
    departmentResult.error,
    rulesResult.error,
    securityResult.error,
    rolesResult.error,
    permissionsResult.error,
    rolePermissionsResult.error,
    membersResult.error,
  ].find(Boolean);

  if (firstError) {
    return NextResponse.json(
      {
        error:
          typeof firstError?.message === "string"
            ? firstError.message
            : "Settings could not be loaded.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    department: departmentResult.data,
    rules: rulesResult.data,
    security: securityResult.data,
    roles: rolesResult.data ?? [],
    permissions: permissionsResult.data ?? [],
    rolePermissions: rolePermissionsResult.data ?? [],
    members: membersResult.data ?? [],
  });
}