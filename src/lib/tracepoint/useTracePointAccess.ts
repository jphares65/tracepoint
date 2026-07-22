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
  hasPermission: (permission: TracePointPermission) => boolean;
  hasAnyPermission: (
    permissions: readonly TracePointPermission[],
  ) => boolean;
  refresh: () => Promise<void>;
};

type AccessPayload = Omit<
  TracePointAccess,
  | "loading"
  | "error"
  | "hasPermission"
  | "hasAnyPermission"
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
};

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || "TracePoint access could not be verified.";
  } catch {
    return "TracePoint access could not be verified.";
  }
}

export function useTracePointAccess(): TracePointAccess {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessPayload>(EMPTY_ACCESS);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/access", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });

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
  }, []);

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

  const permissionSet = useMemo(
    () => new Set(access.permissions),
    [access.permissions],
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
    ...access,
    hasPermission,
    hasAnyPermission,
    refresh: loadAccess,
  };
}
