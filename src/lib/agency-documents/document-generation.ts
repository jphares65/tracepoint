import { getDocumentField } from "./field-registry";
import { resolveFieldValues, type FieldFormatting, type GenerationSources, type ResolutionSummary, type ResolveOptions, type TemplateFieldSpec, type TemplateFieldType } from "./field-values";
import { renderDocument, type RenderField, type RenderIssue } from "./pdf-renderer";
import { docxPreviewHtml, fillDocx, looksLikeDocx, type DocxTarget } from "./docx-forms";

/**
 * Composes value resolution and rendering for one template. Shared by the
 * generate route (review / preview / final) and the template builder's proof,
 * so every surface shows exactly what final generation will produce.
 */

export type StoredTemplateField = {
  id: string;
  page_number: number;
  field_type: string;
  canonical_key: string | null;
  label: string | null;
  static_text: string | null;
  is_required?: boolean | null;
  geometry: { x: number; y: number; width: number; height: number };
  formatting: Record<string, unknown> | null;
};

const FIELD_TYPES: readonly TemplateFieldType[] = ["tracepoint_data", "manual", "static_text", "generated_date"];

export function toFieldSpec(row: StoredTemplateField): TemplateFieldSpec {
  return {
    id: String(row.id),
    pageNumber: Number(row.page_number),
    fieldType: (FIELD_TYPES as readonly string[]).includes(row.field_type) ? (row.field_type as TemplateFieldType) : "manual",
    canonicalKey: row.canonical_key,
    label: row.label,
    staticText: row.static_text,
    required: row.is_required === true,
    geometry: row.geometry,
    formatting: (row.formatting ?? {}) as FieldFormatting,
  };
}

export type ExtraRenderField = { pageNumber: number; value: string; geometry: RenderField["geometry"]; formatting?: RenderField["formatting"] };

export type GenerationOutcome = {
  resolution: ResolutionSummary;
  issues: RenderIssue[];
  bytes: Uint8Array;
  /** True only when every field resolved and rendered faithfully. */
  ready: boolean;
};

export function renderFieldsFor(fields: readonly TemplateFieldSpec[], resolution: ResolutionSummary): RenderField[] {
  const byId = new Map(resolution.fields.map((item) => [item.fieldId, item]));
  return fields.map((field) => {
    const resolved = byId.get(field.id)!;
    return { fieldId: field.id, label: resolved.label, pageNumber: field.pageNumber, value: resolved.value, geometry: field.geometry, formatting: field.formatting ?? undefined, status: resolved.status };
  });
}

export async function generateDocument(source: Uint8Array, fields: readonly TemplateFieldSpec[], sources: GenerationSources, options: ResolveOptions & { mode?: "final" | "proof"; extra?: readonly ExtraRenderField[] } = {}): Promise<GenerationOutcome> {
  const resolution = resolveFieldValues(fields, sources, options);
  const renderFields = [...renderFieldsFor(fields, resolution), ...(options.extra ?? []).map((field) => ({ ...field, label: "Repeating section cell", status: "filled" as const }))];
  const rendered = await renderDocument(source, renderFields, { mode: options.mode ?? "final" });
  return { resolution, issues: rendered.issues, bytes: rendered.bytes, ready: resolution.ready && rendered.issues.length === 0 };
}

/** Realistic, worst-case-length sample values used to check that every box is big enough before any real data is used. */
const SAMPLES: Record<string, string> = {
  "person.full_name": "Alexandra M. Richardson-Okafor", "person.first_name": "Alexandra", "person.last_name": "Richardson-Okafor", "person.badge_number": "100482", "person.rank": "Lieutenant", "person.email": "a.richardson@example.gov",
  "agency.name": "Lakeview Township Police Department", "agency.short_name": "Lakeview PD", "agency.ori": "NJ0000000", "agency.address": "100 Municipal Plaza, Lakeview, NJ 07000", "agency.chief_name": "Chief Morgan T. Whitfield",
  "document.report_year": "2026", "document.report_date": "12/31/2026",
  "preparer.full_name": "Sgt. Casey J. Morgan", "preparer.rank": "Sergeant", "preparer.badge_number": "1102",
  "firearm.manufacturer": "Example Arms Company", "firearm.model": "EA-19 Gen 5 MOS", "firearm.serial_number": "EXA1234567", "firearm.caliber": ".40 S&W", "firearm.asset_number": "LV-000042", "firearm.assigned_officer": "Alexandra M. Richardson-Okafor", "firearm.type": "Handgun",
  "qualification.date": "12/31/2026", "qualification.course_name": "Day Handgun Qualification", "qualification.score": "287", "qualification.result": "Pass", "qualification.instructor": "Sgt. Taylor R. Brooks",
};

/** PDF checkbox fields and Word checkboxes are answered yes/no. */
export function isCheckboxField(field: Pick<TemplateFieldSpec, "formatting">) {
  return field.formatting?.acroFieldKind === "checkbox" || (field.formatting?.docxTarget as { kind?: unknown } | undefined)?.kind === "checkbox";
}

export function sampleValue(field: TemplateFieldSpec) {
  if (field.fieldType === "static_text") return field.staticText ?? "";
  if (field.fieldType === "generated_date") return "12/31/2026";
  if (field.fieldType === "manual") return isCheckboxField(field) ? "Yes" : `‹${field.label ?? "Entered value"}›`;
  return SAMPLES[field.canonicalKey ?? ""] ?? `‹${getDocumentField(field.canonicalKey ?? "")?.label ?? "Value"}›`;
}

/**
 * Template proof: every field outlined and filled with a sample value of
 * realistic length, coloured by mapping state. Used while configuring a
 * template, before any officer is selected.
 */
export async function renderTemplateProof(source: Uint8Array, fields: readonly TemplateFieldSpec[]) {
  const renderFields: RenderField[] = fields.map((field) => ({
    fieldId: field.id,
    label: field.label ?? getDocumentField(field.canonicalKey ?? "")?.label ?? field.staticText ?? "Field",
    pageNumber: field.pageNumber,
    value: sampleValue(field).replace(/[‹›]/g, (mark) => (mark === "‹" ? "<" : ">")),
    geometry: field.geometry,
    formatting: field.formatting ?? undefined,
    status: field.formatting?.matchStatus === "suggested" ? "missing" : field.fieldType === "manual" ? "typed" : "filled",
  }));
  return renderDocument(source, renderFields, { mode: "proof" });
}

export type TemplateFormat = "pdf" | "docx";

/** Decide the template format from its bytes (never from the file name alone). */
export function templateFormat(bytes: Uint8Array): TemplateFormat | null {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(1024, bytes.length)));
  if (header.includes("%PDF-")) return "pdf";
  if (looksLikeDocx(bytes)) return "docx";
  return null;
}

function docxTargetOf(field: TemplateFieldSpec): DocxTarget | null {
  const target = field.formatting?.docxTarget as Partial<DocxTarget> | undefined;
  if (!target || typeof target.part !== "string" || typeof target.kind !== "string" || typeof target.ordinal !== "number" || typeof target.label !== "string") return null;
  return target as DocxTarget;
}

export type DocxGenerationOutcome = { resolution: ResolutionSummary; issues: RenderIssue[]; bytes: Uint8Array; previewHtml: string; ready: boolean };

/** Word templates: same value resolution as PDFs, filled in place. */
export function generateDocxDocument(source: Uint8Array, fields: readonly TemplateFieldSpec[], sources: GenerationSources, options: ResolveOptions = {}): DocxGenerationOutcome {
  const resolution = resolveFieldValues(fields, sources, options);
  const issues: RenderIssue[] = [];
  const fills = fields.flatMap((field) => {
    const target = docxTargetOf(field);
    const resolved = resolution.fields.find((item) => item.fieldId === field.id)!;
    if (!target) { issues.push({ fieldId: field.id, label: resolved.label, page: 1, kind: "form_field_missing", message: `"${resolved.label}" is not linked to a place in the Word document. Re-analyze the template.` }); return []; }
    return [{ target, value: resolved.value, fieldId: field.id, label: resolved.label }];
  });
  const filled = fillDocx(source, fills);
  issues.push(...filled.issues.map((issue) => ({ fieldId: issue.fieldId, label: issue.label, page: 1, kind: issue.kind === "invalid_checkbox_value" ? "invalid_checkbox_value" as const : "form_field_missing" as const, message: issue.message })));
  const previewHtml = docxPreviewHtml(filled.bytes, resolution.fields.map((item) => item.value));
  return { resolution, issues, bytes: filled.bytes, previewHtml, ready: resolution.ready && issues.length === 0 };
}

/** Word template proof: the document content with sample values in every configured place. */
export function renderDocxTemplateProof(source: Uint8Array, fields: readonly TemplateFieldSpec[]) {
  const fills = fields.flatMap((field) => { const target = docxTargetOf(field); return target ? [{ target, value: sampleValue(field), fieldId: field.id }] : []; });
  const filled = fillDocx(source, fills);
  return { html: docxPreviewHtml(filled.bytes, fills.map((fill) => fill.value)), issues: filled.issues };
}
