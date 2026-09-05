import { NextResponse } from "next/server";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type Context = { params: Promise<{ documentId: string }> };

export async function DELETE(_request: Request, routeContext: Context) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  if (!hasAnyServerPermission(resolved.context, ["manage_range_days"])) {
    return permissionDeniedResponse("Range administration permission is required to delete drill documents.");
  }
  const { documentId } = await routeContext.params;
  const { admin, departmentId, userId } = resolved.context;
  const existing = await admin.from("drill_documents")
    .select("id,drill_template_id,original_filename,storage_path")
    .eq("id", documentId).eq("department_id", departmentId).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if (!existing.data) return NextResponse.json({ error: "Drill document not found." }, { status: 404 });
  const path = attachmentPathFromMetadata(existing.data.storage_path, departmentId);
  if (!path) return NextResponse.json({ error: "Drill document not found." }, { status: 404 });
  const removed = await createObjectStore(admin, departmentId).removeAttachment(path);
  if (removed.error) return NextResponse.json({ error: removed.error.message }, { status: 500 });
  const deleted = await admin.from("drill_documents").delete()
    .eq("id", documentId).eq("department_id", departmentId);
  if (deleted.error) return NextResponse.json({ error: deleted.error.message, objectRemoved: true }, { status: 500 });
  await admin.from("audit_events").insert({
    department_id: departmentId, actor_user_id: userId, action: "drill_document_deleted",
    entity_type: "drill_document", entity_id: documentId,
    summary: `Deleted ${existing.data.original_filename} from Drill Library record ${existing.data.drill_template_id}.`,
    new_value: { drill_template_id: existing.data.drill_template_id, document_id: documentId, file_name: existing.data.original_filename },
  });
  return NextResponse.json({ ok: true });
}
