"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { TracePointPermission } from "./permissions";

export type TracePointAccess = {
  loading: boolean;
  error: string | null;
  requiresDepartmentSelection: boolean;
  availableDepartments: Array<{
    departmentId: string;
    departmentName: string;
    departmentShortName: string;
    departmentPatchUrl: string;
    badgeNumber: string;
    rankTitle: string;
    unitName: string;
  }>;
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
  isSuperAdmin: boolean;
  enabledFeatures: string[];
  hasPermission: (permission: TracePointPermission) => boolean;
  isFeatureEnabled: (featureCode: string) => boolean;
  hasAnyPermission: (
    permissions: readonly TracePointPermission[],
  ) => boolean;
  refresh: () => Promise<void>;
};

type AccessPayload = Omit<
  TracePointAccess,
  | "loading"
  | "error"
  | "requiresDepartmentSelection"
  | "availableDepartments"
  | "hasPermission"
  | "hasAnyPermission"
  | "isFeatureEnabled"
  | "refresh"
>;

const EMPTY_ACCESS: AccessPayload = {
  userId: "",
  email: "",
  fullName: "",
  departmentId: "",
  departmentName: "",
  departmentShortName: "",
  departmentPatchUrl: "",
  badgeNumber: "",
  rankTitle: "",
  unitName: "",
  roleCodes: [],
  roleLabels: [],
  primaryRoleLabel: "Member",
  permissions: [],
  isSuperAdmin: false,
  enabledFeatures: [],
};

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || "TracePoint access could not be verified.";
  } catch {
    return "TracePoint access could not be verified.";
  }
}

export function useTracePointAccess(options?: { enabled?: boolean }): TracePointAccess {
  const enabled = options?.enabled ?? true;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresDepartmentSelection, setRequiresDepartmentSelection] =
    useState(false);
  const [availableDepartments, setAvailableDepartments] = useState<
    TracePointAccess["availableDepartments"]
  >([]);
  const [access, setAccess] = useState<AccessPayload>(EMPTY_ACCESS);

  const loadAccess = useCallback(async () => {
    if (!enabled) {
      setAccess(EMPTY_ACCESS);
      setError(null);
      setRequiresDepartmentSelection(false);
      setAvailableDepartments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setRequiresDepartmentSelection(false);
    setAvailableDepartments([]);

    try {
      const response = await fetch("/api/access", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });

      if (response.status === 409) {
        const membershipResponse = await fetch("/api/active-department", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!membershipResponse.ok) {
          throw new Error(await readError(membershipResponse));
        }

        const membershipPayload = (await membershipResponse.json()) as {
          memberships?: TracePointAccess["availableDepartments"];
        };

        setAccess(EMPTY_ACCESS);
        setAvailableDepartments(membershipPayload.memberships ?? []);
        setRequiresDepartmentSelection(true);
        return;
      }

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const payload = (await response.json()) as {
        access?: AccessPayload;
      };

      if (!payload.access) {
        throw new Error("TracePoint access payload was missing.");
      }

      setAccess(payload.access);
    } catch (loadError) {
      setAccess(EMPTY_ACCESS);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "TracePoint access could not be verified.",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    const handleDepartmentUpdated = () => {
      void loadAccess();
    };

    window.addEventListener(
      "tracepoint:department-updated",
      handleDepartmentUpdated,
    );

    return () => {
      window.removeEventListener(
        "tracepoint:department-updated",
        handleDepartmentUpdated,
      );
    };
  }, [loadAccess]);

  const featureSet = useMemo(
    () => new Set(access.enabledFeatures),
    [access.enabledFeatures],
  );
  const permissionSet = useMemo(
    () => new Set(access.permissions),
    [access.permissions],
  );

  const isFeatureEnabled = useCallback(
    (featureCode: string) =>
      access.isSuperAdmin || featureSet.has(featureCode),
    [access.isSuperAdmin, featureSet],
  );
  const hasPermission = useCallback(
    (permission: TracePointPermission) =>
      permissionSet.has("administer_department") ||
      permissionSet.has(permission),
    [permissionSet],
  );

  const hasAnyPermission = useCallback(
    (permissions: readonly TracePointPermission[]) =>
      permissionSet.has("administer_department") ||
      permissions.some((permission) =>
        permissionSet.has(permission),
      ),
    [permissionSet],
  );

  return {
    loading,
    error,
    requiresDepartmentSelection,
    availableDepartments,
    ...access,
    hasPermission,
    hasAnyPermission,
    isFeatureEnabled,
    refresh: loadAccess,
  };
}



