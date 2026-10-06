import { NextResponse } from "next/server";
import { createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

const MANAGE = ["manage_document_templates"] as const;
const VIEW = ["view_agency_documents", "generate_agency_documents", "manage_document_templates"] as const;

function failure(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }

export async function GET() {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, VIEW)) return permissionDeniedResponse("Agency Documents access is required.");
  const result = await access.context.admin.from("document_templates")
    .select("id,name,description,category,status,current_version,source_filename,updated_at,created_at")
    .eq("department_id", access.context.departmentId).order("updated_at", { ascending: false });
  if (result.error) return failure(result.error.message, 500);
  return NextResponse.json({ templates: result.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await resolveServerAccess();
  if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, MANAGE)) return permissionDeniedResponse("Template-management permission is required.");
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const description = String(form.get("description") ?? "").trim() || null;
  const category = String(form.get("category") ?? "").trim() || null;
  const file = form.get("file");
  if (!name) return failure("Template name is required.");
  if (!(file instanceof File) || file.type !== "application/pdf") return failure("Please choose a PDF document.");
  if (file.size > 25 * 1024 * 1024) return failure("PDFs must be 25 MB or smaller.");
  const templateId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const uploaded = await createObjectStore(access.context.admin, access.context.departmentId).uploadDocumentTemplateSource({
    departmentId: access.context.departmentId, recordId: templateId, objectId: sourceId, fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), contentType: "application/pdf",
  });
  if (uploaded.error) return failure(uploaded.error.message, 500);
  const template = await access.context.admin.from("document_templates").insert({
    id: templateId, department_id: access.context.departmentId, name, description, category, status: "draft", current_version: 1,
    source_filename: file.name, source_storage_path: uploaded.path, created_by_user_id: access.context.userId, updated_by_user_id: access.context.userId,
  }).select("id,name,description,category,status,current_version,source_filename,updated_at").single();
  if (template.error) { await createObjectStore(access.context.admin, access.context.departmentId).removeAttachment(uploaded.path); return failure(template.error.message, 500); }
  const version = await access.context.admin.from("document_template_versions").insert({
    department_id: access.context.departmentId, template_id: templateId, version_number: 1, source_filename: file.name, source_storage_path: uploaded.path, created_by_user_id: access.context.userId,
  }).select("id").single();
  if (version.error) return failure(version.error.message, 500);
  await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: "document_template_created", entity_type: "document_template", entity_id: templateId, summary: `Created document template ${name}.`, new_value: { version: 1, source_filename: file.name } });
  return NextResponse.json({ template: template.data, versionId: version.data.id }, { status: 201 });
}
