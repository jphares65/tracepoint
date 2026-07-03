import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import TrainingAlertsClient from "./TrainingAlertsClient";

const TRAINING_ALERT_PERMISSION_CODES = [
  "view_training_alerts",
  "manage_training_alerts",
  "create_remediations",
  "manage_remediations",
  "resolve_remediations",
  "view_command_training_alerts",
  "view_command_dashboard",
  "administer_department",
];

async function userCanAccessTrainingAlerts() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/login");
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("department_memberships")
    .select("department_id")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (membershipsError || !memberships?.length) {
    return false;
  }

  for (const membership of memberships) {
    for (const permissionCode of TRAINING_ALERT_PERMISSION_CODES) {
      const { data: allowed, error } = await (supabase as any).rpc(
        "has_department_permission",
        {
          p_department_id: membership.department_id,
          p_permission_code: permissionCode,
        },
      );

      if (!error && allowed) {
        return true;
      }
    }
  }

  return false;
}

export default async function TrainingAlertsPage() {
  const allowed = await userCanAccessTrainingAlerts();

  if (!allowed) {
    redirect("/unauthorized");
  }

  return <TrainingAlertsClient />;
}
