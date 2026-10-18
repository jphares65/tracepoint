import { NextResponse } from "next/server";
import { DocxFormError } from "@/lib/agency-documents/docx-forms";
import { PdfInspectionError } from "@/lib/agency-documents/pdf-form-inspector";
import { analyzeTemplateSource, loadLearnedMappings, loadTemplateSource, TemplateSourceError } from "@/lib/agency-documents/template-service";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ templateId: string }> };

export async function POST(_request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["manage_document_templates"])) return permissionDeniedResponse("Template-management permission is required.");
  const { admin, departmentId, userId } = access.context;
  const { templateId } = await route.params;
  const template = await admin.from("document_templates").select("source_storage_path,status").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error || !template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  // Re-analyzing would add new open suggestions (and repeating sections) to a template people generate from.
  if (template.data.status === "published") return NextResponse.json({ error: "Unpublish this template before analyzing it again." }, { status: 409 });
  const marking = await admin.from("document_templates").update({ analysis_status: "analyzing" }).eq("id", templateId).eq("department_id", departmentId);
  if (marking.error) return NextResponse.json({ error: "Analysis status could not be updated." }, { status: 500 });
  try {
    const { bytes, format } = await loadTemplateSource(admin, departmentId, template.data.source_storage_path);
    const learned = await loadLearnedMappings(admin, departmentId, templateId);
    const result = await analyzeTemplateSource(bytes, format, learned);
    const cleared = await admin.from("document_template_analysis_proposals").delete().eq("department_id", departmentId).eq("template_id", templateId);
    if (cleared.error) throw new Error("Existing suggestions could not be replaced.");
    if (result.proposals.length) {
      const inserted = await admin.from("document_template_analysis_proposals").insert(result.proposals.map((proposal) => ({ department_id: departmentId, template_id: templateId, proposal })));
      if (inserted.error) throw new Error("Suggestions could not be saved.");
    }
    const analyzed = await admin.from("document_templates").update({ analysis_status: "analyzed", analysis_version: result.version }).eq("id", templateId).eq("department_id", departmentId);
    if (analyzed.error) throw new Error("Analysis status could not be saved.");
    await admin.from("audit_events").insert({ department_id: departmentId, actor_user_id: userId, action: "document_template_analyzed", entity_type: "document_template", entity_id: templateId, summary: "Analyzed a blank document form.", new_value: { provider: result.provider, proposal_count: result.proposals.length, learned_mappings: learned.length } });
    return NextResponse.json({ ...result, format });
  } catch (error) {
    await admin.from("document_templates").update({ analysis_status: "failed" }).eq("id", templateId).eq("department_id", departmentId);
    const readable = error instanceof PdfInspectionError || error instanceof DocxFormError || error instanceof TemplateSourceError;
    return NextResponse.json({ error: readable ? (error as Error).message : "TracePoint couldn't confidently identify fields in this document. You can continue building the template manually." }, { status: error instanceof TemplateSourceError ? error.status : 422 });
  }
}
