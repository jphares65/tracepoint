"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Eye } from "lucide-react";
import TracePointShell from "@/app/components/TracePointShell";

type Template = { id: string; name: string; description: string | null; category: string | null; status: string };
type Option = { id: string; label: string; detail: string };
type Analysis = { requiresPerson?: boolean; requiresFirearm?: boolean; requiresQualification?: boolean; requiresReportYear?: boolean };
type ReviewField = { fieldId: string; label: string; value: string; status: "filled" | "typed" | "static" | "blank" | "missing"; detail: string; fieldType: string; required: boolean; page: number; inputKind: "text" | "multiline" | "checkbox"; options?: string[] };
type Review = { ready: boolean; format: "pdf" | "docx"; fields: ReviewField[]; missing: { fieldId: string; label: string; detail: string }[]; issues: { fieldId?: string; label?: string; message: string }[]; structuredBlockers: string[]; structuredWarnings: string[] };

const STATUS: Record<ReviewField["status"], { label: string; tone: string }> = {
  filled: { label: "From TracePoint", tone: "text-blue-300" },
  static: { label: "Fixed value", tone: "text-slate-300" },
  typed: { label: "Entered", tone: "text-emerald-300" },
  blank: { label: "Left blank", tone: "text-slate-400" },
  missing: { label: "Missing", tone: "text-red-300" },
};

function Picker({ label, value, onChange, options, placeholder, onSearch }: { label: string; value: string; onChange: (value: string) => void; options: Option[]; placeholder: string; onSearch?: (value: string) => void }) {
  return <label className="mt-4 block text-xs font-semibold text-slate-300">{label}
    {onSearch ? <input type="search" onChange={(event) => onSearch(event.target.value)} placeholder="Search by name, badge or serial" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white" /> : null}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white">
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}{option.detail ? ` · ${option.detail}` : ""}</option>)}
    </select>
  </label>;
}

export default function GenerateAgencyDocumentPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>({});
  const [officers, setOfficers] = useState<Option[]>([]), [firearms, setFirearms] = useState<Option[]>([]), [qualifications, setQualifications] = useState<Option[]>([]);
  const [personId, setPersonId] = useState(""), [firearmId, setFirearmId] = useState(""), [qualificationId, setQualificationId] = useState(""), [reportYear, setReportYear] = useState("");
  const [entered, setEntered] = useState<Record<string, string>>({});
  const [leaveBlank, setLeaveBlank] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [preview, setPreview] = useState<{ url?: string; html?: string } | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const reviewSeq = useRef(0);

  useEffect(() => { void fetch("/api/agency-documents/templates").then((response) => response.json()).then((body) => { const published = (body.templates ?? []).filter((template: Template) => template.status === "published"); setTemplates(published); setTemplateId(published[0]?.id ?? ""); }).catch(() => setMessage("Templates could not be loaded.")); }, []);
  const list = useCallback(async (kind: string, extra = "") => { const response = await fetch(`/api/agency-documents/context?templateId=${encodeURIComponent(templateId)}&kind=${kind}${extra}`); const body = await response.json().catch(() => ({})); return (body.items ?? []) as Option[]; }, [templateId]);
  useEffect(() => { if (!templateId) return; void fetch(`/api/agency-documents/context?templateId=${encodeURIComponent(templateId)}`).then((response) => response.json()).then((body) => setAnalysis(body.analysis ?? {})).catch(() => setMessage("Template details could not be loaded.")); }, [templateId]);
  // The officer picker is also needed to choose whose qualification record to use.
  const needsOfficer = Boolean(analysis.requiresPerson || analysis.requiresQualification);
  useEffect(() => { if (needsOfficer && templateId) void list("person").then(setOfficers); }, [needsOfficer, templateId, list]);
  // Keep the chosen record visible in its list even after a search narrows the options.
  const keep = (options: Option[], selected: string, all: Option[]) => (selected && !options.some((option) => option.id === selected) ? [...all.filter((option) => option.id === selected), ...options] : options);
  const [selectedOfficer, setSelectedOfficer] = useState<Option[]>([]), [selectedFirearm, setSelectedFirearm] = useState<Option[]>([]);
  useEffect(() => { if (analysis.requiresFirearm && templateId) void list("firearm").then(setFirearms); }, [analysis.requiresFirearm, templateId, list]);
  useEffect(() => { if (analysis.requiresQualification && templateId && personId) void list("qualification", `&personId=${encodeURIComponent(personId)}`).then(setQualifications); }, [analysis.requiresQualification, templateId, personId, list]);

  const request = useCallback((mode: "review" | "preview" | "final") => fetch("/api/agency-documents/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId, mode, reportYear: reportYear ? Number(reportYear) : undefined, context: { personId: personId || undefined, firearmId: firearmId || undefined, qualificationId: qualificationId || undefined }, entered, leaveBlank }) }), [templateId, reportYear, personId, firearmId, qualificationId, entered, leaveBlank]);

  // Re-check what will be filled whenever an input changes (debounced). Nothing is saved by a review.
  useEffect(() => {
    if (!templateId) return;
    const sequence = ++reviewSeq.current;
    const timer = window.setTimeout(async () => {
      try {
        const response = await request("review");
        const body = await response.json().catch(() => ({}));
        if (sequence !== reviewSeq.current) return;
        if (!response.ok) { setReview(null); setMessage(body.error || "The document could not be checked."); return; }
        setReview(body); setMessage("");
      } catch { if (sequence === reviewSeq.current) setMessage("The document could not be checked."); }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [templateId, request]);

  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);
  // Any change to what would be generated makes an existing preview out of date; remove it rather than show the wrong document.
  useEffect(() => { setPreview(null); }, [request]);

  function resetFor(nextTemplate: string) { setTemplateId(nextTemplate); setPersonId(""); setFirearmId(""); setQualificationId(""); setReportYear(""); setEntered({}); setLeaveBlank([]); setReview(null); setPreview(null); }

  async function showPreview() {
    setBusy(true); setMessage("");
    try {
      const response = await request("preview");
      if (!response.ok && response.headers.get("Content-Type")?.includes("json")) throw new Error((await response.json()).error || "Preview could not be created.");
      if (response.headers.get("Content-Type")?.includes("json")) { const body = await response.json(); setPreview({ html: body.previewHtml ?? "" }); }
      else { const blob = await response.blob(); setPreview({ url: URL.createObjectURL(blob) }); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Preview could not be created."); } finally { setBusy(false); }
  }

  async function generate() {
    setBusy(true); setMessage("");
    try {
      const response = await request("final");
      if (!response.ok) { const body = await response.json().catch(() => ({})); if (body.fields) setReview(body); throw new Error(body.error || "Document could not be generated."); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement("a");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      anchor.href = url; anchor.download = disposition.match(/filename="([^"]+)"/)?.[1] ?? (review?.format === "docx" ? "document.docx" : "document.pdf"); anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMessage("Document generated, saved to TracePoint, and downloaded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Document could not be generated."); } finally { setBusy(false); }
  }

  const needsInput = (field: ReviewField) => field.fieldType === "manual" || field.status === "missing" || (field.status === "typed" && field.fieldType === "tracepoint_data") || (field.status === "blank" && field.fieldType === "tracepoint_data");
  const blockers = [...(review?.missing ?? []).map((item) => `${item.label}: ${item.detail}`), ...(review?.issues ?? []).map((issue) => issue.message), ...(review?.structuredBlockers ?? [])];

  return <TracePointShell activePage="Agency Documents"><main className="mx-auto max-w-6xl space-y-4">
    <Link href="/agency-documents" className="inline-flex items-center gap-1 text-xs text-slate-400"><ArrowLeft size={14} />Agency Documents</Link>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[.24em] text-blue-400">Generate Document</p>
        <h1 className="mt-1 text-xl font-bold text-white">Create a completed agency document</h1>
        <label className="mt-5 block text-xs font-semibold text-slate-300">Published template
          <select value={templateId} onChange={(event) => resetFor(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white">{templates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.category ? ` · ${template.category}` : ""}</option>)}</select>
        </label>
        {!templates.length ? <p className="mt-3 text-xs text-slate-400">No published templates yet.</p> : null}
        {needsOfficer ? <Picker label={analysis.requiresPerson ? "Officer this document is for" : "Officer whose qualification to use"} value={personId} onChange={(value) => { setPersonId(value); setQualificationId(""); setSelectedOfficer(officers.filter((option) => option.id === value)); }} options={keep(officers, personId, selectedOfficer)} placeholder="Select an officer" onSearch={(value) => void list("person", `&search=${encodeURIComponent(value)}`).then(setOfficers)} /> : null}
        {analysis.requiresFirearm ? <Picker label="Firearm" value={firearmId} onChange={(value) => { setFirearmId(value); setSelectedFirearm(firearms.filter((option) => option.id === value)); }} options={keep(firearms, firearmId, selectedFirearm)} placeholder="Select a firearm" onSearch={(value) => void list("firearm", `&search=${encodeURIComponent(value)}`).then(setFirearms)} /> : null}
        {analysis.requiresQualification ? <Picker label="Qualification record" value={qualificationId} onChange={setQualificationId} options={qualifications} placeholder={personId ? "Select a qualification" : "Select an officer first"} /> : null}
        {analysis.requiresReportYear ? <label className="mt-4 block text-xs font-semibold text-slate-300">Report year<input value={reportYear} onChange={(event) => setReportYear(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="2026" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white" /></label> : null}

        {review ? <div className="mt-6">
          <h2 className="text-sm font-bold text-white">What will be filled</h2>
          <ul className="mt-2 divide-y divide-slate-800 rounded-lg border border-slate-800">
            {review.fields.map((field) => <li key={field.fieldId} className="p-2.5">
              <div className="flex items-start justify-between gap-2"><span className="text-sm text-white">{field.label}{field.required ? <span className="text-red-300"> *</span> : null}</span><span className={`shrink-0 text-[11px] ${STATUS[field.status].tone}`}>{STATUS[field.status].label}</span></div>
              {field.status === "filled" || field.status === "static" ? <p className="mt-0.5 break-words text-sm text-slate-200">{field.value}</p> : null}
              <p className="mt-0.5 text-[11px] text-slate-500">{field.detail}</p>
              {needsInput(field) ? <div className="mt-1.5 space-y-1">
                {field.inputKind === "checkbox" ? <label className="flex items-center gap-2 text-xs text-slate-200"><input type="checkbox" checked={/^(yes|x|true|checked|on|1)$/i.test(entered[field.fieldId] ?? "")} onChange={(event) => setEntered({ ...entered, [field.fieldId]: event.target.checked ? "Yes" : "" })} />Checked</label>
                  : field.options?.length ? <select value={entered[field.fieldId] ?? ""} onChange={(event) => setEntered({ ...entered, [field.fieldId]: event.target.value })} className="w-full rounded border border-slate-700 bg-slate-950 p-1.5 text-sm text-white"><option value="">Choose…</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
                  : field.inputKind === "multiline" ? <textarea rows={3} value={entered[field.fieldId] ?? ""} onChange={(event) => setEntered({ ...entered, [field.fieldId]: event.target.value })} className="w-full rounded border border-slate-700 bg-slate-950 p-1.5 text-sm text-white" />
                  : <input value={entered[field.fieldId] ?? ""} onChange={(event) => setEntered({ ...entered, [field.fieldId]: event.target.value })} placeholder={field.fieldType === "tracepoint_data" ? "Type the value for this document" : "Enter value"} className="w-full rounded border border-slate-700 bg-slate-950 p-1.5 text-sm text-white" />}
                {field.status === "missing" || leaveBlank.includes(field.fieldId) ? <label className="flex items-center gap-2 text-[11px] text-slate-400"><input type="checkbox" checked={leaveBlank.includes(field.fieldId)} onChange={(event) => setLeaveBlank(event.target.checked ? [...leaveBlank, field.fieldId] : leaveBlank.filter((id) => id !== field.fieldId))} />Leave this blank on purpose</label> : null}
              </div> : null}
            </li>)}
          </ul>
          {review.structuredWarnings.length ? <ul className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-100">{review.structuredWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        </div> : null}

        {blockers.length ? <div role="status" className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100"><p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle size={13} />Before generating:</p><ul className="list-disc space-y-0.5 pl-4">{blockers.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : review?.ready ? <p className="mt-4 flex items-center gap-1.5 text-xs text-emerald-300"><CheckCircle2 size={14} />Everything is filled. Preview to check, then generate.</p> : null}
        {message ? <p className="mt-4 text-sm text-blue-200">{message}</p> : null}
        <div className="mt-6 flex flex-wrap gap-2">
          <button disabled={busy || !templateId} onClick={() => void showPreview()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 disabled:opacity-50"><Eye size={14} />Preview</button>
          <button disabled={busy || !templateId || !review?.ready} onClick={() => void generate()} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Download size={14} />{busy ? "Working…" : review?.format === "docx" ? "Generate Word document" : "Generate PDF"}</button>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
        <p className="mb-2 text-xs text-slate-400">{preview ? (review?.format === "docx" ? "Preview of the completed Word content (filled values highlighted). Word decides page breaks." : "Preview — this is the exact document that will be generated. It is not saved.") : "Choose Preview to see the completed document."}</p>
        {preview?.url ? <iframe title="Document preview" src={preview.url} className="h-[80vh] w-full rounded bg-white" /> : null}
        {/* Server-generated HTML from docxPreviewHtml; all document text is escaped there. */}
        {preview?.html !== undefined ? <div className="max-h-[80vh] overflow-auto rounded bg-white p-8 text-sm leading-relaxed text-slate-900 [&_mark]:bg-yellow-200 [&_p]:my-1 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-400 [&_td]:p-1" dangerouslySetInnerHTML={{ __html: preview.html }} /> : null}
      </section>
    </div>
  </main></TracePointShell>;
}
