import { NextResponse } from "next/server";
import { DocxFormError } from "@/lib/agency-documents/docx-forms";
import { PdfInspectionError } from "@/lib/agency-documents/pdf-form-inspector";
import { planAutomaticSetup } from "@/lib/agency-documents/proposal-review";
import { reuseIdsByLocator } from "@/lib/agency-documents/field-persistence";
import { structuredSectionKey } from "@/lib/agency-documents/structured-binding-builder-state";
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
  const existing = await admin.from("document_template_fields").select("id,formatting").eq("department_id", departmentId).eq("template_version_id", version.data.id);
  if (existing.error) return NextResponse.json({ error: "Existing fields could not be checked." }, { status: 500 });
  if ((existing.data ?? []).length && body.replace !== true) return NextResponse.json({ error: "This template already has fields. Confirm that you want to replace them.", existingFields: existing.data!.length }, { status: 409 });

  try {
    const { bytes, format } = await loadTemplateSource(admin, departmentId, template.data.source_storage_path);
    const learned = await loadLearnedMappings(admin, departmentId, templateId);
    const analysis = await analyzeTemplateSource(bytes, format, learned);
    const plan = planAutomaticSetup(analysis.proposals);
    // Fields that point at the same place in the form keep their ids (stable references); all rows are written
    // in one upsert, then fields with no counterpart are removed. A failure leaves the previous fields in place.
    const reuse = reuseIdsByLocator(plan.rows, (existing.data ?? []) as { id: string; formatting: Record<string, unknown> | null }[]);
    if (reuse.rows.length) {
      const saved = await admin.from("document_template_fields").upsert(reuse.rows.map((row) => ({ ...row, department_id: departmentId, template_version_id: version.data.id, updated_at: new Date().toISOString() })), { onConflict: "id" });
      if (saved.error) throw new Error("Fields could not be saved. Your template was not changed.");
    }
    if (reuse.staleIds.length) {
      const deleted = await admin.from("document_template_fields").delete().eq("department_id", departmentId).eq("template_version_id", version.data.id).in("id", reuse.staleIds);
      if (deleted.error) throw new Error("Old fields could not be removed. Refresh and run setup again.");
    }
    // Keep repeating sections (and skipped items) as reviewable suggestions. Sections that are already bound keep
    // their suggestion row, because the binding refers to it; new detections of the same section are not duplicated.
    const previousProposals = await admin.from("document_template_analysis_proposals").select("id,proposal").eq("department_id", departmentId).eq("template_id", templateId);
    const bindingRows = await admin.from("document_template_structured_bindings").select("section_key").eq("department_id", departmentId).eq("template_version_id", version.data.id);
    const boundKeys = new Set((bindingRows.data ?? []).map((row: { section_key: string }) => row.section_key));
    const kept = ((previousProposals.data ?? []) as { id: string; proposal: { page?: number; detectedLabel?: string } }[]).filter((row) => boundKeys.has(structuredSectionKey(row.id)));
    const keptIds = kept.map((row) => row.id);
    let clear = admin.from("document_template_analysis_proposals").delete().eq("department_id", departmentId).eq("template_id", templateId);
    if (keptIds.length) clear = clear.not("id", "in", `(${keptIds.join(",")})`);
    const cleared = await clear;
    if (cleared.error) throw new Error("Previous suggestions could not be replaced.");
    const keptSections = new Set(kept.map((row) => `${row.proposal.page}:${row.proposal.detectedLabel}`));
    const leftover = [...plan.structured.filter((proposal) => !keptSections.has(`${proposal.page}:${proposal.detectedLabel}`)), ...plan.skipped];
    if (leftover.length) await admin.from("document_template_analysis_proposals").insert(leftover.map((proposal) => ({ department_id: departmentId, template_id: templateId, proposal })));
    await admin.from("document_templates").update({ analysis_status: "analyzed", analysis_version: analysis.version, updated_at: new Date().toISOString(), updated_by_user_id: userId }).eq("id", templateId).eq("department_id", departmentId);
    await admin.from("audit_events").insert({ department_id: departmentId, actor_user_id: userId, action: "document_template_auto_setup", entity_type: "document_template", entity_id: templateId, summary: "Set up document template fields automatically.", new_value: { format, provider: analysis.provider, ...plan.summary } });
    return NextResponse.json({ format, provider: analysis.provider, summary: plan.summary });
  } catch (error) {
    const readable = error instanceof PdfInspectionError || error instanceof DocxFormError || error instanceof TemplateSourceError || error instanceof Error;
    return NextResponse.json({ error: readable ? (error as Error).message : "Automatic setup failed." }, { status: error instanceof TemplateSourceError ? error.status : 422 });
  }
}
