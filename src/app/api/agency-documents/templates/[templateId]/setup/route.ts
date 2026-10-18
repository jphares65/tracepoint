import { NextResponse } from "next/server";
import { DocxFormError } from "@/lib/agency-documents/docx-forms";
import { PdfInspectionError } from "@/lib/agency-documents/pdf-form-inspector";
import { planAutomaticSetup } from "@/lib/agency-documents/proposal-review";
import { analyzeTemplateSource, loadLearnedMappings, loadTemplateSource, TemplateSourceError } from "@/lib/agency-documents/template-service";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ templateId: string }> };

/**
 * One-click setup. Analyzes the form and creates every field at once:
 * exact matches confirmed, suggestions flagged for review (publishing stays
 * blocked until each is confirmed), unmatched fields asked for at generation,
 * signatures left blank. Refuses to overwrite existing fields unless asked.
 */
export async function POST(request: Request, route: Context) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["manage_document_templates"])) return permissionDeniedResponse("Template-management permission is required.");
  const { admin, departmentId, userId } = access.context;
  const { templateId } = await route.params;
  const body = await request.json().catch(() => ({})) as { replace?: unknown };
  const template = await admin.from("document_templates").select("id,status,current_version,source_storage_path").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error || !template.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  if (template.data.status === "published") return NextResponse.json({ error: "Unpublish the template before setting it up again." }, { status: 409 });
  const version = await admin.from("document_template_versions").select("id").eq("department_id", departmentId).eq("template_id", templateId).eq("version_number", template.data.current_version).single();
  if (version.error) return NextResponse.json({ error: "The template version could not be loaded." }, { status: 500 });
  const existing = await admin.from("document_template_fields").select("id").eq("department_id", departmentId).eq("template_version_id", version.data.id);
  if (existing.error) return NextResponse.json({ error: "Existing fields could not be checked." }, { status: 500 });
  if ((existing.data ?? []).length && body.replace !== true) return NextResponse.json({ error: "This template already has fields. Confirm that you want to replace them.", existingFields: existing.data!.length }, { status: 409 });

  try {
    const { bytes, format } = await loadTemplateSource(admin, departmentId, template.data.source_storage_path);
    const learned = await loadLearnedMappings(admin, departmentId, templateId);
    const analysis = await analyzeTemplateSource(bytes, format, learned);
    const plan = planAutomaticSetup(analysis.proposals);
    // Insert the new fields first and remove the old ones only after that succeeds, so a failure never leaves the template empty.
    const oldIds = (existing.data ?? []).map((row: { id: string }) => row.id);
    if (plan.rows.length) {
      const inserted = await admin.from("document_template_fields").insert(plan.rows.map((row) => ({ ...row, department_id: departmentId, template_version_id: version.data.id })));
      if (inserted.error) throw new Error("Fields could not be saved. Your template was not changed.");
    }
    if (oldIds.length) {
      const deleted = await admin.from("document_template_fields").delete().eq("department_id", departmentId).in("id", oldIds);
      if (deleted.error) {
        if (plan.rows.length) await admin.from("document_template_fields").delete().eq("department_id", departmentId).in("id", plan.rows.map((row) => row.id));
        throw new Error("Existing fields could not be replaced. Your template was not changed.");
      }
    }
    // Keep repeating sections (and skipped items) as reviewable suggestions for the structured-binding builder.
    await admin.from("document_template_analysis_proposals").delete().eq("department_id", departmentId).eq("template_id", templateId);
    const leftover = [...plan.structured, ...plan.skipped];
    if (leftover.length) await admin.from("document_template_analysis_proposals").insert(leftover.map((proposal) => ({ department_id: departmentId, template_id: templateId, proposal })));
    await admin.from("document_templates").update({ analysis_status: "analyzed", analysis_version: analysis.version, updated_at: new Date().toISOString(), updated_by_user_id: userId }).eq("id", templateId).eq("department_id", departmentId);
    await admin.from("audit_events").insert({ department_id: departmentId, actor_user_id: userId, action: "document_template_auto_setup", entity_type: "document_template", entity_id: templateId, summary: "Set up document template fields automatically.", new_value: { format, provider: analysis.provider, ...plan.summary } });
    return NextResponse.json({ format, provider: analysis.provider, summary: plan.summary });
  } catch (error) {
    const readable = error instanceof PdfInspectionError || error instanceof DocxFormError || error instanceof TemplateSourceError || error instanceof Error;
    return NextResponse.json({ error: readable ? (error as Error).message : "Automatic setup failed." }, { status: error instanceof TemplateSourceError ? error.status : 422 });
  }
}
