import { NextResponse } from "next/server";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { createEvidenceReadRepository } from "@/lib/evidence/read-repository";

type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function GET(_request: Request, routeContext: RouteContext) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const { attachmentId } = await routeContext.params;
  const { admin, departmentId } = resolved.context;
  try {
  const row = await createEvidenceReadRepository(admin, departmentId).getAttachment(departmentId, attachmentId);
  if (!row) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  let authorized = String(row.uploaded_by_user_id ?? "") === resolved.context.userId;
  if (row.entity_type === "firearm") {
    authorized ||= hasAnyServerPermission(resolved.context, ["manage_firearms", "manage_inspections"]);
    if (!authorized && row.entity_id) {
      const assignment = await admin.from("firearm_assignments").select("id")
        .eq("department_id", departmentId).eq("firearm_id", row.entity_id)
        .eq("assigned_to_user_id", resolved.context.userId).is("returned_at", null).maybeSingle();
      authorized = Boolean(assignment.data);
    }
  } else if (row.entity_type === "qualification") {
    authorized ||= hasAnyServerPermission(resolved.context, ["manage_qualifications", "manage_range_days", "score_range_days", "view_analytics"]);
    if (!authorized && row.entity_key) {
      const workspace = await admin.from("pilot_range_workspaces").select("workspace")
        .eq("department_id", departmentId).maybeSingle();
      const results = Array.isArray(workspace.data?.workspace?.results) ? workspace.data.workspace.results : [];
      authorized = results.some((result: Record<string, unknown>) => String(result.id ?? "") === String(row.entity_key) && String(result.officerUserId ?? result.officer_user_id ?? "") === resolved.context.userId);
    }
  } else if (row.entity_type === "agency_training_event") {
    authorized = true;
  }
  if (!authorized) return permissionDeniedResponse("You do not have permission to download this attachment.");
  const storagePath = attachmentPathFromMetadata(
    row.storage_path,
    departmentId,
  );
  if (!storagePath) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }
  const objectStore = await createObjectStore(admin, departmentId);
  const signed = await objectStore.createAttachmentDownload(
    storagePath,
    row.file_name,
  );
  if (signed.error || !signed.signedUrl) return NextResponse.json({ error: "Download could not be created." }, { status: 500 });
  return NextResponse.redirect(signed.signedUrl);
  } catch (error) { console.error("Attachment download failed", error); return NextResponse.json({ error: "Download could not be created." }, { status: 500 }); }
}
