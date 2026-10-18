import { NextResponse } from "next/server";
import { createObjectStore } from "@/lib/storage/object-store";
import { templateFormat } from "@/lib/agency-documents/document-generation";
import { analyzeDocx, DocxFormError, DOCX_MIME } from "@/lib/agency-documents/docx-forms";
import { loadPdf, PdfInspectionError } from "@/lib/agency-documents/pdf-form-inspector";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
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
  if (!(file instanceof File) || file.size === 0) return failure("Please choose a PDF or Word (.docx) document.");
  if (file.size > 25 * 1024 * 1024) return failure("Documents must be 25 MB or smaller.");
  // The file type is decided by its contents, not the name or browser-reported type.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = templateFormat(bytes);
  if (!format) return failure(/\.doc$/i.test(file.name) ? "Older Word (.doc) files are not supported. Open the file in Word and save it as .docx." : "Please choose a PDF or Word (.docx) document.");
  try {
    if (format === "pdf") await loadPdf(bytes);
    else analyzeDocx(bytes);
  } catch (error) {
    return failure(error instanceof PdfInspectionError || error instanceof DocxFormError ? error.message : "The document could not be read.");
  }
  const contentType = format === "pdf" ? "application/pdf" : DOCX_MIME;
  const templateId = crypto.randomUUID();
  const sourceId = crypto.randomUUID();
  const uploaded = await createObjectStore(access.context.admin, access.context.departmentId).uploadDocumentTemplateSource({
    departmentId: access.context.departmentId, recordId: templateId, objectId: sourceId, fileName: file.name, bytes, contentType,
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
  await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: "document_template_created", entity_type: "document_template", entity_id: templateId, summary: `Created document template ${name}.`, new_value: { version: 1, source_filename: file.name, format } });
  return NextResponse.json({ template: template.data, versionId: version.data.id, format }, { status: 201 });
}
