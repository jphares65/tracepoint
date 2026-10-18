import { getDocumentField } from "./field-registry";
import { matchFieldLabel, type LearnedMapping, type MatchStatus } from "./field-matcher";
import { normalizeRotation, pdfRectToNormalized } from "./page-geometry";
import { inspectPdf, labelSources, type InspectedField, type InspectedFieldKind } from "./pdf-form-inspector";
import { analyzeDocx, type DocxField } from "./docx-forms";
import { isValidFieldGeometry, type FieldGeometry } from "./template-core";

export type ProposalType = "tracepoint_data" | "manual" | "static_text";
export type AnalyzerSource = "native_pdf" | "visual_scan" | "manual" | "docx";
export type ProposalKind = "scalar_field" | "structured_section";
export type StructuredTargetCell = { page: number; order: number; row: number; column: number; geometry: FieldGeometry; source?: "textract" | "grid_detector" };

/** Native fillable-field details carried with a proposal so generation can fill the real form field instead of drawing over it. */
export type AcroFieldRef = { name: string; kind: InspectedFieldKind; multiline: boolean; comb: boolean; maxLength: number | null; options: string[]; widgets: { page: number; geometry: FieldGeometry }[] };

export type AnalysisProposal = {
  id: string;
  page: number;
  detectedLabel: string;
  suggestedType: ProposalType;
  suggestedSemanticKey?: string;
  confidence: number;
  classification: "high" | "review" | "unmapped" | "structured";
  geometry: FieldGeometry;
  reviewRequired: boolean;
  rationale?: string;
  analyzerSource: AnalyzerSource;
  kind?: ProposalKind;
  structuredType?: "repeating_table";
  targetCells?: StructuredTargetCell[];
  /** Deterministic matcher outcome; absent on legacy proposals. */
  matchStatus?: MatchStatus;
  alternatives?: string[];
  normalizedLabel?: string;
  acroField?: AcroFieldRef;
  /** Word placeholder locator; Word templates are filled in place rather than by position. */
  docxTarget?: DocxField;
  /** Proposals that should default to "leave blank" (signatures, buttons). */
  skipByDefault?: boolean;
};
export type AnalysisResult = { provider: "native-pdf-heuristic" | "native-pdf-form" | "visual-scan-layout-profile" | "general-vision-advisory" | "docx-structure"; version: "1" | "2" | "3"; scanned: boolean; proposals: AnalysisProposal[] };
type WidgetRect = { x: number; y: number; width: number; height: number };
type NativeWidget = { name: string; page: number; geometry: FieldGeometry; fallback: boolean };

/**
 * Legacy helper kept for callers/tests: normalizes a widget rectangle on a page
 * whose MediaBox starts at the origin. New code uses page-geometry directly so
 * CropBox offsets are honoured.
 */
export function normalizeWidgetRectangle(rect: WidgetRect, pageWidth: number, pageHeight: number, rotation = 0): FieldGeometry | null {
  const normalized = normalizeRotation(rotation);
  if (normalized === null || pageWidth <= 0 || pageHeight <= 0) return null;
  const geometry = pdfRectToNormalized(rect, { x: 0, y: 0, width: pageWidth, height: pageHeight }, normalized);
  return geometry && isValidFieldGeometry(geometry) ? geometry : null;
}

type ProposalInput = Omit<AnalysisProposal, "id" | "classification" | "reviewRequired" | "analyzerSource"> & { analyzerSource?: AnalyzerSource };

export function validateProposal(input: ProposalInput): AnalysisProposal | null {
  if (!isValidFieldGeometry(input.geometry) || input.page < 1 || input.confidence < 0 || input.confidence > 1) return null;
  const key = input.suggestedSemanticKey;
  const analyzerSource = input.analyzerSource ?? "manual";
  if (key && !getDocumentField(key)) return null;
  if (input.kind === "structured_section") return { ...input, analyzerSource, id: crypto.randomUUID(), classification: "structured", reviewRequired: true, suggestedSemanticKey: undefined, suggestedType: "manual", structuredType: input.structuredType ?? "repeating_table" };
  // When the deterministic matcher ran, its verdict decides the classification.
  // Legacy callers without a matcher verdict fall back to confidence bands.
  const classification = !key ? "unmapped" : input.matchStatus ? (input.matchStatus === "exact" ? "high" : "review") : input.confidence >= 0.9 ? "high" : "review";
  return { ...input, analyzerSource, id: crypto.randomUUID(), classification, reviewRequired: classification !== "high", kind: "scalar_field" };
}

/** Build a proposal for a printed or named label using the deterministic matcher. */
export function suggestFromLabel(label: string | readonly string[], page: number, geometry: FieldGeometry, options: { learned?: readonly LearnedMapping[]; fieldKind?: "text" | "checkbox" | "choice" | "signature"; analyzerSource?: AnalyzerSource; context?: readonly string[] } = {}) {
  const labels = typeof label === "string" ? [label] : label;
  const match = matchFieldLabel(labels, { learned: options.learned, fieldKind: options.fieldKind, context: options.context });
  return validateProposal({
    page,
    detectedLabel: labels[0] ?? "",
    suggestedType: match.key ? "tracepoint_data" : "manual",
    suggestedSemanticKey: match.key,
    confidence: match.confidence,
    geometry,
    rationale: match.reason,
    analyzerSource: options.analyzerSource ?? "native_pdf",
    matchStatus: match.status,
    alternatives: match.alternatives,
    normalizedLabel: match.normalizedLabel,
  });
}

const REPEATED_COLUMN = /^(?:make|manufacturer|model|serial(?: (?:number|no|num))?|caliber)$/i;

/**
 * Row index of a firearm-table field, from flat names ("Firearm1Make", "Make_2")
 * or hierarchical ones ("Inventory.Row3.SerialNumber", "Firearms.Item_2.Make").
 * `name` is the field's full name so a row number in a parent segment is seen.
 */
function repeatedName(name: string) {
  const segments = name.replace(/\[\d+\]/g, "").split(".").filter(Boolean);
  const last = segments.at(-1) ?? name;
  const normalized = last.replace(/[_-]+/g, " ").trim();
  const prefix = normalized.match(/^(?:firearm|weapon)\s*(\d+)\s*(make|manufacturer|model|serial|caliber)\b/i);
  if (prefix) return { index: prefix[1] };
  const suffix = normalized.match(/^(make|manufacturer|model|serial|caliber)\s*(?:number\s*)?(\d+)\b/i);
  if (suffix) return { index: suffix[2] };
  const column = normalized.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ");
  if (segments.length < 2 || !REPEATED_COLUMN.test(column)) return undefined;
  for (const segment of segments.slice(0, -1).reverse()) {
    const row = segment.match(/^(?:row|line|item|entry|record|firearm|weapon|gun)?[\s_-]*(\d{1,2})$/i);
    if (row) return { index: row[1] };
  }
  return undefined;
}

function unionGeometry(items: NativeWidget[]) {
  const x = Math.min(...items.map((item) => item.geometry.x)), y = Math.min(...items.map((item) => item.geometry.y));
  return { x, y, width: Math.max(...items.map((item) => item.geometry.x + item.geometry.width)) - x, height: Math.max(...items.map((item) => item.geometry.y + item.geometry.height)) - y };
}

export function classifyRepeatedNativeGroups(widgets: NativeWidget[]) {
  const groups = new Map<string, NativeWidget[]>();
  for (const widget of widgets) {
    const match = repeatedName(widget.name);
    if (!match) continue;
    const key = `${widget.page}:${match.index}`;
    groups.set(key, [...(groups.get(key) ?? []), widget]);
  }
  const repeatedIndexes = new Map<number, Set<string>>();
  for (const [key, items] of groups) {
    if (items.length < 2) continue;
    const [page, index] = key.split(":");
    const indexes = repeatedIndexes.get(Number(page)) ?? new Set<string>();
    indexes.add(index);
    repeatedIndexes.set(Number(page), indexes);
  }
  const grouped = new Set<string>();
  const proposals: AnalysisProposal[] = [];
  for (const [page, indexes] of repeatedIndexes) {
    if (indexes.size < 2) continue;
    const members = [...groups.entries()].filter(([key]) => key.startsWith(`${page}:`)).flatMap(([, items]) => items);
    members.forEach((member) => grouped.add(`${member.page}:${member.name}`));
    const proposal = validateProposal({ page, detectedLabel: `Repeated firearm fields (${[...indexes].sort((a, b) => Number(a) - Number(b)).join(", ")})`, suggestedType: "manual", confidence: 0.9, geometry: unionGeometry(members), rationale: "Numbered firearm make/model/caliber/serial fields are a repeating group and need a repeating-data model.", analyzerSource: "native_pdf", kind: "structured_section", structuredType: "repeating_table" });
    if (proposal) proposals.push(proposal);
  }
  return { grouped, proposals };
}

/** "txtOfficerName[0]" → "Officer Name", "badge_no" → "Badge No". Display only; matching uses the raw sources. */
export function humanizeFieldName(name: string) {
  const words = name.replace(/\[\d+\]/g, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[_.\-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1 && /^(txt|text|fld|field|tb|tf|cb|chk|dd|ddl)$/i.test(words[0]!)) words.shift();
  return words.map((word) => (word.length > 1 && word === word.toLowerCase() ? word[0]!.toUpperCase() + word.slice(1) : word)).join(" ") || name;
}

function fieldKindForMatcher(kind: InspectedFieldKind): "text" | "checkbox" | "choice" | "signature" {
  if (kind === "checkbox" || kind === "radio") return "checkbox";
  if (kind === "dropdown" || kind === "list") return "choice";
  if (kind === "signature") return "signature";
  return "text";
}

function acroRef(field: InspectedField): AcroFieldRef {
  return { name: field.name, kind: field.kind, multiline: field.multiline, comb: field.comb, maxLength: field.maxLength, options: field.options, widgets: field.widgets };
}

/** Proposals for a PDF's native fillable fields. One proposal per field; all of its widgets are filled together at generation. */
export function proposalsFromInspection(fields: readonly InspectedField[], learned: readonly LearnedMapping[] = []): AnalysisProposal[] {
  const fillable = fields.filter((field) => !field.readOnly && field.kind !== "button");
  const widgets: NativeWidget[] = fillable.flatMap((field) => field.widgets.map((widget) => ({ name: field.name, page: widget.page, geometry: widget.geometry, fallback: false })));
  const { grouped, proposals } = classifyRepeatedNativeGroups(widgets);
  for (const field of fillable) {
    const partial = field.name.split(".").at(-1) ?? field.name;
    const first = field.widgets[0];
    if (first && grouped.has(`${first.page}:${field.name}`)) continue;
    const labels = labelSources(field);
    if (!first) {
      // Never guess a location. A field without a placeable widget is reported so the person can place it or ignore it.
      const proposal = validateProposal({ page: 1, detectedLabel: field.tooltip ?? humanizeFieldName(partial), suggestedType: "manual", confidence: 0, geometry: { x: 0.02, y: 0.02, width: 0.2, height: 0.03 }, rationale: "This fillable field has no visible position on any page. It will be filled through the form itself, but its location could not be shown.", analyzerSource: "native_pdf", matchStatus: "unmatched", acroField: acroRef(field), skipByDefault: true });
      if (proposal) proposals.push(proposal);
      continue;
    }
    const proposal = suggestFromLabel(labels, first.page, first.geometry, { learned, fieldKind: fieldKindForMatcher(field.kind) });
    if (!proposal) continue;
    // Signature and initials boxes are signed by hand; they default to "leave blank".
    const signature = field.kind === "signature" || labels.some((label) => /\b(signature|signed|initials?)\b/i.test(label.replace(/([a-z])([A-Z])/g, "$1 $2")));
    proposals.push({ ...proposal, detectedLabel: field.tooltip ?? humanizeFieldName(partial), acroField: acroRef(field), skipByDefault: signature ? true : undefined });
  }
  return proposals;
}

export async function analyzeTemplatePdf(bytes: Uint8Array, options: { learned?: readonly LearnedMapping[] } = {}): Promise<AnalysisResult> {
  const inspection = await inspectPdf(bytes);
  const proposals = proposalsFromInspection(inspection.fields, options.learned ?? []);
  return { provider: "native-pdf-form", version: "2", scanned: inspection.flat, proposals };
}

export function shouldUseVisualFallback(result: AnalysisResult) {
  return result.scanned && result.proposals.length === 0;
}

/**
 * Word templates: each detected placeholder becomes one proposal. Word has no
 * fixed page coordinates, so geometry is a stable list position used only for
 * ordering; filling uses the placeholder locator.
 */
export function proposalsFromDocxFields(fields: readonly DocxField[], learned: readonly LearnedMapping[] = []): AnalysisProposal[] {
  const proposals: AnalysisProposal[] = [];
  fields.forEach((field, index) => {
    const geometry = { x: 0, y: Math.min(0.98, index * 0.001), width: 1, height: 0.001 };
    // Checkboxes are never auto-filled: they become yes/no questions answered when generating.
    const base = suggestFromLabel(field.label, 1, geometry, { learned, analyzerSource: "docx", context: field.section ? [field.section] : undefined, fieldKind: field.kind === "checkbox" ? "checkbox" : undefined });
    if (!base) return;
    let proposal: AnalysisProposal = { ...base, detectedLabel: field.label, docxTarget: field };
    if (field.repeating && proposal.matchStatus === "exact") {
      proposal = { ...proposal, matchStatus: "suggested", classification: "review", reviewRequired: true, confidence: Math.min(proposal.confidence, 0.6), rationale: `${proposal.rationale} It is the first row of a list, which may need a repeating section instead of one record.` };
    }
    if (/\b(signature|signed|initials?)\b/i.test(field.label)) proposal = { ...proposal, skipByDefault: true };
    proposals.push(proposal);
  });
  return proposals;
}

export function analyzeTemplateDocx(bytes: Uint8Array, options: { learned?: readonly LearnedMapping[] } = {}): AnalysisResult {
  const fields = analyzeDocx(bytes);
  return { provider: "docx-structure", version: "3", scanned: false, proposals: proposalsFromDocxFields(fields, options.learned ?? []) };
}
