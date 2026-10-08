"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS, getVisibleChildren } from "@/app/components/TracePointShell";
import { meetsPermissionRequirement } from "@/lib/tracepoint/permissions";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

export default function NavigationDiagnosticClient({ deploymentId }: { deploymentId: string }) {
  const pathname = usePathname();
  const access = useTracePointAccess();
  if (!access.isSupportMode || !access.isSuperAdmin) return <p>Navigation diagnostic unavailable.</p>;
  const administration = NAV_ITEMS.find((item) => "children" in item && item.label === "Administration");
  const features = new Set(access.enabledFeatures);
  const children = administration && "children" in administration ? administration.children.map((child) => ({
    label: child.label, href: child.href, requirement: child.requirement ?? null, featureCode: child.featureCode ?? null,
    permissionResult: meetsPermissionRequirement(access.permissions, child.requirement),
    featureResult: !child.featureCode || access.isSuperAdmin || features.has(child.featureCode),
    finalVisible: getVisibleChildren(administration, access.permissions, features, access.isSuperAdmin).some((visible) => visible.href === child.href),
  })) : [];
  return <pre>{JSON.stringify({ deploymentId, pathname, departmentId: access.departmentId || null, permissions: access.permissions,
    isSuperAdmin: access.isSuperAdmin, isSupportMode: access.isSupportMode, enabledFeatures: access.enabledFeatures,
    administrationChildrenBeforeFiltering: children, administrationChildrenAfterFiltering: children.filter((child) => child.finalVisible).map(({ label, href }) => ({ label, href })),
  }, null, 2)}</pre>;
}
