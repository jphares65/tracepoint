import { NextResponse } from "next/server";

import {
  accessFailureResponse,
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export const dynamic = "force-dynamic";

type MemberRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  badge_number: string | null;
  rank_title: string | null;
  unit_name: string | null;
  employee_number: string | null;
  is_active: boolean;
  joined_at: string | null;
  activation_status: string | null;
  role_codes: string[];
  effective_permissions: string[];
};

async function getSupportModeMembers(
  admin: any,
  departmentId: string,
): Promise<{ data: MemberRow[]; error: any }> {
  const [
    membershipsResult,
    membershipRolesResult,
    rolePermissionsResult,
  ] = await Promise.all([
    admin
      .from("department_memberships")
      .select(
        "user_id,badge_number,rank_title,unit_name,employee_number,is_active,joined_at,activation_status",
      )
      .eq("department_id", departmentId),

    admin
      .from("department_membership_roles")
      .select("user_id,role_code")
      .eq("department_id", departmentId),

    admin
      .from("department_role_permissions")
      .select("role_code,permission_code")
      .eq("department_id", departmentId),
  ]);

  const firstError = [
    membershipsResult.error,
    membershipRolesResult.error,
    rolePermissionsResult.error,
  ].find(Boolean);

  if (firstError) {
    return { data: [], error: firstError };
  }

  const memberships = membershipsResult.data ?? [];
  const userIds = memberships
    .map((row: any) => row.user_id)
    .filter(Boolean);

  if (userIds.length === 0) {
    return { data: [], error: null };
  }

  const profilesResult = await admin
    .from("profiles")
    .select("id,full_name,email")
    .in("id", userIds);

  if (profilesResult.error) {
    return { data: [], error: profilesResult.error };
  }

  const profileById = new Map<
    string,
    {
      id: string;
      full_name: string | null;
      email: string | null;
    }
  >(
    (profilesResult.data ?? []).map((profile: any) => [
      String(profile.id),
      {
        id: String(profile.id),
        full_name:
          typeof profile.full_name === "string"
            ? profile.full_name
            : null,
        email:
          typeof profile.email === "string"
            ? profile.email
            : null,
      },
    ]),
  );

  const rolesByUser = new Map<string, Set<string>>();

  for (const row of membershipRolesResult.data ?? []) {
    if (!row.user_id || !row.role_code) continue;

    const roles = rolesByUser.get(row.user_id) ?? new Set<string>();
    roles.add(row.role_code);
    rolesByUser.set(row.user_id, roles);
  }

  const permissionsByRole = new Map<string, Set<string>>();

  for (const row of rolePermissionsResult.data ?? []) {
    if (!row.role_code || !row.permission_code) continue;

    const permissions =
      permissionsByRole.get(row.role_code) ?? new Set<string>();

    permissions.add(row.permission_code);
    permissionsByRole.set(row.role_code, permissions);
  }

  const members: MemberRow[] = memberships.map((membership: any) => {
    const profile = profileById.get(membership.user_id);
    const roleCodes = Array.from(
      rolesByUser.get(membership.user_id) ?? [],
    ).sort();

    const effectivePermissions = Array.from(
      new Set(
        roleCodes.flatMap((roleCode) =>
          Array.from(permissionsByRole.get(roleCode) ?? []),
        ),
      ),
    ).sort();

    return {
      user_id: membership.user_id,
      full_name: profile?.full_name ?? null,
      email: profile?.email ?? null,
      badge_number: membership.badge_number ?? null,
      rank_title: membership.rank_title ?? null,
      unit_name: membership.unit_name ?? null,
      employee_number: membership.employee_number ?? null,
      is_active: Boolean(membership.is_active),
      joined_at: membership.joined_at ?? null,
      activation_status: membership.activation_status ?? null,
      role_codes: roleCodes,
      effective_permissions: effectivePermissions,
    };
  });

  members.sort((a, b) =>
    (a.full_name ?? "").localeCompare(b.full_name ?? ""),
  );

  return {
    data: members,
    error: null,
  };
}

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

  let membersResult: { data: MemberRow[]; error: any } = {
    data: [],
    error: null,
  };

  if (canManageUsers) {
    if (context.isSupportMode) {
      membersResult = await getSupportModeMembers(
        context.admin,
        departmentId,
      );
    } else {
      const result = await db.rpc(
        "get_department_members",
        {
          p_department_id: departmentId,
        },
      );

      membersResult = {
        data: (result.data ?? []) as MemberRow[],
        error: result.error,
      };
    }
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