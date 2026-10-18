import { getDocumentField } from "./field-registry";

/**
 * Pure state helpers for the template builder's field review list. Kept out
 * of the React component so the rules (what counts as reviewed, what a mapping
 * change does) are unit-tested.
 */

export type ReviewField = {
  id: string;
  page_number: number;
  field_type: "tracepoint_data" | "manual" | "static_text" | "generated_date";
  canonical_key?: string | null;
  label?: string | null;
  static_text?: string | null;
  is_required?: boolean;
  formatting?: Record<string, unknown>;
  geometry: { x: number; y: number; width: number; height: number };
  placeholder?: string | null;
};

export type ReviewState = "needs_review" | "tracepoint" | "asked" | "fixed" | "date";

export function reviewState(field: ReviewField): ReviewState {
  if (field.formatting?.matchStatus === "suggested") return "needs_review";
  if (field.field_type === "tracepoint_data") return "tracepoint";
  if (field.field_type === "static_text") return "fixed";
  if (field.field_type === "generated_date") return "date";
  return "asked";
}

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  needs_review: "Needs review",
  tracepoint: "From TracePoint",
  asked: "Entered when generating",
  fixed: "Fixed value",
  date: "Today's date",
};

/** Fields ordered for review: flagged first, then by page and position. */
export function orderedForReview(fields: readonly ReviewField[]) {
  const rank: Record<ReviewState, number> = { needs_review: 0, asked: 1, tracepoint: 2, fixed: 3, date: 4 };
  return [...fields].sort((a, b) => rank[reviewState(a)] - rank[reviewState(b)] || a.page_number - b.page_number || a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x);
}

export function reviewSummary(fields: readonly ReviewField[]) {
  const counts: Record<ReviewState, number> = { needs_review: 0, tracepoint: 0, asked: 0, fixed: 0, date: 0 };
  for (const field of fields) counts[reviewState(field)] += 1;
  return { ...counts, total: fields.length, readyToPublish: counts.needs_review === 0 && fields.length > 0 };
}

/** What the person chose for a field in the review list. */
export type MappingChoice =
  | { kind: "confirm" }
  | { kind: "tracepoint"; key: string }
  | { kind: "manual"; required: boolean }
  | { kind: "fixed"; value: string }
  | { kind: "date" };

/** Apply a choice. Any explicit choice by a person confirms the field. Invalid choices return null. */
export function applyMappingChoice(field: ReviewField, choice: MappingChoice): ReviewField | null {
  const formatting = { ...(field.formatting ?? {}), matchStatus: "confirmed", confirmedByPerson: true, source: field.formatting?.source === "manual" ? "manual" : "reviewed" };
  const label = field.label || (field.canonical_key ? getDocumentField(field.canonical_key)?.label : null) || "Field";
  switch (choice.kind) {
    case "confirm":
      if (field.field_type === "tracepoint_data" && !getDocumentField(field.canonical_key ?? "")) return null;
      return { ...field, formatting };
    case "tracepoint":
      if (!getDocumentField(choice.key)) return null;
      return { ...field, field_type: "tracepoint_data", canonical_key: choice.key, static_text: null, label, formatting };
    case "manual":
      return { ...field, field_type: "manual", canonical_key: null, static_text: null, label, is_required: choice.required, formatting };
    case "fixed":
      if (!choice.value.trim()) return null;
      return { ...field, field_type: "static_text", canonical_key: null, static_text: choice.value.trim(), label, formatting };
    case "date":
      return { ...field, field_type: "generated_date", canonical_key: null, static_text: null, label, formatting };
  }
}
