import { redirect } from "next/navigation";

import {
  hasAnyServerPermission,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

import TrainingAlertsClient from "./TrainingAlertsClient";
import {
  TRAINING_ALERTS_MODULE_PERMISSIONS,
  TRAINING_ALERTS_WORKFLOW_PERMISSIONS,
} from "@/lib/tracepoint/permissions";

export default async function TrainingAlertsPage() {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) redirect("/unauthorized");

  if (!hasAnyServerPermission(resolved.context, TRAINING_ALERTS_MODULE_PERMISSIONS)) {
    redirect("/unauthorized?from=/training-alerts");
  }

  return (
    <TrainingAlertsClient
      canManage={hasAnyServerPermission(
        resolved.context,
        TRAINING_ALERTS_WORKFLOW_PERMISSIONS,
      )}
    />
  );
}
