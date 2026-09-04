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
  let drillName = "Drill";
  let confirmedWorkspace: Record<string, unknown> | null = null;

  if (result.ok) {
    drillName = result.drillName;
    const updated = await admin.from("pilot_range_workspaces").update({
      workspace: result.workspace,
      updated_by_user_id: user.id,
      updated_at: new Date().toISOString(),
    }).eq("department_id", departmentId).select("workspace").maybeSingle();
    if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 });
    if (!updated.data) return NextResponse.json({ error: "The range workspace changed before the drill could be removed. Reload and try again." }, { status: 409 });
    confirmedWorkspace = updated.data.workspace as Record<string, unknown>;
  } else if (result.status === 409) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  } else {
    // Newer agencies may persist the assignment relationally rather than in the
    // legacy JSON workspace. The supplied ID must be the range_day_drills ID,
    // never the drill-library/template ID.
    const [dayQuery, drillQuery] = await Promise.all([
      admin.from("range_days").select("id,status,packet_status").eq("id", rangeDayId)
        .eq("department_id", departmentId).maybeSingle(),
      admin.from("range_day_drills").select("id,name,range_day_id").eq("id", drillId)
        .eq("range_day_id", rangeDayId).eq("department_id", departmentId).maybeSingle(),
    ]);
    const queryError = dayQuery.error ?? drillQuery.error;
    if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 });
    if (!dayQuery.data) return NextResponse.json({ error: "Range day was not found in your agency." }, { status: 404 });
    if (!drillQuery.data) return NextResponse.json({ error: "Drill assignment was not found on this range day. Reload and try again." }, { status: 404 });

    const status = String(dayQuery.data.status ?? "").toLowerCase();
    const packetStatus = String(dayQuery.data.packet_status ?? "").toLowerCase();
    if (["completed", "locked", "archived"].includes(status) || packetStatus === "ready") {
      return NextResponse.json({ error: "This drill cannot be removed because the range day or packet is finalized or locked. Historical records must remain unchanged." }, { status: 409 });
    }

    const dependencies = await admin.from("drill_run_results").select("id", { count: "exact", head: true })
      .eq("department_id", departmentId).eq("range_day_id", rangeDayId).eq("range_day_drill_id", drillId);
    if (dependencies.error) return NextResponse.json({ error: dependencies.error.message }, { status: 500 });
    if ((dependencies.count ?? 0) > 0) {
      return NextResponse.json({ error: "This drill has saved scores, qualification results, malfunctions, or other dependent records and cannot be removed. Preserve it for audit history." }, { status: 409 });
    }

    const deleted = await admin.from("range_day_drills").delete().eq("id", drillId)
      .eq("range_day_id", rangeDayId).eq("department_id", departmentId).select("id,name").maybeSingle();
    if (deleted.error) return NextResponse.json({ error: deleted.error.message }, { status: deleted.error.code === "23503" || deleted.error.code === "23514" ? 409 : 500 });
    if (!deleted.data) return NextResponse.json({ error: "Drill assignment was not found on this range day." }, { status: 404 });
    drillName = String(deleted.data.name ?? "Drill");
  }

  await admin.from("audit_events").insert({
    department_id: departmentId,
    actor_user_id: user.id,
    action: "delete",
    entity_type: "range_day_drill",
    summary: `Removed ${drillName} from an editable range day.`,
    previous_value: { range_day_id: rangeDayId, range_day_drill_id: drillId, drill_name: drillName },
    new_value: null,
  });
  return NextResponse.json({ ok: true, workspace: confirmedWorkspace, removedRangeDayDrillId: drillId });
}
