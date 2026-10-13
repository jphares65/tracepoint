import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export default async function AmmunitionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    redirect("/unauthorized?from=/firearms/ammunition");
  }

  if (!hasAnyServerPermission(resolved.context, ["manage_firearms"])) {
    redirect("/unauthorized?from=/firearms/ammunition");
  }

  if (requireServerFeature(resolved.context, "ammunition", "Ammunition")) {
    redirect("/");
  }

  return children;
}
