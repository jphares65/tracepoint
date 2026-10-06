import { NextResponse } from "next/server";
import { getDocumentField } from "@/lib/agency-documents/field-registry";
import { resolveGenerationContext } from "@/lib/agency-documents/generation-context";
import { renderAgencyDocument } from "@/lib/agency-documents/pdf-renderer";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

type StoredField = { page_number: number; field_type: string; canonical_key: string | null; label: string | null; static_text: string | null; geometry: { x: number; y: number; width: number; height: number }; formatting: { fontSize?: number; bold?: boolean; align?: "left" | "center" | "right"; autoFit?: boolean } | null };
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function fieldValue(field: StoredField, manual: Record<string, string>, access: { fullName: string; badgeNumber: string; rankTitle: string; email: string; departmentName: string; departmentShortName: string }) {
  if (field.field_type === "static_text") return field.static_text ?? "";
  if (field.field_type === "generated_date") return new Date().toLocaleDateString("en-US");
  if (field.field_type === "manual") return manual[field.label ?? ""] ?? "";
  switch (field.canonical_key) {
    case "person.full_name": return access.fullName; case "person.first_name": return access.fullName.split(/\s+/)[0] ?? ""; case "person.last_name": return access.fullName.split(/\s+/).at(-1) ?? "";
    case "person.badge_number": return access.badgeNumber; case "person.rank": return access.rankTitle; case "person.email": return access.email;
    case "agency.name": return access.departmentName; case "agency.short_name": return access.departmentShortName;
    default: return manual[field.canonical_key ?? ""] ?? "";
  }
}

export async function POST(request: Request) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["generate_agency_documents", "manage_document_templates"])) return permissionDeniedResponse("Document-generation permission is required.");
  const body = await request.json().catch(() => ({})) as { templateId?: unknown; values?: unknown; preview?: unknown; context?: { personId?: string; firearmId?: string; qualificationId?: string } };
  const templateId = text(body.templateId); const values = typeof body.values === "object" && body.values ? body.values as Record<string, string> : {};
  if (!templateId) return NextResponse.json({ error: "A template is required." }, { status: 400 });
  const template = await access.context.admin.from("document_templates").select("id,name,status,current_version").eq("id", templateId).eq("department_id", access.context.departmentId).maybeSingle();
  if (template.error) return NextResponse.json({ error: template.error.message }, { status: 500 }); if (!template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  if (template.data.status !== "published" && !hasAnyServerPermission(access.context, ["manage_document_templates"])) return NextResponse.json({ error: "Only published templates can be generated." }, { status: 409 });
  const version = await access.context.admin.from("document_template_versions").select("id,source_filename,source_storage_path").eq("department_id", access.context.departmentId).eq("template_id", templateId).eq("version_number", template.data.current_version).single();
  if (version.error) return NextResponse.json({ error: version.error.message }, { status: 500 });
  const fields = await access.context.admin.from("document_template_fields").select("page_number,field_type,canonical_key,label,static_text,geometry,formatting").eq("department_id", access.context.departmentId).eq("template_version_id", version.data.id);
  if (fields.error) return NextResponse.json({ error: fields.error.message }, { status: 500 });
  let contextValues: Record<string, string> = {}; let references: Record<string, string> = {};
  try { const context = await resolveGenerationContext(access.context.admin, access.context.departmentId, body.context ?? {}); contextValues = context.values; references = context.references; } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Selected context is unavailable." }, { status: 409 }); }
  const sourcePath = attachmentPathFromMetadata(version.data.source_storage_path, access.context.departmentId); if (!sourcePath) return NextResponse.json({ error: "Template source is unavailable." }, { status: 404 });
  const signed = await createObjectStore(access.context.admin, access.context.departmentId).createAttachmentView(sourcePath); if (signed.error || !signed.signedUrl) return NextResponse.json({ error: "Template source could not be opened." }, { status: 500 });
  const sourceResponse = await fetch(signed.signedUrl); if (!sourceResponse.ok) return NextResponse.json({ error: "Template source could not be read." }, { status: 502 });
  const resolvedValues = { ...values, ...contextValues };
  const unsupported = (fields.data as StoredField[]).find((field) => field.field_type === "tracepoint_data" && !fieldValue(field, resolvedValues, access.context));
  if (unsupported) return NextResponse.json({ error: "This template uses a data field that is not currently available." }, { status: 409 });
  const rendered = await renderAgencyDocument(new Uint8Array(await sourceResponse.arrayBuffer()), (fields.data as StoredField[]).map((field) => ({ pageNumber: field.page_number, value: fieldValue(field, resolvedValues, access.context), geometry: field.geometry, formatting: field.formatting ?? undefined })));
  const fileName = `${template.data.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "document"}-${new Date().toISOString().slice(0, 10)}.pdf`;
  const pdfBody = rendered as unknown as BodyInit;
  if (body.preview === true) return new NextResponse(pdfBody, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"`, "Cache-Control": "no-store" } });
  const generatedId = crypto.randomUUID(); const upload = await createObjectStore(access.context.admin, access.context.departmentId).uploadGeneratedAgencyDocument({ departmentId: access.context.departmentId, recordId: generatedId, objectId: crypto.randomUUID(), fileName, bytes: rendered, contentType: "application/pdf" });
  if (upload.error) return NextResponse.json({ error: upload.error.message }, { status: 500 });
  const saved = await access.context.admin.from("generated_documents").insert({ id: generatedId, department_id: access.context.departmentId, template_id: template.data.id, template_version_id: version.data.id, generated_by_user_id: access.context.userId, context: { references, manual_fields: Object.keys(values), fieldKeys: (fields.data as StoredField[]).map((field) => field.canonical_key).filter((key) => key && getDocumentField(key)) }, storage_path: upload.path });
  if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 500 });
  await access.context.admin.from("audit_events").insert({ department_id: access.context.departmentId, actor_user_id: access.context.userId, action: "document_generated", entity_type: "generated_document", entity_id: generatedId, summary: `Generated ${template.data.name}.`, new_value: { template_id: templateId, template_version: template.data.current_version } });
  return new NextResponse(pdfBody, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store", "X-TracePoint-Document-Id": generatedId } });
}
