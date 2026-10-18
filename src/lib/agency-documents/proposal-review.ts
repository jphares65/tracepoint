import { getDocumentField } from "./field-registry";
import type { AnalysisProposal } from "./template-analyzer";

export type ProposalStatus = "proposed" | "accepted" | "modified" | "rejected";

export function canCreateTemplateField(proposal: AnalysisProposal) {
  return proposal.kind !== "structured_section";
}

/**
 * Only exact deterministic matches may be accepted in bulk. Legacy proposals
 * (no matcher verdict) must still be high-confidence and review-free.
 */
export function eligibleForBulkAccept(proposal: AnalysisProposal) {
  if (proposal.kind === "structured_section" || proposal.skipByDefault) return false;
  if (proposal.matchStatus && proposal.matchStatus !== "exact") return false;
  return proposal.classification === "high" && proposal.suggestedType === "tracepoint_data" && Boolean(proposal.suggestedSemanticKey) && proposal.reviewRequired === false;
}

export function reviewProgress(statuses: readonly ProposalStatus[]) {
  const reviewed = statuses.filter((status) => status !== "proposed").length;
  return { reviewed, total: statuses.length, remaining: statuses.length - reviewed };
}

/** A reviewed proposal plus the edits a person made in the builder. */
export type ReviewedProposal = AnalysisProposal & { label?: string; placeholder?: string; required?: boolean; staticText?: string; formatting?: Record<string, unknown> };

export type TemplateFieldRow = {
  id: string;
  page_number: number;
  field_type: "tracepoint_data" | "manual" | "static_text";
  canonical_key: string | null;
  label: string | null;
  placeholder: string | null;
  static_text: string | null;
  is_required: boolean;
  geometry: AnalysisProposal["geometry"];
  formatting: Record<string, unknown>;
};

export class ProposalConversionError extends Error {
  constructor(message: string) { super(message); this.name = "ProposalConversionError"; }
}

/**
 * Convert a reviewed proposal into a template field row. Native form-field
 * details travel in `formatting` so generation fills the real field. Returns
 * an error instead of guessing when the proposal is incomplete.
 */
export function proposalToFieldRow(proposal: ReviewedProposal, status: ProposalStatus, id: string = crypto.randomUUID()): TemplateFieldRow {
  if (!canCreateTemplateField(proposal)) throw new ProposalConversionError("Repeating sections are configured as structured bindings, not single fields.");
  const type = proposal.suggestedType;
  if (type === "tracepoint_data" && !getDocumentField(proposal.suggestedSemanticKey ?? "")) throw new ProposalConversionError(`"${proposal.detectedLabel}" is not linked to an available TracePoint field.`);
  if (type === "static_text" && !proposal.staticText?.trim()) throw new ProposalConversionError(`Enter the fixed value for "${proposal.detectedLabel}".`);
  const label = (proposal.label ?? proposal.detectedLabel ?? "").trim() || null;
  if (type === "manual" && !label) throw new ProposalConversionError("Manual fields need a label so the person generating the document knows what to enter.");
  const acro = proposal.acroField;
  const formatting: Record<string, unknown> = {
    ...(proposal.formatting ?? {}),
    source: status === "modified" ? "analyzer_modified" : "analyzer",
    // Only decisions a person actually made are reused on other templates (see learned-mappings).
    ...(status === "accepted" || status === "modified" ? { confirmedByPerson: true } : {}),
    // A person accepting or editing a proposal confirms it. During automatic setup
    // ("proposed"), only exact matches count as confirmed; suggestions stay flagged.
    matchStatus: status === "accepted" || status === "modified" || proposal.matchStatus === "exact" || !proposal.matchStatus ? "confirmed" : proposal.matchStatus,
    ...(proposal.normalizedLabel ? { normalizedLabel: proposal.normalizedLabel } : {}),
    ...(proposal.rationale ? { matchReason: proposal.rationale } : {}),
    ...(proposal.docxTarget ? { docxTarget: { part: proposal.docxTarget.part, kind: proposal.docxTarget.kind, ordinal: proposal.docxTarget.ordinal, label: proposal.docxTarget.label, ...(proposal.docxTarget.scheme !== undefined ? { scheme: proposal.docxTarget.scheme } : {}) } } : {}),
    ...(acro ? { acroFieldName: acro.name, acroFieldKind: acro.kind, multiline: acro.multiline, comb: acro.comb, maxLength: acro.maxLength, widgets: acro.widgets, options: acro.options } : {}),
  };
  return {
    id,
    page_number: proposal.page,
    field_type: type,
    canonical_key: type === "tracepoint_data" ? proposal.suggestedSemanticKey ?? null : null,
    label,
    placeholder: proposal.placeholder ?? null,
    static_text: type === "static_text" ? proposal.staticText!.trim() : null,
    is_required: proposal.required === true,
    geometry: proposal.geometry,
    formatting,
  };
}

/** Status shown for a stored field: anything a person has not confirmed is "needs review". */
export function fieldNeedsReview(field: { formatting?: Record<string, unknown> | null }) {
  return field.formatting?.matchStatus === "suggested";
}

export type SetupPlan = {
  rows: TemplateFieldRow[];
  skipped: AnalysisProposal[];
  structured: AnalysisProposal[];
  summary: { confirmed: number; needsReview: number; manual: number; skipped: number; structured: number };
};

/**
 * One-click setup: turn every analysis proposal into a template field so the
 * person only has to look at the flagged ones.
 * - exact matches → TracePoint data, confirmed
 * - suggestions   → TracePoint data, flagged "needs review" (publishing is blocked until confirmed or changed)
 * - no match      → asked for when generating (never auto-filled)
 * - signatures, buttons and unplaceable fields → left blank
 * - repeating tables → left for structured-binding setup
 */
export function planAutomaticSetup(proposals: readonly AnalysisProposal[]): SetupPlan {
  const rows: TemplateFieldRow[] = [], skipped: AnalysisProposal[] = [], structured: AnalysisProposal[] = [];
  for (const proposal of proposals) {
    if (proposal.kind === "structured_section") { structured.push(proposal); continue; }
    if (proposal.skipByDefault) { skipped.push(proposal); continue; }
    try {
      rows.push(proposalToFieldRow(proposal.suggestedSemanticKey ? proposal : { ...proposal, suggestedType: "manual" }, "proposed"));
    } catch {
      skipped.push(proposal);
    }
  }
  const confirmed = rows.filter((row) => row.field_type === "tracepoint_data" && row.formatting.matchStatus === "confirmed").length;
  const needsReview = rows.filter((row) => row.formatting.matchStatus === "suggested").length;
  return { rows, skipped, structured, summary: { confirmed, needsReview, manual: rows.filter((row) => row.field_type === "manual").length, skipped: skipped.length, structured: structured.length } };
}

/** Reasons a template cannot be published yet. Empty means it can be published. */
export function publishBlockers(fields: readonly { id: string; field_type: string; canonical_key: string | null; label: string | null; static_text: string | null; formatting?: Record<string, unknown> | null }[]) {
  const blockers: { fieldId: string; message: string }[] = [];
  if (!fields.length) blockers.push({ fieldId: "", message: "The template has no fields yet." });
  for (const field of fields) {
    const name = field.label || getDocumentField(field.canonical_key ?? "")?.label || "A field";
    if (fieldNeedsReview(field)) blockers.push({ fieldId: field.id, message: `${name}: confirm or change the suggested TracePoint field.` });
    if (field.field_type === "tracepoint_data" && !getDocumentField(field.canonical_key ?? "")) blockers.push({ fieldId: field.id, message: `${name}: linked TracePoint field is no longer available.` });
    if (field.field_type === "static_text" && !field.static_text?.trim()) blockers.push({ fieldId: field.id, message: `${name}: the fixed value is empty.` });
  }
  return blockers;
}

/** Formatting keys that describe where a field is on the form or who decided it; set only by the analyzer and by acceptance. */
const SYSTEM_FORMATTING_KEYS = ["acroFieldName", "acroFieldKind", "widgets", "options", "maxLength", "comb", "docxTarget", "confirmedByPerson", "matchStatus", "source", "normalizedLabel", "matchReason"] as const;

/**
 * Applies a person's edit to a stored proposal. Only the decision (type,
 * TracePoint field, label, fixed text, required, placement box and display
 * formatting) can change; what was detected on the form — the kind of
 * proposal, its native field or Word location, page and repeating-section
 * cells — always comes from the stored proposal.
 */
export function mergeProposalUpdate(stored: ReviewedProposal, incoming: Partial<ReviewedProposal>): ReviewedProposal {
  const formatting = incoming.formatting && typeof incoming.formatting === "object" ? { ...incoming.formatting } : stored.formatting;
  if (formatting && formatting !== stored.formatting) for (const key of SYSTEM_FORMATTING_KEYS) delete formatting[key];
  const type = incoming.suggestedType;
  return {
    ...stored,
    ...(type === "tracepoint_data" || type === "manual" || type === "static_text" ? { suggestedType: type } : {}),
    ...("suggestedSemanticKey" in incoming ? { suggestedSemanticKey: typeof incoming.suggestedSemanticKey === "string" ? incoming.suggestedSemanticKey : undefined } : {}),
    ...(typeof incoming.label === "string" ? { label: incoming.label } : {}),
    ...(typeof incoming.placeholder === "string" ? { placeholder: incoming.placeholder } : {}),
    ...(typeof incoming.required === "boolean" ? { required: incoming.required } : {}),
    ...(typeof incoming.staticText === "string" ? { staticText: incoming.staticText } : {}),
    ...(incoming.geometry && ["x", "y", "width", "height"].every((key) => typeof (incoming.geometry as Record<string, unknown>)[key] === "number") ? { geometry: incoming.geometry } : {}),
    ...(formatting ? { formatting } : {}),
  };
}
