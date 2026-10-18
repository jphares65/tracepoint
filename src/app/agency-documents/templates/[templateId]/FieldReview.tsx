"use client";

import { useState } from "react";
import { AlertTriangle, Check, FileText } from "lucide-react";
import { DOCUMENT_FIELD_REGISTRY, getDocumentField } from "@/lib/agency-documents/field-registry";
import { applyMappingChoice, orderedForReview, REVIEW_STATE_LABEL, reviewState, reviewSummary, type MappingChoice, type ReviewField, type ReviewState } from "@/lib/agency-documents/field-review-state";

const CATEGORIES = [...new Set(DOCUMENT_FIELD_REGISTRY.map((field) => field.category))];
const TONE: Record<ReviewState, string> = {
  needs_review: "border-amber-500/60 bg-amber-500/10 text-amber-200",
  tracepoint: "border-blue-500/50 bg-blue-500/10 text-blue-200",
  asked: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  fixed: "border-slate-500/60 bg-slate-500/10 text-slate-200",
  date: "border-slate-500/60 bg-slate-500/10 text-slate-200",
};

function mappingText(field: ReviewField) {
  if (field.field_type === "tracepoint_data") return getDocumentField(field.canonical_key ?? "")?.label ?? "Unavailable field";
  if (field.field_type === "static_text") return `“${field.static_text ?? ""}”`;
  if (field.field_type === "generated_date") return "Date the document is generated";
  return field.is_required ? "Required entry" : "Optional entry";
}

/**
 * The main configuration surface: one row per field, flagged ones first.
 * Most forms need only the amber rows confirmed; nothing has to be dragged.
 */
export function FieldReview({ fields, editable, onSave, onSelect }: { fields: ReviewField[]; editable: boolean; onSave: (next: ReviewField[]) => void; onSelect: (field: ReviewField) => void }) {
  const [fixedFor, setFixedFor] = useState<string | null>(null);
  const [fixedValue, setFixedValue] = useState("");
  const [error, setError] = useState("");
  const summary = reviewSummary(fields);
  function choose(field: ReviewField, choice: MappingChoice) {
    const updated = applyMappingChoice(field, choice);
    if (!updated) { setError("That choice is not valid for this field."); return; }
    setError("");
    onSave(fields.map((item) => (item.id === field.id ? updated : item)));
  }
  function onSelectChange(field: ReviewField, value: string) {
    if (!value) return;
    if (value === "manual") choose(field, { kind: "manual", required: false });
    else if (value === "manual-required") choose(field, { kind: "manual", required: true });
    else if (value === "date") choose(field, { kind: "date" });
    else if (value === "fixed") { setFixedFor(field.id); setFixedValue(field.static_text ?? ""); }
    else choose(field, { kind: "tracepoint", key: value });
  }
  return <div className="space-y-3">
    <div>
      <h2 className="font-bold text-white">Review fields</h2>
      <p className="mt-1 text-xs text-slate-400">{summary.total} field{summary.total === 1 ? "" : "s"} · {summary.tracepoint} from TracePoint · {summary.asked} entered when generating · {summary.fixed + summary.date} fixed</p>
      {summary.needs_review ? <p className="mt-2 flex items-start gap-1.5 rounded border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-amber-100"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{summary.needs_review} field{summary.needs_review === 1 ? " needs" : "s need"} a decision before this template can be published.</p> : summary.total ? <p className="mt-2 flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-100"><Check size={14} />Every field is confirmed. Check placement, then publish.</p> : <p className="mt-2 text-xs text-slate-400">No fields yet. Use “Set up automatically”.</p>}
      {error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null}
    </div>
    <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
      {orderedForReview(fields).map((field) => {
        const state = reviewState(field);
        const reason = typeof field.formatting?.matchReason === "string" ? field.formatting.matchReason : "";
        return <li key={field.id} className={`rounded-lg border p-2 ${TONE[state]}`}>
          <button type="button" onClick={() => onSelect(field)} className="flex w-full items-start justify-between gap-2 text-left">
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-white">{field.label || mappingText(field)}</span><span className="block text-[11px] opacity-80">Page {field.page_number} · {mappingText(field)}</span></span>
            <span className="shrink-0 rounded-full border border-current px-2 py-0.5 text-[10px]">{REVIEW_STATE_LABEL[state]}</span>
          </button>
          {reason && state === "needs_review" ? <p className="mt-1 text-[11px] opacity-90">{reason}</p> : null}
          {editable ? <div className="mt-2 flex flex-wrap items-center gap-2">
            {state === "needs_review" ? <button type="button" onClick={() => choose(field, { kind: "confirm" })} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white"><Check className="mr-0.5 inline" size={12} />Use {mappingText(field)}</button> : null}
            <label className="sr-only" htmlFor={`map-${field.id}`}>Change what fills {field.label}</label>
            <select id={`map-${field.id}`} value="" onChange={(event) => onSelectChange(field, event.target.value)} className="rounded border border-slate-600 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-100">
              <option value="">{state === "needs_review" ? "Choose something else…" : "Change…"}</option>
              {CATEGORIES.map((category) => <optgroup key={category} label={`TracePoint · ${category}`}>{DOCUMENT_FIELD_REGISTRY.filter((item) => item.category === category).map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup>)}
              <optgroup label="Other"><option value="manual">Enter when generating (optional)</option><option value="manual-required">Enter when generating (required)</option><option value="fixed">Same value every time…</option><option value="date">Date generated</option></optgroup>
            </select>
          </div> : null}
          {fixedFor === field.id ? <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); choose(field, { kind: "fixed", value: fixedValue }); setFixedFor(null); }}>
            <input autoFocus value={fixedValue} onChange={(event) => setFixedValue(event.target.value)} placeholder="Value printed every time (e.g. agency ORI)" className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-white" />
            <button className="rounded bg-blue-600 px-2 py-1 text-xs text-white">Save</button>
            <button type="button" onClick={() => setFixedFor(null)} className="rounded border border-slate-600 px-2 py-1 text-xs">Cancel</button>
          </form> : null}
        </li>;
      })}
    </ul>
  </div>;
}

/** Word templates have no fixed page layout; show the document's own content with sample values in place. */
export function WordContentProof({ html, issues }: { html: string; issues: { message: string }[] }) {
  return <div className="space-y-2">
    <p className="flex items-center gap-1.5 text-xs text-slate-300"><FileText size={14} />Word document content with sample values highlighted. Word controls page breaks when the completed file is opened.</p>
    {issues.length ? <ul className="rounded border border-red-500/50 bg-red-500/10 p-2 text-xs text-red-200">{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul> : null}
    {/* The HTML is produced server-side by docxPreviewHtml, which escapes all document text. */}
    <div className="docx-proof max-h-[75vh] overflow-auto rounded bg-white p-8 text-sm leading-relaxed text-slate-900 [&_mark]:bg-yellow-200 [&_p]:my-1 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-400 [&_td]:p-1 [&_td]:align-top" dangerouslySetInnerHTML={{ __html: html }} />
  </div>;
}
