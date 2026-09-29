import "server-only";

import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

import { readBearerToken } from "@/lib/authentication/request-bearer";
import { resolveAuthenticatedPrincipal } from "@/lib/authentication/request-session";
import { parseCognitoTargetConfiguration } from "@/lib/authentication/cognito-runtime-configuration-core";
import { resolvePostgresAccess } from "@/lib/tracepoint/server-access-postgres";
import type { TracePointPermission } from "@/lib/tracepoint/permissions";
import { effectiveDepartmentPermissions } from "@/lib/tracepoint/permission-authority";
import { resolveTenantContext } from "@/lib/tracepoint/tenant-context";

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
  accentColor: string;
  loginTheme: string;
  badgeNumber: string;
  rankTitle: string;
  unitName: string;
  roleCodes: string[];
  roleLabels: string[];
  primaryRoleLabel: string;
  permissions: TracePointPermission[];
  isSuperAdmin: boolean;
  isSupportMode: boolean;
  enabledFeatures: string[];
};

export type ServerAccessContext = ServerAccessPayload & {
  // The repositories intentionally expose narrow structural client contracts.
  // Keep this boundary dynamic until those contracts share the generated client type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authDb: any;
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
  accent_color?: string | null;
  login_theme?: string | null;
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
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE === "aws-native") {
    try {
      parseCognitoTargetConfiguration(process.env);
      // Browser sessions are the only native application credential in this
      // release. A bearer token must never fall through to Supabase.
      if ((await headers()).has("authorization")) {
        return { ok: false, status: 401, error: "Authentication is required." };
      }
      const principal = await resolveAuthenticatedPrincipal();
      if (!principal || principal.provider !== "cognito") {
        return { ok: false, status: 401, error: "Authentication is required." };
      }
      const cookieStore = await cookies();
      const selected = clean(cookieStore.get("tracepoint_department_id")?.value);
      const support = clean(cookieStore.get("tracepoint_support_department_id")?.value);
      return await resolvePostgresAccess(principal, selected, support) as ServerAccessResult;
    } catch {
      return { ok: false, status: 503, error: "AWS-native access verification is unavailable." };
    }
  }
  if (process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE &&
      process.env.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "bridge") {
    return { ok: false, status: 503, error: "Runtime provider configuration is invalid." };
  }
  const [{ createAdminClient }, { createClient: createServerClient }, { getServerAuthenticatedUser }] = await Promise.all([
    import("@/lib/supabase/admin"),
    import("@/lib/supabase/server"),
    import("@/lib/authentication/server-provider"),
  ]);
  const server = await createServerClient();
  const accessToken = readBearerToken((await headers()).get("authorization"));
  const user = await getServerAuthenticatedUser(server, process.env, accessToken);

  if (!user) {
    return {
      ok: false,
      status: 401,
      error: "Authentication is required.",
    };
  }

  // See ServerAccessContext: downstream repositories narrow this client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const cookieStore = await cookies();

  const selectedDepartmentId =
    clean(cookieStore.get("tracepoint_department_id")?.value);

  const supportDepartmentId =
    clean(cookieStore.get("tracepoint_support_department_id")?.value);

  const { data: platformAdmin, error: platformAdminError } = await admin
    .from("platform_admins")
    .select("is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (platformAdminError) {
    return {
      ok: false,
      status: 500,
      error: platformAdminError.message,
    };
  }

  const isPlatformAdmin = platformAdmin?.is_active === true;
  const supportModeRequested =
    Boolean(supportDepartmentId) && supportDepartmentId === selectedDepartmentId;

  // A platform administrator must still name a single tenant. This permits
  // tenant-scoped support without inventing a department membership.
  if (isPlatformAdmin && selectedDepartmentId) {
    const [
      departmentResult,
      profileResult,
      departmentFeaturesResult,
    ] = await Promise.all([
      admin
        .from("departments")
        .select("name,short_name,patch_url,accent_color,login_theme")
        .eq("id", selectedDepartmentId)
        .maybeSingle(),

      admin
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle(),

      admin
        .from("department_features")
        .select("feature_code,is_enabled")
        .eq("department_id", selectedDepartmentId),
    ]);

    if (departmentResult.error) {
      return {
        ok: false,
        status: 500,
        error: departmentResult.error.message,
      };
    }

    if (!departmentResult.data) {
      return {
        ok: false,
        status: 404,
        error: "Selected agency was not found.",
      };
    }

    if (departmentFeaturesResult.error) {
      return {
        ok: false,
        status: 500,
        error: departmentFeaturesResult.error.message,
      };
    }

    const department = departmentResult.data as DepartmentRow;
    const profile = profileResult.data as ProfileRow | null;

    const metadataName = clean(user.user_metadata?.full_name);

    const fullName =
      clean(profile?.full_name) ||
      metadataName ||
      clean(user.email)?.split("@")[0] ||
      "TracePoint Platform Administrator";

    const enabledFeatures = uniqueStrings(
      (departmentFeaturesResult.data ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((row: any) => row.is_enabled !== false)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((row: any) => row.feature_code),
    );

    return {
      ok: true,
      context: {
        user,
        admin,
        db: admin,
        authDb: server,
        userId: user.id,
        email: clean(user.email),
        fullName,
        departmentId: selectedDepartmentId,
        departmentName:
          clean(department.name) || "TracePoint Department",
        departmentShortName:
          clean(department.short_name) ||
          clean(department.name) ||
          "TracePoint",
        departmentPatchUrl: clean(department.patch_url),
        accentColor: clean(department.accent_color),
        loginTheme: clean(department.login_theme),
        badgeNumber: "",
        rankTitle: "TracePoint Platform Administrator",
        unitName: "",
        roleCodes: ["platform_support"],
        roleLabels: ["Platform Support"],
        primaryRoleLabel: "Platform Support",
        permissions: [
          "administer_department" as TracePointPermission,
        ],
        isSuperAdmin: true,
        isSupportMode: supportModeRequested,
        enabledFeatures,
      },
    };
  }

  const { data: membershipRows, error: membershipError } = await admin
    .from("department_memberships")
    .select(
      "department_id,badge_number,rank_title,unit_name",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)

  if (membershipError) {
    return {
      ok: false,
      status: 500,
      error: membershipError.message,
    };
  }

  const memberships = (membershipRows ?? []) as MembershipRow[];
  const tenantContext = resolveTenantContext({
    selectedDepartmentId,
    activeMembershipDepartmentIds: memberships.map((row) =>
      clean(row.department_id),
    ),
    isPlatformAdmin: false,
  });

  if (!tenantContext.ok && tenantContext.reason === "no_membership") {
    return {
      ok: false,
      status: 403,
      error: "No active department membership was found.",
    };
  }
  if (!tenantContext.ok) {
    return {
      ok: false,
      status: 409,
      error:
        "Multiple active department memberships were found. Select an active agency before access can continue.",
    };
  }

  const departmentId = tenantContext.departmentId;
  const membership = memberships.find(
    (row) => clean(row.department_id) === departmentId,
  );

  if (!membership) {
    return {
      ok: false,
      status: 403,
      error: "No active department membership was found.",
    };
  }

  const [
    departmentResult,
    profileResult,
    membershipRolesResult,
    departmentFeaturesResult,
  ] = await Promise.all([
    admin
      .from("departments")
      .select("name,short_name,patch_url,accent_color,login_theme")
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

    admin
      .from("department_features")
      .select("feature_code,is_enabled")
      .eq("department_id", departmentId),
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

  if (departmentFeaturesResult.error) {
    return {
      ok: false,
      status: 500,
      error: departmentFeaturesResult.error.message,
    };
  }

  const roleCodes = uniqueStrings(
    (membershipRolesResult.data ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const permissions = effectiveDepartmentPermissions(
    roleCodes,
    permissionRows.map((row) => row.permission_code),
  );

  const isSuperAdmin = isPlatformAdmin;

  const enabledFeatures = uniqueStrings(
    (departmentFeaturesResult.data ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((row: any) => row.is_enabled !== false)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((row: any) => row.feature_code),
  );
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
      db: server,
      authDb: server,
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
      accentColor: clean(department?.accent_color),
      loginTheme: clean(department?.login_theme),
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
      isSuperAdmin,
      isSupportMode: false,
      enabledFeatures,
    },
  };
}

export function toAccessPayload(
  context: ServerAccessContext,
): ServerAccessPayload {
  const payload = { ...context } as Partial<ServerAccessContext>;
  delete payload.user;
  delete payload.admin;
  delete payload.db;
  delete payload.authDb;
  return payload as ServerAccessPayload;
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
    {
      error:
        result.status >= 500
          ? "TracePoint access could not be verified."
          : result.error,
    },
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

export function hasServerFeature(
  context: ServerAccessContext,
  featureCode: string,
) {
  return context.enabledFeatures.includes(featureCode);
}

export function featureDisabledResponse(
  featureName = "This TracePoint module",
) {
  return NextResponse.json(
    {
      error: `${featureName} is not enabled for this agency.`,
      code: "FEATURE_NOT_ENABLED",
    },
    {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function requireServerFeature(
  context: ServerAccessContext,
  featureCode: string,
  featureName?: string,
) {
  if (hasServerFeature(context, featureCode)) {
    return null;
  }

  return featureDisabledResponse(
    featureName ?? "This TracePoint module",
  );
}






