import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export default async function CommandDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const resolved = await resolveServerAccess();

  if (!resolved.ok) {
    redirect("/");
  }

  const featureError = requireServerFeature(
    resolved.context,
    "command_dashboard",
    "Command Dashboard",
  );

  if (featureError) {
    redirect("/");
  }

  return children;
}
