import { redirect } from "next/navigation";

import {
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";
import { TRAINING_ALERTS_MODULE_PERMISSIONS } from "@/lib/tracepoint/permissions";

import TrainingAlertsClient from "./TrainingAlertsClient";

export default async function TrainingAlertsPage() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) redirect("/unauthorized");

  if (!hasAnyServerPermission(resolved.context, TRAINING_ALERTS_MODULE_PERMISSIONS)) {
    redirect("/unauthorized?from=/training-alerts");
  }

  return <TrainingAlertsClient />;
}
