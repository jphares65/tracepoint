import { redirect } from "next/navigation";

import {
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

import TrainingAlertsClient from "./TrainingAlertsClient";

export default async function TrainingAlertsPage() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) redirect("/unauthorized");

  if (!hasAnyServerPermission(resolved.context, ["manage_training", "view_analytics"])) {
    redirect("/unauthorized?from=/training-alerts");
  }

  return <TrainingAlertsClient />;
}
