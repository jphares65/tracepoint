import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export default async function FirearmsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    redirect("/unauthorized?from=/firearms");
  }

  if (!hasAnyServerPermission(resolved.context, [
    "manage_firearms",
    "manage_inspections",
    "view_command_dashboard",
  ])) {
    redirect("/unauthorized?from=/firearms");
  }

  if (requireServerFeature(resolved.context, "firearms", "Armory")) {
    redirect("/");
  }

  return children;
}
