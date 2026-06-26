"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

import type { TracePointPermission } from "./permissions";

type ProfileRow = {
  full_name?: string | null;
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
};

type MembershipRoleRow = {
  role_code?: string | null;
};

type RoleRow = {
  code?: string | null;
  display_name?: string | null;
};

type RolePermissionRow = {
  permission_code?: string | null;
};

const ROLE_PRIORITY = [
  "administrator",
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
  chief: "Chief",
  command_staff: "Command Staff",
  supervisor: "Supervisor",
  range_master: "Range Master",
  armorer: "Armorer",
  instructor: "Instructor",
  officer: "Officer",
};

export type TracePointAccess = {
  loading: boolean;
  error: string | null;
  userId: string;
  email: string;
  fullName: string;
  departmentId: string;
  departmentName: string;
  departmentShortName: string;
  badgeNumber: string;
  rankTitle: string;
  unitName: string;
  roleCodes: string[];
  roleLabels: string[];
  primaryRoleLabel: string;
  permissions: TracePointPermission[];
  hasPermission: (permission: TracePointPermission) => boolean;
  hasAnyPermission: (
    permissions: readonly TracePointPermission[],
  ) => boolean;
  refresh: () => Promise<void>;
};

const EMPTY_ACCESS = {
  userId: "",
  email: "",
  fullName: "",
  departmentId: "",
  departmentName: "",
  departmentShortName: "",
  badgeNumber: "",
  rankTitle: "",
  unitName: "",
  roleCodes: [] as string[],
  roleLabels: [] as string[],
  primaryRoleLabel: "Member",
  permissions: [] as TracePointPermission[],
};

export function useTracePointAccess(): TracePointAccess {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState(EMPTY_ACCESS);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setAccess(EMPTY_ACCESS);
      setError(userError?.message ?? "No authenticated user.");
      setLoading(false);
      return;
    }

    const { data: profileData } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();

    const { data: membershipData, error: membershipError } =
      await supabase
        .from("department_memberships")
        .select(
          "department_id,badge_number,rank_title,unit_name",
        )
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

    if (membershipError) {
      setAccess({
        ...EMPTY_ACCESS,
        userId: user.id,
        email: user.email ?? "",
      });
      setError(membershipError.message);
      setLoading(false);
      return;
    }

    const profile = profileData as ProfileRow | null;
    const membership = membershipData as MembershipRow | null;
    const departmentId = membership?.department_id ?? "";

    let department: DepartmentRow | null = null;
    let membershipRoles: MembershipRoleRow[] = [];
    let databaseRoles: RoleRow[] = [];
    let rolePermissions: RolePermissionRow[] = [];

    if (departmentId) {
      const { data: departmentData } = await supabase
        .from("departments")
        .select("name,short_name")
        .eq("id", departmentId)
        .maybeSingle();

      department = departmentData as DepartmentRow | null;

      const { data: membershipRoleData } = await supabase
        .from("department_membership_roles")
        .select("role_code")
        .eq("department_id", departmentId)
        .eq("user_id", user.id);

      membershipRoles =
        (membershipRoleData ?? []) as MembershipRoleRow[];

      const roleCodes = membershipRoles
        .map((row) => row.role_code)
        .filter((value): value is string => Boolean(value));

      if (roleCodes.length > 0) {
        const [{ data: roleData }, { data: permissionData }] =
          await Promise.all([
            supabase
              .from("roles")
              .select("code,display_name")
              .in("code", roleCodes),
            supabase
              .from("department_role_permissions")
              .select("permission_code")
              .eq("department_id", departmentId)
              .in("role_code", roleCodes),
          ]);

        databaseRoles = (roleData ?? []) as RoleRow[];
        rolePermissions =
          (permissionData ?? []) as RolePermissionRow[];
      }
    }

    const roleCodes = Array.from(
      new Set(
        membershipRoles
          .map((row) => row.role_code)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const roleLabelMap = new Map(
      databaseRoles
        .filter(
          (row): row is Required<RoleRow> =>
            Boolean(row.code && row.display_name),
        )
        .map((row) => [row.code, row.display_name]),
    );

    const roleLabels = roleCodes.map(
      (code) => roleLabelMap.get(code) ?? ROLE_LABELS[code] ?? code,
    );

    const primaryRoleCode =
      ROLE_PRIORITY.find((code) => roleCodes.includes(code)) ??
      roleCodes[0];

    const primaryRoleLabel = primaryRoleCode
      ? roleLabelMap.get(primaryRoleCode) ??
        ROLE_LABELS[primaryRoleCode] ??
        primaryRoleCode
      : "Member";

    const permissions = Array.from(
      new Set(
        rolePermissions
          .map((row) => row.permission_code)
          .filter(
            (value): value is TracePointPermission =>
              Boolean(value),
          ),
      ),
    );

    const metadataName =
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name.trim()
        : "";

    const fullName =
      (profile as ProfileRow | null)?.full_name?.trim() ||
      metadataName ||
      user.email?.split("@")[0] ||
      "TracePoint User";

    setAccess({
      userId: user.id,
      email: user.email ?? "",
      fullName,
      departmentId,
      departmentName: department?.name?.trim() || "TracePoint Department",
      departmentShortName:
        department?.short_name?.trim() ||
        department?.name?.trim() ||
        "TracePoint",
      badgeNumber: membership?.badge_number?.trim() || "",
      rankTitle: membership?.rank_title?.trim() || "",
      unitName: membership?.unit_name?.trim() || "",
      roleCodes,
      roleLabels,
      primaryRoleLabel,
      permissions,
    });

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  const permissionSet = useMemo(
    () => new Set(access.permissions),
    [access.permissions],
  );

  const hasPermission = useCallback(
    (permission: TracePointPermission) =>
      permissionSet.has(permission),
    [permissionSet],
  );

  const hasAnyPermission = useCallback(
    (permissions: readonly TracePointPermission[]) =>
      permissions.some((permission) =>
        permissionSet.has(permission),
      ),
    [permissionSet],
  );

  return {
    loading,
    error,
    ...access,
    hasPermission,
    hasAnyPermission,
    refresh: loadAccess,
  };
}
