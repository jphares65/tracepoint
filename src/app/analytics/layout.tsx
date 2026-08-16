import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export default async function AnalyticsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    redirect("/");
  }

  const analyticsError = requireServerFeature(
    resolved.context,
    "analytics",
    "Analytics",
  );

  if (analyticsError) {
    redirect("/");
  }

  const rangeError = requireServerFeature(
    resolved.context,
    "range_training",
    "Range & Training",
  );

  if (rangeError) {
    redirect("/");
  }

  return children;
}
