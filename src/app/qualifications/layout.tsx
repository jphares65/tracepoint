import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export default async function QualificationsLayout({
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
    "qualifications",
    "Qualifications",
  );

  if (featureError) {
    redirect("/");
  }

  return children;
}
