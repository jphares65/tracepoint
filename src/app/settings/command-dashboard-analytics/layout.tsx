import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export default async function CommandDashboardAnalyticsSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    redirect("/unauthorized");
  }

  if (!hasAnyServerPermission(resolved.context, ["administer_department"])) {
    redirect("/unauthorized?from=/settings/command-dashboard-analytics");
  }

  return children;
}
