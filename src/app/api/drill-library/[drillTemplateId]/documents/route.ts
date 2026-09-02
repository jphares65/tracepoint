import { NextRequest, NextResponse } from "next/server";
import { createObjectStore } from "@/lib/storage/object-store";
import { validateDrillDocumentFile, workspaceHasDrillTemplate } from "@/lib/tracepoint/drill-documents-core";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";
import { createEvidenceReadRepository } from "@/lib/evidence/read-repository";

type Context = { params: Promise<{ drillTemplateId: string }> };

// The shared access context intentionally exposes its provider client as `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function verifyTemplate(admin: any, departmentId: string, drillTemplateId: string) {
  if (!/^[a-zA-Z0-9._:-]{1,255}$/.test(drillTemplateId)) {
    return { error: null, found: false };
  }
  const result = await admin.from("pilot_range_workspaces").select("workspace")
    .eq("department_id", departmentId).maybeSingle();
  if (result.error) return { error: result.error.message, found: false };
  return { error: null, found: workspaceHasDrillTemplate(result.data?.workspace, drillTemplateId) };
}

export async function GET(_request: NextRequest, routeContext: Context) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  const { drillTemplateId } = await routeContext.params;
  const { admin, departmentId } = resolved.context;
  const repository = createEvidenceReadRepository(admin, departmentId);
  try {
  if (!(await repository.drillTemplateExists(departmentId, drillTemplateId))) return NextResponse.json({ error: "Drill Library record not found." }, { status: 404 });
  const documents = await repository.listDrillDocuments(departmentId, drillTemplateId);
  return NextResponse.json({ documents, canManage: hasAnyServerPermission(resolved.context, ["manage_range_days"]) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Drill documents could not be loaded." }, { status: 500 }); }
}

export async function POST(request: NextRequest, routeContext: Context) {
  const resolved = await resolveServerAccess();
  if (!resolved.ok) return accessFailureResponse(resolved);
  if (!hasAnyServerPermission(resolved.context, ["manage_range_days"])) {
    return permissionDeniedResponse("Range administration permission is required to upload drill documents.");
  }
  const { drillTemplateId } = await routeContext.params;
  const { admin, departmentId, userId } = resolved.context;
  const template = await verifyTemplate(admin, departmentId, drillTemplateId);
  if (template.error) return NextResponse.json({ error: template.error }, { status: 500 });
  if (!template.found) return NextResponse.json({ error: "Drill Library record not found." }, { status: 404 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  const validationError = validateDrillDocumentFile(file);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const documentId = crypto.randomUUID();
  const objectStore = createObjectStore(admin);
  const upload = await objectStore.uploadDrillDocument({
    departmentId, recordId: drillTemplateId, objectId: documentId,
    fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type,
  });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
  const inserted = await admin.from("drill_documents").insert({
    id: documentId, department_id: departmentId, drill_template_id: drillTemplateId,
    original_filename: file.name, storage_path: upload.path, mime_type: file.type,
    file_size: file.size, uploaded_by_user_id: userId,
  }).select("id,drill_template_id,original_filename,mime_type,file_size,uploaded_by_user_id,created_at").single();
  if (inserted.error) {
    await objectStore.removeAttachment(upload.path);
    return NextResponse.json({ error: inserted.error.message }, { status: 500 });
  }
  await admin.from("audit_events").insert({
    department_id: departmentId, actor_user_id: userId, action: "drill_document_uploaded",
    entity_type: "drill_document", entity_id: documentId,
    summary: `Uploaded ${file.name} to Drill Library record ${drillTemplateId}.`,
    new_value: { drill_template_id: drillTemplateId, document_id: documentId, file_name: file.name, file_size: file.size },
  });
  return NextResponse.json({ document: inserted.data }, { status: 201 });
}
