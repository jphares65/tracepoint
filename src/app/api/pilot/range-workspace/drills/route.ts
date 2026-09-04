import { NextRequest, NextResponse } from "next/server";

import { removeRangeDayDrill } from "@/lib/range/drill-removal";
import {
  accessFailureResponse,
  hasAnyServerPermission,
  requireServerFeature,
  resolveServerAccess,
} from "@/lib/tracepoint/server-access";

export async function DELETE(request: NextRequest) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);

  const featureError = requireServerFeature(resolved.context, "range_training", "Range & Training");
  if (featureError) return featureError;
  if (!hasAnyServerPermission(resolved.context, ["manage_range_days"])) {
    return NextResponse.json({ error: "You do not have permission to manage range days." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const rangeDayId = typeof body.rangeDayId === "string" ? body.rangeDayId.trim() : "";
  const drillId = typeof body.drillId === "string" ? body.drillId.trim() : "";
  if (!rangeDayId || !drillId) {
    return NextResponse.json({ error: "Range day ID and drill ID are required." }, { status: 400 });
  }

  const { admin, departmentId, user } = resolved.context;
  const { data, error } = await admin.from("pilot_range_workspaces")
    .select("workspace").eq("department_id", departmentId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = removeRangeDayDrill(data?.workspace, { rangeDayId, drillId, departmentId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const { error: updateError } = await admin.from("pilot_range_workspaces").update({
    workspace: result.workspace,
    updated_by_user_id: user.id,
    updated_at: new Date().toISOString(),
  }).eq("department_id", departmentId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  await admin.from("audit_events").insert({
    department_id: departmentId,
    actor_user_id: user.id,
    action: "delete",
    entity_type: "range_day_drill",
    summary: `Removed ${result.drillName} from an editable range day.`,
    previous_value: { range_day_id: rangeDayId, drill_id: drillId, drill_name: result.drillName },
    new_value: null,
  });
  return NextResponse.json({ ok: true, workspace: result.workspace });
}
