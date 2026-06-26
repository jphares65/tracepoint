"use client";

import type { ReactNode } from "react";

import {
  meetsPermissionRequirement,
  type PermissionRequirement,
} from "@/lib/tracepoint/permissions";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type PermissionGateProps = PermissionRequirement & {
  children: ReactNode;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
};

export default function PermissionGate({
  children,
  fallback = null,
  loadingFallback = null,
  anyOf,
  allOf,
}: PermissionGateProps) {
  const { loading, permissions } = useTracePointAccess();

  if (loading) {
    return <>{loadingFallback}</>;
  }

  if (
    !meetsPermissionRequirement(permissions, {
      anyOf,
      allOf,
    })
  ) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
