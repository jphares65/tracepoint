import { NextResponse } from "next/server";
import { renderDocxTemplateProof, renderTemplateProof, toFieldSpec, type StoredTemplateField } from "@/lib/agency-documents/document-generation";
import { inspectPdf, PdfInspectionError } from "@/lib/agency-documents/pdf-form-inspector";
import { loadTemplateSource, TemplateSourceError } from "@/lib/agency-documents/template-service";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ templateId: string }> };

/**
 * Placement proof for template configuration. PDFs: the real PDF with every
 * field outlined and filled with a worst-case-length sample value (?format=json
 * returns only the fit report). Word: the document content with samples in place.
 */
export async function GET(request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["manage_document_templates"])) return permissionDeniedResponse("Template-management permission is required.");
  const { admin, departmentId } = access.context;
  const { templateId } = await route.params;
  const wantsJson = new URL(request.url).searchParams.get("format") === "json";
  const template = await admin.from("document_templates").select("current_version,source_storage_path").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error || !template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  const version = await admin.from("document_template_versions").select("id").eq("department_id", departmentId).eq("template_id", templateId).eq("version_number", template.data.current_version).single();
  if (version.error) return NextResponse.json({ error: "The template version could not be loaded." }, { status: 500 });
  const rows = await admin.from("document_template_fields").select("id,page_number,field_type,canonical_key,label,static_text,is_required,geometry,formatting").eq("department_id", departmentId).eq("template_version_id", version.data.id);
  if (rows.error) return NextResponse.json({ error: "Template fields could not be loaded." }, { status: 500 });
  const fields = ((rows.data ?? []) as StoredTemplateField[]).map(toFieldSpec);
  try {
    const { bytes, format } = await loadTemplateSource(admin, departmentId, template.data.source_storage_path);
    if (format === "docx") {
      const proof = renderDocxTemplateProof(bytes, fields);
      return NextResponse.json({ format, html: proof.html, issues: proof.issues }, { headers: { "Cache-Control": "no-store" } });
    }
    const proof = await renderTemplateProof(bytes, fields);
    if (wantsJson) {
      const inspection = await inspectPdf(bytes);
      return NextResponse.json({ format, issues: proof.issues, pages: inspection.pages.map((page) => ({ page: page.page, width: page.displayWidth, height: page.displayHeight })) }, { headers: { "Cache-Control": "no-store" } });
    }
    return new NextResponse(proof.bytes as unknown as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline; filename=\"template-proof.pdf\"", "Cache-Control": "no-store", "X-TracePoint-Issues": String(proof.issues.length) } });
  } catch (error) {
    const message = error instanceof PdfInspectionError || error instanceof TemplateSourceError ? error.message : "The proof could not be rendered.";
    return NextResponse.json({ error: message }, { status: error instanceof TemplateSourceError ? error.status : 422 });
  }
}
