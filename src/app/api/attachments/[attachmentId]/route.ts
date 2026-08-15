import { NextRequest, NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const context = resolved.context;
  if (!hasAnyServerPermission(context, ["manage_firearms", "manage_qualifications", "manage_inspections", "manage_range_days"])) {
    return permissionDeniedResponse("You do not have permission to archive attachments.");
  }
  const { attachmentId } = await routeContext.params;
  const body = await request.json().catch(() => ({})) as { reason?: string };
  const reason = String(body.reason ?? "Superseded or removed from active record").trim().slice(0, 500);
  const existing = await context.admin.from("attachments").select("id,entity_type,entity_id,file_name")
    .eq("id", attachmentId).eq("department_id", context.departmentId).is("archived_at", null).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  const updated = await context.admin.from("attachments").update({ archived_at: new Date().toISOString(), archived_by_user_id: context.userId, archive_reason: reason })
    .eq("id", attachmentId).eq("department_id", context.departmentId).is("archived_at", null);
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 });
  await context.admin.from("audit_events").insert({ department_id: context.departmentId, actor_user_id: context.userId,
    action: "attachment_archived", entity_type: existing.data.entity_type, entity_id: existing.data.entity_id,
    summary: `Archived attachment ${existing.data.file_name}.`, new_value: { attachment_id: attachmentId, reason } });
  return NextResponse.json({ ok: true });
}
