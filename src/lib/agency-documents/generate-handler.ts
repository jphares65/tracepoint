import { generateDocument, generateDocxDocument, isCheckboxField, templateFormat, toFieldSpec, type StoredTemplateField } from "./document-generation";
import { DOCX_MIME, DocxFormError } from "./docx-forms";
import { requiredSelections } from "./field-values";
import { GenerationContextError, loadGenerationSources, loadPreparer, type GenerationDatabase, type GenerationSelection } from "./generation-context";
import { DocumentQualificationHistoryRepository } from "./document-qualification-history";
import { PdfInspectionError } from "./pdf-form-inspector";
import { resolveDocumentStructuredBindings, type DocumentStructuredBinding } from "./structured-document-resolution";
import { StructuredLayoutError, StructuredOverflowError } from "./structured-binding";
import { publishBlockers } from "./proposal-review";
import { structuredPublishBlockers } from "./field-persistence";

/**
 * POST /api/agency-documents/generate, written against injected dependencies
 * so the whole request path (tenant checks, selection, value resolution,
 * rendering, saving, audit) is covered by tests without a server or database.
 *
 * Modes: review (JSON of what will be filled), preview / proof (document, not
 * saved), final (saved + audited; refused until everything is complete).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AccessContext = { admin: any; departmentId: string; userId: string };
export type GenerateDeps = {
  resolveAccess(): Promise<{ ok: true; context: AccessContext } | { ok: false; response: Response }>;
  hasPermission(context: AccessContext, permissions: readonly string[]): boolean;
  denied(message: string): Response;
  attachmentPath(stored: string, departmentId: string): string | null;
  store(admin: any, departmentId: string): { createAttachmentView(path: string): Promise<{ signedUrl?: string | null; error?: unknown }>; uploadGeneratedAgencyDocument(input: { departmentId: string; recordId: string; objectId: string; fileName: string; bytes: Uint8Array; contentType: string }): Promise<{ path?: string; error?: unknown }> };
  fetch?: (url: string) => Promise<Response>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

type Mode = "review" | "preview" | "proof" | "final";
type Body = {
  templateId?: unknown; mode?: unknown; context?: GenerationSelection; reportYear?: unknown;
  entered?: Record<string, unknown>; leaveBlank?: unknown;
  /** Legacy request shape (pre-review screen). */
  preview?: unknown; values?: Record<string, unknown>;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function stringRecord(value: unknown) {
  const out: Record<string, string> = {};
  if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) if (typeof entry === "string" || typeof entry === "number") out[key] = String(entry);
  return out;
}

export async function handleGenerate(request: Request, deps: GenerateDeps): Promise<Response> {
  const access = await deps.resolveAccess(); if (!access.ok) return access.response;
  const hasAnyServerPermission = deps.hasPermission;
  if (!hasAnyServerPermission(access.context, ["generate_agency_documents", "manage_document_templates"])) return deps.denied("Document-generation permission is required.");
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
    let qualifications;
    try {
      qualifications = await new DocumentQualificationHistoryRepository(admin as never, departmentId).getQualificationHistoryForDocumentContext({ personId: selection.personId });
    } catch {
      return json({ error: "Qualification history could not be loaded for the selected officer." }, 409);
    }
    try {
      structured = resolveDocumentStructuredBindings(bindings, qualifications, reportYear ?? undefined);
    } catch (error) {
      if (error instanceof StructuredLayoutError) return json({ error: `A repeating section on this template is set up so that its records cannot be placed one per row. Ask a template manager to set the section up again. (${error.message})` }, 409);
      if (!(error instanceof StructuredOverflowError)) throw error;
      return json({ error: `This officer has more qualification records than a repeating section can hold, and the section is set to stop rather than leave records out. Ask a template manager to add rows or change the section's overflow setting. (${error.message})` }, 409);
    }
  }
  // A section that cannot hold every record blocks the official document whatever its overflow setting: records are
  // never left out of an issued document (pilot rule: fail closed). Previews still show what fits, with the warning.
  if (structured.requiresReview) structuredBlockers.push(...structured.warnings.map((warning) => `${warning} Ask a template manager to add rows to this section before generating.`));

  const sourcePath = deps.attachmentPath(version.data.source_storage_path, departmentId);
  if (!sourcePath) return json({ error: "The template's PDF is unavailable." }, 404);
  const signed = await deps.store(admin, departmentId).createAttachmentView(sourcePath);
  if (signed.error || !signed.signedUrl) return json({ error: "The template's PDF could not be opened." }, 500);
  const sourceResponse = await (deps.fetch ?? fetch)(signed.signedUrl);
  if (!sourceResponse.ok) return json({ error: "The template's PDF could not be read." }, 502);
  const sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer());

  const format = templateFormat(sourceBytes);
  if (!format) return json({ error: "The template's source file is not a PDF or Word document." }, 422);
  if (format === "docx" && structured.fields.length) return json({ error: "Repeating sections are only supported on PDF templates." }, 422);
  let outcome: { resolution: Awaited<ReturnType<typeof generateDocument>>["resolution"]; issues: Awaited<ReturnType<typeof generateDocument>>["issues"]; bytes: Uint8Array; ready: boolean; previewHtml?: string };
  try {
    outcome = format === "docx"
      ? generateDocxDocument(sourceBytes, fields, sources, { entered, leaveBlank })
      : await generateDocument(sourceBytes, fields, sources, { entered, leaveBlank, mode: mode === "proof" ? "proof" : "final", extra: structured.fields });
  } catch (error) {
    return json({ error: error instanceof PdfInspectionError || error instanceof DocxFormError ? error.message : "The document could not be rendered." }, 422);
  }
  const ready = outcome.ready && structuredBlockers.length === 0;
  const summary = {
    ready,
    format,
    selections: { ...selections, person: selections.person || needsPersonForBindings, reportYear: needsReportYear },
    fields: outcome.resolution.fields.map((resolution) => {
      const field = fields.find((item) => item.id === resolution.fieldId)!;
      return { ...resolution, fieldType: field.fieldType, required: field.required === true, page: field.pageNumber, options: Array.isArray(field.formatting?.options) ? field.formatting?.options : undefined, inputKind: isCheckboxField(field) ? "checkbox" : field.formatting?.multiline ? "multiline" : "text" };
    }),
    missing: outcome.resolution.missing.map((item) => ({ fieldId: item.fieldId, label: item.label, detail: item.detail })),
    issues: outcome.issues,
    structuredBlockers,
    structuredWarnings: structured.warnings,
  };
  if (mode === "review") return json(summary);

  const extension = format === "docx" ? "docx" : "pdf";
  const contentType = format === "docx" ? DOCX_MIME : "application/pdf";
  const fileName = `${template.data.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "document"}-${sources.today}.${extension}`;
  const pdfBody = outcome.bytes as unknown as BodyInit;
  // Word previews are returned as readable HTML of the completed content (Word decides final pagination).
  if (format === "docx" && (mode === "preview" || mode === "proof")) return json({ ...summary, previewHtml: outcome.previewHtml ?? "" });
  const statusHeaders = { "X-TracePoint-Ready": String(ready), "X-TracePoint-Missing": String(summary.missing.length), "X-TracePoint-Issues": String(summary.issues.length), ...(structured.warnings.length ? { "X-TracePoint-Structured-Warnings": String(structured.warnings.length) } : {}) };
  if (mode === "preview" || mode === "proof") return new Response(pdfBody, { headers: { "Content-Type": contentType, "Content-Disposition": `inline; filename="preview-${fileName}"`, "Cache-Control": "no-store", ...statusHeaders } });

  if (!ready) return json({ error: "The document is not complete yet. Resolve the items listed before generating.", ...summary }, 409);
  // Defence in depth: never issue an official document from a template with unreviewed mappings, however it got that way.
  const templateBlockers = publishBlockers((fieldRows.data ?? []) as StoredTemplateField[]);
  if (templateBlockers.length) return json({ error: "This template has fields that still need review. Ask a template manager to finish setting it up.", blockers: templateBlockers }, 409);
  // Likewise for repeating sections that were neither bound nor explicitly left blank.
  const openSections = await admin.from("document_template_analysis_proposals").select("id,status,proposal").eq("department_id", departmentId).eq("template_id", template.data.id).in("status", ["proposed", "modified"]);
  if (openSections.error) return json({ error: "Template sections could not be checked." }, 500);
  const sectionBlockers = structuredPublishBlockers(openSections.data ?? [], bindings.map((binding) => binding.sectionKey));
  if (sectionBlockers.length) return json({ error: "This template has repeating sections that still need a decision. Ask a template manager to finish setting it up.", blockers: sectionBlockers }, 409);
  const generatedId = crypto.randomUUID();
  const upload = await deps.store(admin, departmentId).uploadGeneratedAgencyDocument({ departmentId, recordId: generatedId, objectId: crypto.randomUUID(), fileName, bytes: outcome.bytes, contentType });
  if (upload.error) return json({ error: "The completed document could not be saved." }, 500);
  const references = Object.fromEntries(Object.entries({ person_id: sources.person?.id, firearm_id: sources.firearm?.id, qualification_id: sources.qualification?.id }).filter(([, value]) => value));
  const saved = await admin.from("generated_documents").insert({
    id: generatedId, department_id: departmentId, template_id: template.data.id, template_version_id: version.data.id, generated_by_user_id: userId, storage_path: upload.path,
    // Field provenance only — typed values themselves are kept in the PDF, not duplicated into the audit context.
    context: { references, report_year: reportYear ?? undefined, structured_binding_ids: structured.bindingIds, field_sources: summary.fields.map((field) => ({ field_id: field.fieldId, status: field.status, key: field.canonicalKey })) },
  });
  if (saved.error) return json({ error: "The completed document could not be recorded." }, 500);
  await admin.from("audit_events").insert({ department_id: departmentId, actor_user_id: userId, action: "document_generated", entity_type: "generated_document", entity_id: generatedId, summary: `Generated ${template.data.name}.`, new_value: { template_id: templateId, template_version: template.data.current_version, typed_fields: outcome.resolution.typed.length } });
  return new Response(pdfBody, { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store", "X-TracePoint-Document-Id": generatedId } });
}
