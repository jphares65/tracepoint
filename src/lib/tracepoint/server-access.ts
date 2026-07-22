import "server-only";

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  isTracePointPermission,
  type TracePointPermission,
} from "@/lib/tracepoint/permissions";

type AccessFailure = {
  ok: false;
  status: number;
  error: string;
};

type AccessSuccess = {
  ok: true;
  context: ServerAccessContext;
};

export type ServerAccessResult = AccessFailure | AccessSuccess;

export type ServerAccessPayload = {
  userId: string;
  email: string;
  fullName: string;
  departmentId: string;
  departmentName: string;
  departmentShortName: string;
  departmentPatchUrl: string;
  badgeNumber: string;
  rankTitle: string;
  unitName: string;
  roleCodes: string[];
  roleLabels: string[];
  primaryRoleLabel: string;
  permissions: TracePointPermission[];
};

export type ServerAccessContext = ServerAccessPayload & {
  user: any;
  admin: any;
};

type MembershipRow = {
  department_id?: string | null;
  badge_number?: string | null;
  rank_title?: string | null;
  unit_name?: string | null;
};

type DepartmentRow = {
  name?: string | null;
  short_name?: string | null;
  patch_url?: string | null;
};

type ProfileRow = {
  full_name?: string | null;
};

type RoleRow = {
  code?: string | null;
  display_name?: string | null;
};

const ROLE_PRIORITY = [
  "administrator",
  "department_admin",
  "admin",
  "chief",
  "command_staff",
  "supervisor",
  "range_master",
  "armorer",
  "instructor",
  "officer",
] as const;

const ROLE_LABELS: Record<string, string> = {
  administrator: "Administrator",
  department_admin: "Department Administrator",
  admin: "Administrator",
  chief: "Chief",
  command_staff: "Command Staff",
  supervisor: "Supervisor",
  range_master: "Range Master",
  armorer: "Armorer",
  instructor: "Instructor",
  officer: "Officer",
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export async function resolveServerAccess(): Promise<ServerAccessResult> {
  const server = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await server.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      status: 401,
      error: "Authentication is required.",
    };
  }

  const admin = createAdminClient() as any;

  const { data: membershipRows, error: membershipError } = await admin
    .from("department_memberships")
    .select(
      "department_id,badge_number,rank_title,unit_name",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(2);

  if (membershipError) {
    return {
      ok: false,
      status: 500,
      error: membershipError.message,
    };
  }

  const memberships = (membershipRows ?? []) as MembershipRow[];

  if (memberships.length === 0 || !memberships[0]?.department_id) {
    return {
      ok: false,
      status: 403,
      error: "No active department membership was found.",
    };
  }

  if (memberships.length > 1) {
    return {
      ok: false,
      status: 409,
      error:
        "Multiple active department memberships were found. An administrator must resolve the account before access can continue.",
    };
  }

  const membership = memberships[0];
  const departmentId = String(membership.department_id);

  const [
    departmentResult,
    profileResult,
    membershipRolesResult,
  ] = await Promise.all([
    admin
      .from("departments")
      .select("name,short_name,patch_url")
      .eq("id", departmentId)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle(),
    admin
      .from("department_membership_roles")
      .select("role_code")
      .eq("department_id", departmentId)
      .eq("user_id", user.id),
  ]);

  if (departmentResult.error) {
    return {
      ok: false,
      status: 500,
      error: departmentResult.error.message,
    };
  }

  if (membershipRolesResult.error) {
    return {
      ok: false,
      status: 500,
      error: membershipRolesResult.error.message,
    };
  }

  const roleCodes = uniqueStrings(
    (membershipRolesResult.data ?? []).map(
      (row: any) => row.role_code,
    ),
  );

  let roleRows: RoleRow[] = [];
  let permissionRows: Array<{ permission_code?: string | null }> = [];

  if (roleCodes.length > 0) {
    const [rolesResult, permissionsResult] = await Promise.all([
      admin
        .from("roles")
        .select("code,display_name")
        .in("code", roleCodes),
      admin
        .from("department_role_permissions")
        .select("permission_code")
        .eq("department_id", departmentId)
        .in("role_code", roleCodes),
    ]);

    if (rolesResult.error) {
      return {
        ok: false,
        status: 500,
        error: rolesResult.error.message,
      };
    }

    if (permissionsResult.error) {
      return {
        ok: false,
        status: 500,
        error: permissionsResult.error.message,
      };
    }

    roleRows = (rolesResult.data ?? []) as RoleRow[];
    permissionRows = permissionsResult.data ?? [];
  }

  const roleLabelMap = new Map(
    roleRows
      .filter((row) => clean(row.code) && clean(row.display_name))
      .map((row) => [clean(row.code), clean(row.display_name)]),
  );

  const roleLabels = roleCodes.map(
    (roleCode) =>
      roleLabelMap.get(roleCode) ??
      ROLE_LABELS[roleCode] ??
      roleCode,
  );

  const primaryRoleCode =
    ROLE_PRIORITY.find((roleCode) =>
      roleCodes.includes(roleCode),
    ) ?? roleCodes[0];

  const administratorRole = roleCodes.some((roleCode) =>
    ["administrator", "department_admin", "admin"].includes(roleCode),
  );

  const permissions = uniqueStrings(
    permissionRows.map((row) => row.permission_code),
  ).filter(isTracePointPermission);

  if (
    administratorRole &&
    !permissions.includes("administer_department")
  ) {
    permissions.push("administer_department");
  }

  const profile = profileResult.data as ProfileRow | null;
  const department = departmentResult.data as DepartmentRow | null;
  const metadataName = clean(user.user_metadata?.full_name);
  const fullName =
    clean(profile?.full_name) ||
    metadataName ||
    clean(user.email)?.split("@")[0] ||
    "TracePoint User";

  return {
    ok: true,
    context: {
      user,
      admin,
      userId: user.id,
      email: clean(user.email),
      fullName,
      departmentId,
      departmentName:
        clean(department?.name) || "TracePoint Department",
      departmentShortName:
        clean(department?.short_name) ||
        clean(department?.name) ||
        "TracePoint",
      departmentPatchUrl: clean(department?.patch_url),
      badgeNumber: clean(membership.badge_number),
      rankTitle: clean(membership.rank_title),
      unitName: clean(membership.unit_name),
      roleCodes,
      roleLabels,
      primaryRoleLabel: primaryRoleCode
        ? roleLabelMap.get(primaryRoleCode) ??
          ROLE_LABELS[primaryRoleCode] ??
          primaryRoleCode
        : "Member",
      permissions,
    },
  };
}

export function toAccessPayload(
  context: ServerAccessContext,
): ServerAccessPayload {
  const {
    user: _user,
    admin: _admin,
    ...payload
  } = context;

  return payload;
}

export function hasServerPermission(
  context: ServerAccessContext,
  permission: TracePointPermission,
) {
  return (
    context.permissions.includes("administer_department") ||
    context.permissions.includes(permission)
  );
}

export function hasAnyServerPermission(
  context: ServerAccessContext,
  permissions: readonly TracePointPermission[],
) {
  return (
    context.permissions.includes("administer_department") ||
    permissions.some((permission) =>
      context.permissions.includes(permission),
    )
  );
}

export function accessFailureResponse(
  result: AccessFailure,
) {
  return NextResponse.json(
    { error: result.error },
    {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function permissionDeniedResponse(
  message = "You do not have permission to perform this action.",
) {
  return NextResponse.json(
    { error: message },
    {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
