import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { hasEnabledFeatures, MODULE_FEATURES } from "@/lib/tracepoint/feature-gates";

export default async function OffDutyLayout({
  children,
}: {
  children: ReactNode;
}) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    redirect("/");
  }

  if (!hasEnabledFeatures(resolved.context.enabledFeatures, MODULE_FEATURES.offDuty)) {
    redirect("/");
  }

  return children;
}
