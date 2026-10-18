import { NextResponse } from "next/server";
import { generateDocument, toFieldSpec, type StoredTemplateField } from "@/lib/agency-documents/document-generation";
import { requiredSelections } from "@/lib/agency-documents/field-values";
import { GenerationContextError, loadGenerationSources, loadPreparer, type GenerationDatabase, type GenerationSelection } from "@/lib/agency-documents/generation-context";
import { DocumentQualificationHistoryRepository } from "@/lib/agency-documents/document-qualification-history";
import { PdfInspectionError } from "@/lib/agency-documents/pdf-form-inspector";
import { resolveDocumentStructuredBindings, type DocumentStructuredBinding } from "@/lib/agency-documents/structured-document-resolution";
import { attachmentPathFromMetadata, createObjectStore } from "@/lib/storage/object-store";
import { accessFailureResponse, hasAnyServerPermission, permissionDeniedResponse, resolveServerAccess } from "@/lib/tracepoint/server-access";

export const runtime = "nodejs";

type Mode = "review" | "preview" | "proof" | "final";
type Body = {
  templateId?: unknown; mode?: unknown; context?: GenerationSelection; reportYear?: unknown;
  entered?: Record<string, unknown>; leaveBlank?: unknown;
  /** Legacy request shape (pre-review screen). */
  preview?: unknown; values?: Record<string, unknown>;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function stringRecord(value: unknown) {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) if (typeof entry === "string" || typeof entry === "number") out[key] = String(entry);
  return out;
}

export async function POST(request: Request) {
  const access = await resolveServerAccess(); if (!access.ok) return accessFailureResponse(access);
  if (!hasAnyServerPermission(access.context, ["generate_agency_documents", "manage_document_templates"])) return permissionDeniedResponse("Document-generation permission is required.");
  const { admin, departmentId, userId } = access.context;
  const body = await request.json().catch(() => ({})) as Body;
  const templateId = text(body.templateId);
  const mode: Mode = body.mode === "review" || body.mode === "preview" || body.mode === "proof" || body.mode === "final" ? body.mode : body.preview === true ? "preview" : "final";
  if (!templateId) return json({ error: "A template is required." }, 400);

  const template = await admin.from("document_templates").select("id,name,status,current_version").eq("id", templateId).eq("department_id", departmentId).maybeSingle();
  if (template.error) return json({ error: "The template could not be loaded." }, 500);
  if (!template.data) return json({ error: "Template not found." }, 404);
  const canManage = hasAnyServerPermission(access.context, ["manage_document_templates"]);
  if (template.data.status !== "published" && !(canManage && mode !== "final")) return json({ error: "Only published templates can be used to generate official documents." }, 409);

  const version = await admin.from("document_template_versions").select("id,source_filename,source_storage_path").eq("department_id", departmentId).eq("template_id", templateId).eq("version_number", template.data.current_version).single();
  if (version.error) return json({ error: "The template version could not be loaded." }, 500);
  const fieldRows = await admin.from("document_template_fields").select("id,page_number,field_type,canonical_key,label,static_text,is_required,geometry,formatting").eq("department_id", departmentId).eq("template_version_id", version.data.id).order("page_number");
  if (fieldRows.error) return json({ error: "The template fields could not be loaded." }, 500);
  const fields = ((fieldRows.data ?? []) as StoredTemplateField[]).map(toFieldSpec);
  const bindingRows = await admin.from("document_template_structured_bindings").select("id,section_key,source_type,fill_mode,ordering,max_rows,overflow_behavior,filters,column_mappings,target_cells").eq("department_id", departmentId).eq("template_version_id", version.data.id);
  if (bindingRows.error) return json({ error: "Structured bindings could not be loaded." }, 500);
  const bindings = (bindingRows.data ?? []).map((row: Record<string, unknown>) => ({ id: String(row.id), sectionKey: String(row.section_key), sourceType: row.source_type, fillMode: row.fill_mode, ordering: row.ordering, maxRows: row.max_rows, overflowBehavior: row.overflow_behavior, filters: row.filters, columnMappings: row.column_mappings, targetCells: row.target_cells })) as DocumentStructuredBinding[];

  const selections = requiredSelections(fields);
  const needsPersonForBindings = bindings.some((binding) => binding.sourceType === "qualification_history");
  const needsReportYear = selections.reportYear || bindings.some((binding) => binding.filters?.reportYearMode === "document");
  const reportYearNumber = typeof body.reportYear === "number" ? body.reportYear : Number(text(body.reportYear));
  const reportYear = Number.isInteger(reportYearNumber) && reportYearNumber >= 1900 && reportYearNumber <= 2200 ? reportYearNumber : null;
  const selection: GenerationSelection = { personId: text(body.context?.personId) || undefined, firearmId: text(body.context?.firearmId) || undefined, qualificationId: text(body.context?.qualificationId) || undefined };

  let sources;
  try {
    const preparer = await loadPreparer(admin as unknown as GenerationDatabase, departmentId, userId);
    sources = await loadGenerationSources(admin as unknown as GenerationDatabase, departmentId, selection, preparer, { reportYear });
  } catch (error) {
    return json({ error: error instanceof GenerationContextError ? error.message : "The selected records could not be loaded." }, 409);
  }

  // Typed values are keyed by field id. Legacy callers sent values keyed by label; map those onto manual fields by exact label only.
  const entered = stringRecord(body.entered);
  const legacy = stringRecord(body.values);
  for (const field of fields) if (field.fieldType === "manual" && field.label && legacy[field.label] !== undefined && entered[field.id] === undefined) entered[field.id] = legacy[field.label];
  const leaveBlank = Array.isArray(body.leaveBlank) ? body.leaveBlank.filter((id): id is string => typeof id === "string") : [];

  let structured = { fields: [] as Array<{ pageNumber: number; value: string; geometry: { x: number; y: number; width: number; height: number }; formatting: { align: "center"; autoFit: true; fontSize: number } }>, warnings: [] as string[], requiresReview: false, bindingIds: [] as string[] };
  const structuredBlockers: string[] = [];
  if (needsPersonForBindings && !selection.personId) structuredBlockers.push("Select an officer to fill the qualification-history sections.");
  if (needsReportYear && !reportYear) structuredBlockers.push("Enter the report year for this document.");
  if (needsPersonForBindings && selection.personId) {
    try {
      const qualifications = await new DocumentQualificationHistoryRepository(admin, departmentId).getQualificationHistoryForDocumentContext({ personId: selection.personId });
      structured = resolveDocumentStructuredBindings(bindings, qualifications, reportYear ?? undefined);
    } catch {
      return json({ error: "Qualification history could not be loaded for the selected officer." }, 409);
    }
  }
  if (structured.requiresReview) structuredBlockers.push(...structured.warnings);

  const sourcePath = attachmentPathFromMetadata(version.data.source_storage_path, departmentId);
  if (!sourcePath) return json({ error: "The template's PDF is unavailable." }, 404);
  const signed = await createObjectStore(admin, departmentId).createAttachmentView(sourcePath);
  if (signed.error || !signed.signedUrl) return json({ error: "The template's PDF could not be opened." }, 500);
  const sourceResponse = await fetch(signed.signedUrl);
  if (!sourceResponse.ok) return json({ error: "The template's PDF could not be read." }, 502);
  const sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer());

  let outcome;
  try {
    outcome = await generateDocument(sourceBytes, fields, sources, { entered, leaveBlank, mode: mode === "proof" ? "proof" : "final", extra: structured.fields });
  } catch (error) {
    return json({ error: error instanceof PdfInspectionError ? error.message : "The document could not be rendered." }, 422);
  }
  const ready = outcome.ready && structuredBlockers.length === 0;
  const summary = {
    ready,
    selections: { ...selections, person: selections.person || needsPersonForBindings, reportYear: needsReportYear },
    fields: outcome.resolution.fields.map((resolution) => {
      const field = fields.find((item) => item.id === resolution.fieldId)!;
      return { ...resolution, fieldType: field.fieldType, required: field.required === true, page: field.pageNumber, options: Array.isArray(field.formatting?.options) ? field.formatting?.options : undefined, inputKind: field.formatting?.acroFieldKind === "checkbox" ? "checkbox" : field.formatting?.multiline ? "multiline" : "text" };
    }),
    missing: outcome.resolution.missing.map((item) => ({ fieldId: item.fieldId, label: item.label, detail: item.detail })),
    issues: outcome.issues,
    structuredBlockers,
    structuredWarnings: structured.warnings,
  };
  if (mode === "review") return json(summary);

  const fileName = `${template.data.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "document"}-${sources.today}.pdf`;
  const pdfBody = outcome.bytes as unknown as BodyInit;
  const statusHeaders = { "X-TracePoint-Ready": String(ready), "X-TracePoint-Missing": String(summary.missing.length), "X-TracePoint-Issues": String(summary.issues.length), ...(structured.warnings.length ? { "X-TracePoint-Structured-Warnings": String(structured.warnings.length) } : {}) };
  if (mode === "preview" || mode === "proof") return new NextResponse(pdfBody, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="preview-${fileName}"`, "Cache-Control": "no-store", ...statusHeaders } });

  if (!ready) return json({ error: "The document is not complete yet. Resolve the items listed before generating.", ...summary }, 409);
  const generatedId = crypto.randomUUID();
  const upload = await createObjectStore(admin, departmentId).uploadGeneratedAgencyDocument({ departmentId, recordId: generatedId, objectId: crypto.randomUUID(), fileName, bytes: outcome.bytes, contentType: "application/pdf" });
  if (upload.error) return json({ error: "The completed document could not be saved." }, 500);
  const references = Object.fromEntries(Object.entries({ person_id: sources.person?.id, firearm_id: sources.firearm?.id, qualification_id: sources.qualification?.id }).filter(([, value]) => value));
  const saved = await admin.from("generated_documents").insert({
    id: generatedId, department_id: departmentId, template_id: template.data.id, template_version_id: version.data.id, generated_by_user_id: userId, storage_path: upload.path,
    // Field provenance only — typed values themselves are kept in the PDF, not duplicated into the audit context.
    context: { references, report_year: reportYear ?? undefined, structured_binding_ids: structured.bindingIds, field_sources: summary.fields.map((field) => ({ field_id: field.fieldId, status: field.status, key: field.canonicalKey })) },
  });
  if (saved.error) return json({ error: "The completed document could not be recorded." }, 500);
  await admin.from("audit_events").insert({ department_id: departmentId, actor_user_id: userId, action: "document_generated", entity_type: "generated_document", entity_id: generatedId, summary: `Generated ${template.data.name}.`, new_value: { template_id: templateId, template_version: template.data.current_version, typed_fields: outcome.resolution.typed.length } });
  return new NextResponse(pdfBody, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store", "X-TracePoint-Document-Id": generatedId } });
}
