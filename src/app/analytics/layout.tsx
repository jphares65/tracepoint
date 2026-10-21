import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { hasEnabledFeatures, MODULE_FEATURES } from "@/lib/tracepoint/feature-gates";

export default async function AnalyticsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    redirect("/");
  }

  if (!hasAnyServerPermission(resolved.context, ["view_analytics"])) {
    redirect("/unauthorized?from=/analytics");
  }

  if (!hasEnabledFeatures(resolved.context.enabledFeatures, MODULE_FEATURES.analytics)) {
    redirect("/");
  }

  return children;
}
