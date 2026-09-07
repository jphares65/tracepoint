"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Download, FileCheck2, Loader2, LockKeyhole, RotateCcw, Search, ShieldCheck, Sparkles, Upload, WandSparkles, X } from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import { DOMAIN_LABELS, IMPORT_FIELDS } from "@/lib/ai-importer/catalog";
import { normalizeLabel } from "@/lib/ai-importer/normalize";
import { IMPORT_DOMAINS, type ColumnMapping, type FileMetadata, type ImportDomain, type ImportExecutionResult, type ImportInterpretation, type ImportPayload, type ImportPreview, type ParsedSheet, type RemediationScope, type RowDecision, type ValidationIssue, type ValueOverride } from "@/lib/ai-importer/types";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type Step = "upload" | "interpret" | "map" | "validate" | "review" | "import" | "results";
type UploadResponse = { file: FileMetadata; sheets: ParsedSheet[]; interpretation: ImportInterpretation; error?: string };

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "upload", label: "Upload" }, { id: "interpret", label: "Interpret" }, { id: "map", label: "Map" },
  { id: "validate", label: "Validate" }, { id: "review", label: "Review" }, { id: "import", label: "Import" }, { id: "results", label: "Results" },
];

function headerNames(matrix: string[][], headerRow: number) {
  const seen = new Map<string, number>();
  return (matrix[headerRow - 1] ?? []).map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function sampleValues(sheet: ParsedSheet, headerRow: number, columnIndex: number) {
  return sheet.matrix.slice(headerRow, headerRow + 8).map((row) => row[columnIndex]?.trim() ?? "").filter(Boolean).slice(0, 3);
}

function suggestMappings(sheet: ParsedSheet, headerRow: number, domain: ImportDomain): ColumnMapping[] {
  const used = new Set<string>();
  return headerNames(sheet.matrix, headerRow).map((sourceColumn, index) => {
    const source = normalizeLabel(sourceColumn);
    const exact = IMPORT_FIELDS[domain].find((field) => !used.has(field.key) && [field.label, ...field.aliases].map(normalizeLabel).includes(source));
    const similar = exact ? undefined : IMPORT_FIELDS[domain].filter((field) => !used.has(field.key) && [field.label, ...field.aliases].map(normalizeLabel).some((alias) => alias.length > 3 && (source.includes(alias) || alias.includes(source))));
    const field = exact ?? (similar?.length === 1 ? similar[0] : undefined);
    if (field) used.add(field.key);
    return { sourceColumn, targetField: field?.key ?? null, confidence: exact ? "High" : field ? "Medium" : "Needs Review", samples: sampleValues(sheet, headerRow, index), reason: exact ? "Heading matches a known field alias." : field ? "Heading is similar to a known field alias." : "Review or ignore this source column." };
  });
}

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function saveRejected(result: ImportExecutionResult) {
  const keys = [...new Set(result.rejectedRows.flatMap((row) => Object.keys(row.values)))];
  const csv = [["Source row", "Reason", ...keys].map(csvCell).join(","), ...result.rejectedRows.map((row) => [row.rowNumber, row.reason, ...keys.map((key) => row.values[key])].map(csvCell).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `tracepoint-import-${result.jobId}-rejected.csv`; anchor.click(); URL.revokeObjectURL(url);
}

async function errorMessage(response: Response) {
  try { return ((await response.json()) as { error?: string }).error || "TracePoint could not complete this step."; }
  catch { return "TracePoint could not complete this step."; }
}

function Stat({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const colors = { slate: "border-slate-800 text-slate-200", green: "border-emerald-800/70 text-emerald-200", amber: "border-amber-800/70 text-amber-200", red: "border-red-800/70 text-red-200", blue: "border-blue-800/70 text-blue-200" };
  return <div className={`rounded-2xl border bg-slate-950/50 p-4 ${colors[tone]}`}><p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

export default function AiImporterPage() {
  const access = useTracePointAccess();
  const [step, setStep] = useState<Step>("upload");
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [domain, setDomain] = useState<ImportDomain>("personnel");
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportExecutionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approvals, setApprovals] = useState({ domain: false, mappings: false, validation: false, finalAction: false });
  const [overrides, setOverrides] = useState<ValueOverride[]>([]);
  const [rowDecisions, setRowDecisions] = useState<RowDecision[]>([]);
  const [resolver, setResolver] = useState<{ rowNumber: number; issue: ValidationIssue } | null>(null);
  const [replacement, setReplacement] = useState("");
  const [resolutionScope, setResolutionScope] = useState<RemediationScope>("row");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkField, setBulkField] = useState("");
  const [bulkFind, setBulkFind] = useState("");
  const [bulkReplacement, setBulkReplacement] = useState("");
  const [bulkScope, setBulkScope] = useState<"column" | "import">("column");

  const sheet = upload?.sheets.find((item) => item.name === sheetName) ?? null;
  const currentIndex = STEPS.findIndex((item) => item.id === step);
  const mappedCount = mappings.filter((mapping) => mapping.targetField).length;
  const needsReview = mappings.filter((mapping) => mapping.confidence === "Needs Review" && mapping.targetField).length;
  const approvalComplete = Object.values(approvals).every(Boolean);
  const payload = useMemo<ImportPayload | null>(() => upload && sheet ? { file: upload.file, domain, sheetName: sheet.name, headerRow, matrix: sheet.matrix, mappings, overrides, rowDecisions } : null, [upload, sheet, domain, headerRow, mappings, overrides, rowDecisions]);

  function reset() {
    setStep("upload"); setUpload(null); setPreview(null); setResult(null); setError(""); setOverrides([]); setRowDecisions([]); setResolver(null);
    setApprovals({ domain: false, mappings: false, validation: false, finalAction: false });
  }

  function reconfigure(nextDomain: ImportDomain, nextSheetName: string, nextHeader: number) {
    if (!upload) return;
    const nextSheet = upload.sheets.find((item) => item.name === nextSheetName);
    if (!nextSheet) return;
    setDomain(nextDomain); setSheetName(nextSheetName); setHeaderRow(nextHeader);
    setMappings(suggestMappings(nextSheet, nextHeader, nextDomain)); setPreview(null); setOverrides([]); setRowDecisions([]);
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true); setError(""); setUpload(null);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/settings/ai-importer/interpret", { method: "POST", body: form, credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const data = await response.json() as UploadResponse;
      setUpload(data); setDomain(data.interpretation.domain); setSheetName(data.interpretation.sheetName); setHeaderRow(data.interpretation.headerRow); setMappings(data.interpretation.mappings); setOverrides([]); setRowDecisions([]); setStep("interpret");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "TracePoint could not read this file."); }
    finally { setBusy(false); }
  }

  async function runPreview(nextOverrides = overrides, nextRowDecisions = rowDecisions) {
    if (!payload) return;
    setBusy(true); setError("");
    try {
      const nextPayload = { ...payload, overrides: nextOverrides, rowDecisions: nextRowDecisions };
      const response = await fetch("/api/settings/ai-importer/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextPayload), credentials: "same-origin" });
      if (!response.ok) throw new Error(await errorMessage(response));
      setOverrides(nextOverrides); setRowDecisions(nextRowDecisions); setPreview(await response.json() as ImportPreview); setApprovals({ domain: false, mappings: false, validation: false, finalAction: false }); setStep("validate");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Validation failed."); }
    finally { setBusy(false); }
  }

  function openResolver(rowNumber: number, issue: ValidationIssue) {
    setResolver({ rowNumber, issue }); setReplacement(issue.resolution?.suggestedValue ?? issue.resolution?.options?.[0]?.value ?? ""); setResolutionScope("row");
  }

  async function applyResolution() {
    if (!resolver?.issue.field || !resolver.issue.sourceColumn || resolver.issue.originalValue === undefined) return;
    const override: ValueOverride = { rowNumber: resolver.rowNumber, sourceColumn: resolver.issue.sourceColumn, targetField: resolver.issue.field, originalValue: resolver.issue.originalValue, replacementValue: replacement, scope: resolutionScope, approvedAt: new Date().toISOString() };
    const next = [...overrides.filter((item) => !(item.rowNumber === override.rowNumber && item.targetField === override.targetField)), override];
    setResolver(null); await runPreview(next, rowDecisions);
  }

  async function resolveConflict(rowNumber: number, resolution: RowDecision["resolution"], conflictingRowNumber?: number) {
    const targetRow = resolution === "keep_later" ? conflictingRowNumber : rowNumber;
    if (!targetRow) return;
    const decision: RowDecision = { rowNumber: targetRow, sourceConflictRowNumber: rowNumber, resolution, approvedAt: new Date().toISOString() };
    setResolver(null); await runPreview(overrides, [...rowDecisions.filter((item) => item.rowNumber !== targetRow), decision]);
  }

  async function applyBulkReplacement() {
    if (!sheet || !bulkField || !bulkFind) return;
    const mapping = mappings.find((item) => item.targetField === bulkField);
    if (!mapping) return;
    const columnIndex = headerNames(sheet.matrix, headerRow).indexOf(mapping.sourceColumn);
    const matrixIndex = sheet.matrix.findIndex((row, index) => index >= headerRow && row.some((value) => value.trim()) && (row[columnIndex]?.trim() ?? "") === bulkFind);
    if (columnIndex < 0 || matrixIndex < 0) { setError("No exact matching source values were found in that mapped column."); return; }
    const override: ValueOverride = { rowNumber: matrixIndex + 1, sourceColumn: mapping.sourceColumn, targetField: bulkField, originalValue: bulkFind, replacementValue: bulkReplacement, scope: bulkScope, approvedAt: new Date().toISOString() };
    setBulkOpen(false); await runPreview([...overrides, override], rowDecisions);
  }

  async function execute() {
    if (!payload || !preview || !approvalComplete) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/settings/ai-importer/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload, approvalToken: preview.approvalToken, previewDigest: preview.previewDigest, approval: approvals }), credentials: "same-origin" });
      if (!response.ok && response.status !== 207) throw new Error(await errorMessage(response));
      const data = await response.json() as { result: ImportExecutionResult };
      setResult(data.result); setStep("results");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The import could not be completed."); }
    finally { setBusy(false); }
  }

  return <TracePointShell activePage="Settings">
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_36%),linear-gradient(180deg,#020617,#07111f)] px-4 py-8 text-slate-100 sm:px-7 lg:px-10">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/settings/import-export" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400 hover:text-white"><ArrowLeft size={14}/> Import & Export</Link>
            <div className="mt-4 flex items-center gap-3"><div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3"><Sparkles className="text-blue-300"/></div><div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-300">AI-assisted, administrator controlled</p><span className="rounded-full border border-blue-500/60 bg-blue-950 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-blue-200">Beta</span></div><h1 className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">AI-Assisted Importer</h1></div></div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">Bring the spreadsheet your agency already uses. TracePoint interprets it, shows every proposed mapping and action, then waits for your explicit approval before writing anything.</p>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-amber-200">AI-assisted import is currently in beta. Review all proposed mappings and validation results before importing.</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-100"><span className="flex items-center gap-2 font-bold"><LockKeyhole size={15}/> Active agency enforced</span><span className="mt-1 block text-emerald-200/70">{access.loading ? "Verifying access…" : access.departmentName || "Agency unavailable"}</span></div>
        </div>

        <nav className="mt-8 grid grid-cols-4 gap-2 lg:grid-cols-7" aria-label="Import progress">{STEPS.map((item, index) => <div key={item.id} className={`rounded-xl border px-3 py-2 ${index === currentIndex ? "border-blue-500 bg-blue-500/10 text-blue-100" : index < currentIndex ? "border-emerald-800/70 bg-emerald-950/20 text-emerald-300" : "border-slate-800 bg-slate-950/40 text-slate-600"}`}><span className="text-[9px] font-black uppercase tracking-widest">{index < currentIndex ? <Check size={12} className="inline"/> : `0${index + 1}`}</span><span className="ml-2 text-xs font-bold">{item.label}</span></div>)}</nav>

        {error ? <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-100"><AlertTriangle className="mt-0.5 shrink-0" size={18}/><span>{error}</span></div> : null}

        <main className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900/75 shadow-2xl shadow-black/20 backdrop-blur">
          {step === "upload" ? <section className="p-6 sm:p-10">
            <div className="mx-auto max-w-3xl text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Start with the source</p><h2 className="mt-3 text-2xl font-black text-white">Upload the spreadsheet you already have</h2><p className="mt-3 text-sm leading-6 text-slate-400">CSV, XLSX, and legacy XLS files are supported. Up to 3 MB, 50 worksheets, 10,000 rows per worksheet, and 150 columns. Uploading and interpreting never writes to the database.</p>
              <label className={`mt-8 flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-[2rem] border border-dashed p-8 transition ${busy ? "border-blue-700 bg-blue-950/20" : "border-slate-700 bg-slate-950/50 hover:border-blue-500 hover:bg-blue-950/10"}`}>
                {busy ? <Loader2 className="h-12 w-12 animate-spin text-blue-300"/> : <Upload className="h-12 w-12 text-blue-300"/>}<span className="mt-5 text-lg font-black text-white">{busy ? "Reading and interpreting…" : "Choose spreadsheet"}</span><span className="mt-2 text-xs text-slate-500">The raw file is not retained after this request.</span><input type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} disabled={busy || access.loading} className="hidden"/></label>
            </div>
          </section> : null}

          {step === "interpret" && upload && sheet ? <section className="p-6 sm:p-8">
            <div className="flex flex-col gap-4 border-b border-slate-800 pb-6 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">TracePoint interpretation</p><h2 className="mt-2 text-2xl font-black text-white">Confirm what this file contains</h2><p className="mt-2 text-sm text-slate-400">{upload.file.name} · {(upload.file.size / 1024).toFixed(1)} KB · {upload.sheets.length} worksheet{upload.sheets.length === 1 ? "" : "s"}</p></div><span className={`rounded-full border px-3 py-1 text-xs font-bold ${upload.interpretation.usedFallback ? "border-amber-700 text-amber-200" : "border-emerald-700 text-emerald-200"}`}>{upload.interpretation.usedFallback ? "Manual-safe fallback" : "Interpretation ready"}</span></div>
            <div className="mt-6 grid gap-5 lg:grid-cols-3"><label className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Import domain</span><select value={domain} onChange={(event) => reconfigure(event.target.value as ImportDomain, sheetName, headerRow)} className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white">{IMPORT_DOMAINS.map((item) => <option key={item} value={item}>{DOMAIN_LABELS[item]}</option>)}</select></label>
              <label className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Worksheet</span><select value={sheetName} onChange={(event) => { const next = upload.sheets.find((item) => item.name === event.target.value)!; reconfigure(domain, next.name, next.probableHeaderRow); }} className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white">{upload.sheets.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.rowCount} rows</option>)}</select></label>
              <label className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Header row</span><select value={headerRow} onChange={(event) => reconfigure(domain, sheetName, Number(event.target.value))} className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white">{Array.from({ length: Math.min(25, sheet.matrix.length) }, (_, index) => <option key={index + 1} value={index + 1}>Row {index + 1}: {(sheet.matrix[index] ?? []).filter(Boolean).slice(0, 4).join(" · ") || "Blank"}</option>)}</select></label></div>
            <div className="mt-6 rounded-2xl border border-blue-900/60 bg-blue-950/20 p-5"><p className="text-sm font-bold text-blue-100">What TracePoint noticed</p><div className="mt-3 grid gap-3 text-xs leading-5 text-slate-300 md:grid-cols-2"><p><span className="font-bold text-slate-100">Likely identifiers:</span> {upload.interpretation.identifierColumns.join(", ") || "Review during mapping"}</p><p><span className="font-bold text-slate-100">Likely date formats:</span> {upload.interpretation.likelyDateFormats.join(", ") || "No date columns detected"}</p></div></div>
            <div className="mt-7 flex justify-between"><button onClick={reset} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">Start over</button><button onClick={() => setStep("map")} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white hover:bg-blue-500">Review mappings <ArrowRight size={16}/></button></div>
          </section> : null}

          {step === "map" && sheet ? <section className="p-6 sm:p-8"><div className="flex flex-col gap-3 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Column mapping</p><h2 className="mt-2 text-2xl font-black text-white">Match agency columns to TracePoint</h2><p className="mt-2 text-sm text-slate-400">{mappedCount} of {mappings.length} source columns mapped · {needsReview} mapped column{needsReview === 1 ? "" : "s"} need review</p></div><span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-bold text-slate-300">{DOMAIN_LABELS[domain]} · {sheet.name}</span></div>
            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-800"><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-slate-950 text-[10px] uppercase tracking-[0.18em] text-slate-500"><tr><th className="p-4">Source column</th><th className="p-4">TracePoint field</th><th className="p-4">Confidence</th><th className="p-4">Sample values</th></tr></thead><tbody className="divide-y divide-slate-800">{mappings.map((mapping, index) => <tr key={mapping.sourceColumn} className="bg-slate-900/50"><td className="p-4 font-bold text-white">{mapping.sourceColumn}</td><td className="p-4"><select value={mapping.targetField ?? ""} onChange={(event) => setMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, targetField: event.target.value || null, confidence: "Needs Review", reason: "Administrator-selected mapping." } : item))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"><option value="">Ignore this column</option>{IMPORT_FIELDS[domain].map((field) => <option key={field.key} value={field.key}>{field.label}{field.required ? " · required" : ""}</option>)}</select></td><td className="p-4"><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${mapping.confidence === "High" ? "border-emerald-700 text-emerald-300" : mapping.confidence === "Medium" ? "border-blue-700 text-blue-300" : "border-amber-700 text-amber-200"}`}>{mapping.confidence}</span></td><td className="max-w-sm p-4 text-xs text-slate-400">{mapping.samples.join(" · ") || "No sample values"}</td></tr>)}</tbody></table></div></div>
            <div className="mt-7 flex justify-between"><button onClick={() => setStep("interpret")} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">Back</button><button onClick={() => void runPreview()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={16}/> : <FileCheck2 size={16}/>} Validate every row</button></div>
          </section> : null}

          {step === "validate" && preview ? <section className="p-6 sm:p-8"><div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Validation preview</p><h2 className="mt-2 text-2xl font-black text-white">Fix exceptions without leaving TracePoint</h2><p className="mt-2 text-sm text-slate-400">The uploaded workbook stays unchanged. Approved fixes apply only to this import working copy.</p></div><button onClick={() => { setBulkOpen((current) => !current); setBulkField(mappings.find((item) => item.targetField)?.targetField ?? ""); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-700 bg-blue-950/30 px-4 py-2 text-sm font-bold text-blue-100"><Search size={15}/> Find &amp; Replace</button></div>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8"><Stat label="Rows" value={preview.summary.total}/><Stat label="Valid" value={preview.summary.valid} tone="green"/><Stat label="Warnings" value={preview.summary.warnings} tone="amber"/><Stat label="Blocked" value={preview.summary.blocked} tone="red"/><Stat label="Create" value={preview.summary.create} tone="blue"/><Stat label="Update" value={preview.summary.update} tone="amber"/><Stat label="Skip" value={preview.summary.skip}/><Stat label="Conflict" value={preview.summary.conflict} tone="red"/></div>
            {overrides.length || rowDecisions.length ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-100"><span><strong>{overrides.length + rowDecisions.length}</strong> approved working-state fix{overrides.length + rowDecisions.length === 1 ? "" : "es"}. Included in final approval fingerprint.</span><button onClick={() => void runPreview([], [])} disabled={busy} className="font-bold text-emerald-200 underline underline-offset-4">Clear all fixes</button></div> : null}
            {bulkOpen ? <div className="mt-5 rounded-2xl border border-blue-800/70 bg-blue-950/20 p-5"><div className="flex items-center justify-between"><div><p className="font-black text-white">Field-aware Find &amp; Replace</p><p className="mt-1 text-xs text-slate-400">Exact matches only. Replacement is constrained to a mapped field; unrestricted cross-column replacement is disabled.</p></div><button aria-label="Close Find and Replace" onClick={() => setBulkOpen(false)} className="text-slate-400"><X size={18}/></button></div><div className="mt-4 grid gap-3 lg:grid-cols-4"><label className="text-xs font-bold text-slate-300">Field<select value={bulkField} onChange={(event) => setBulkField(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white">{mappings.filter((item) => item.targetField).map((item) => <option key={item.targetField} value={item.targetField!}>{IMPORT_FIELDS[domain].find((field) => field.key === item.targetField)?.label}</option>)}</select></label><label className="text-xs font-bold text-slate-300">Find<input value={bulkFind} onChange={(event) => setBulkFind(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white" placeholder="Exact source value"/></label><label className="text-xs font-bold text-slate-300">Replace with<input value={bulkReplacement} onChange={(event) => setBulkReplacement(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"/></label><label className="text-xs font-bold text-slate-300">Scope<select value={bulkScope} onChange={(event) => setBulkScope(event.target.value as "column" | "import")} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-white"><option value="column">Current mapped column</option>{["date", "boolean"].includes(IMPORT_FIELDS[domain].find((field) => field.key === bulkField)?.kind ?? "") ? <option value="import">Compatible mapped fields</option> : null}</select></label></div><button onClick={() => void applyBulkReplacement()} disabled={busy || !bulkFind || !bulkReplacement} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40"><WandSparkles size={15}/> Apply &amp; Revalidate</button></div> : null}
            {preview.mappingIssues.length ? <div className="mt-5 space-y-2">{preview.mappingIssues.map((issue, index) => <div key={index} className={`rounded-xl border p-3 text-sm ${issue.severity === "error" ? "border-red-800 bg-red-950/20 text-red-200" : "border-amber-800 text-amber-200"}`}>{issue.message}</div>)}</div> : null}
            <div className="mt-5 max-h-[540px] overflow-auto rounded-2xl border border-slate-800"><table className="w-full min-w-[980px] text-left text-xs"><thead className="sticky top-0 z-10 bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="p-3">Row</th><th className="p-3">Action</th><th className="p-3">Status</th><th className="p-3">Matched by</th><th className="p-3">Changes / reasons</th></tr></thead><tbody className="divide-y divide-slate-800">{preview.rows.map((row) => <tr key={row.rowNumber} className="bg-slate-900/70 align-top"><td className="p-3 font-bold text-white">{row.rowNumber}</td><td className="p-3"><span className="font-black text-blue-200">{row.action}</span></td><td className="p-3 capitalize text-slate-300">{row.status}</td><td className="p-3 text-slate-400">{row.matchReason || "—"}</td><td className="p-3 text-slate-300">{row.issues.length ? <ul className="space-y-2">{row.issues.map((issue, index) => <li key={index} className={`flex items-start justify-between gap-4 ${issue.severity === "error" ? "text-red-300" : "text-amber-200"}`}><span>{issue.message}</span>{issue.resolution || issue.conflict ? <button onClick={() => openResolver(row.rowNumber, issue)} className="shrink-0 rounded-lg border border-current px-2.5 py-1 text-[10px] font-black uppercase tracking-wider hover:bg-white/5">Resolve</button> : null}</li>)}</ul> : row.changes.length ? <ul className="space-y-1">{row.changes.map((change) => <li key={change.field}>{change.label}: <span className="text-slate-500">{String(change.previous ?? "blank")}</span> → {String(change.next ?? "blank")}</li>)}</ul> : "No changes"}</td></tr>)}</tbody></table></div>
            <div className="mt-7 flex justify-between"><button onClick={() => setStep("map")} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">Adjust mapping</button><button onClick={() => { setApprovals({ domain: false, mappings: false, validation: false, finalAction: false }); setStep("review"); }} disabled={preview.summary.blocked > 0 || preview.mappingIssues.some((issue) => issue.severity === "error")} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">Review approvals <ArrowRight size={16}/></button></div>
          </section> : null}

          {resolver && preview ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Resolve import exception"><div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-[2rem] border border-slate-700 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">Resolve source exception</p><h3 className="mt-2 text-xl font-black text-white">Row {resolver.rowNumber}{resolver.issue.field ? ` · ${IMPORT_FIELDS[domain].find((field) => field.key === resolver.issue.field)?.label ?? resolver.issue.field}` : ""}</h3></div><button aria-label="Close resolver" onClick={() => setResolver(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"><X size={19}/></button></div>{resolver.issue.conflict ? <div className="mt-6"><p className="rounded-xl border border-red-800/70 bg-red-950/20 p-4 text-sm text-red-200">{resolver.issue.message}</p>{resolver.issue.conflict.conflictingRowNumber ? <div className="mt-4 grid gap-3 md:grid-cols-2">{[resolver.issue.conflict.conflictingRowNumber, resolver.rowNumber].map((number, index) => <div key={number} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4"><p className="text-xs font-black uppercase text-slate-500">{index ? "Later" : "Earlier"} row {number}</p><dl className="mt-3 space-y-1 text-xs">{Object.entries(preview.rows.find((row) => row.rowNumber === number)?.values ?? {}).filter(([, value]) => value !== "" && value !== null).slice(0, 8).map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt className="text-slate-500">{key}</dt><dd className="text-right text-slate-200">{String(value)}</dd></div>)}</dl></div>)}</div> : null}<div className="mt-5 flex flex-wrap gap-2"><button onClick={() => void resolveConflict(resolver.rowNumber, "keep_first", resolver.issue.conflict?.conflictingRowNumber)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white">Keep first · skip duplicate</button>{resolver.issue.conflict.conflictingRowNumber ? <button onClick={() => void resolveConflict(resolver.rowNumber, "keep_later", resolver.issue.conflict?.conflictingRowNumber)} className="rounded-xl border border-blue-700 px-4 py-2 text-sm font-bold text-blue-100">Keep later row</button> : null}<button onClick={() => void resolveConflict(resolver.rowNumber, "skip_row")} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200">Skip this row</button></div><p className="mt-4 text-xs text-slate-500">TracePoint never silently merges ambiguous records. This records an explicit row decision and revalidates.</p></div> : <div className="mt-6 space-y-5"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Source value</p><p className="mt-2 break-words font-bold text-white">{resolver.issue.sourceValue || "Blank"}</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Why it needs attention</p><p className="mt-2 text-sm text-slate-300">{resolver.issue.message}</p></div></div>{resolver.issue.resolution?.suggestedValue ? <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-4 text-sm text-emerald-100"><span className="font-black">Suggested correction:</span> {resolver.issue.resolution.suggestedValue}</div> : null}<label className="block text-xs font-black uppercase tracking-wider text-slate-400">Replacement{resolver.issue.resolution?.control === "enum" ? <select value={replacement} onChange={(event) => setReplacement(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-white">{resolver.issue.resolution.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input type={resolver.issue.resolution?.control === "date" ? "date" : resolver.issue.resolution?.control === "number" ? "number" : "text"} value={replacement} onChange={(event) => setReplacement(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm normal-case tracking-normal text-white" placeholder={resolver.issue.resolution?.expectedFormat}/>}</label><fieldset><legend className="text-xs font-black uppercase tracking-wider text-slate-400">Apply to</legend><div className="mt-2 space-y-2 text-sm text-slate-200">{(["row", "column"] as const).map((scope) => <label key={scope} className="flex items-center gap-3"><input type="radio" checked={resolutionScope === scope} onChange={() => setResolutionScope(scope)} className="accent-blue-600"/>{scope === "row" ? "This row only" : `Every “${resolver.issue.sourceValue}” in ${resolver.issue.sourceColumn}`}</label>)}{resolver.issue.resolution?.allowImportScope ? <label className="flex items-center gap-3"><input type="radio" checked={resolutionScope === "import"} onChange={() => setResolutionScope("import")} className="accent-blue-600"/>All identical values in compatible mapped fields</label> : null}</div></fieldset><button onClick={() => void applyResolution()} disabled={busy || replacement === ""} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={17}/> : <WandSparkles size={17}/>} Apply &amp; Revalidate</button></div>}</div></div> : null}

          {step === "review" && preview ? <section className="p-6 sm:p-8"><div className="mx-auto max-w-3xl"><div className="text-center"><ShieldCheck className="mx-auto h-12 w-12 text-blue-300"/><p className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Administrator review</p><h2 className="mt-2 text-2xl font-black text-white">Approve each decision boundary</h2><p className="mt-2 text-sm text-slate-400">This approval is bound to this file hash, worksheet, header row, mappings, current agency, actor, and validation result.</p></div>
              <div className="mt-7 space-y-3">{([
                ["domain", `I approve ${DOMAIN_LABELS[domain]} as the selected import domain.`],
                ["mappings", `I reviewed the ${mappedCount} active column mappings and ignored columns.`],
                ["validation", `I reviewed ${preview.summary.create} creates, ${preview.summary.update} updates, ${preview.summary.skip} skips, ${preview.summary.warnings} warning rows, and ${overrides.length + rowDecisions.length} approved working-state fixes.`],
                ["finalAction", "I authorize TracePoint to revalidate server-side and perform the displayed database actions."],
              ] as const).map(([key, label]) => <label key={key} className="flex cursor-pointer items-start gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4"><input type="checkbox" checked={approvals[key]} onChange={(event) => setApprovals((current) => ({ ...current, [key]: event.target.checked }))} className="mt-0.5 h-5 w-5 accent-blue-600"/><span className="text-sm font-semibold leading-6 text-slate-200">{label}</span></label>)}</div>
              <div className="mt-7 flex justify-between"><button onClick={() => setStep("validate")} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">Back</button><button disabled={!approvalComplete} onClick={() => setStep("import")} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">Continue to import <ArrowRight size={16}/></button></div>
            </div></section> : null}

          {step === "import" && preview ? <section className="p-6 sm:p-10"><div className="mx-auto max-w-2xl rounded-[2rem] border border-blue-800/70 bg-blue-950/20 p-7 text-center"><LockKeyhole className="mx-auto h-12 w-12 text-blue-300"/><h2 className="mt-5 text-2xl font-black text-white">Ready for final import</h2><p className="mt-3 text-sm leading-6 text-slate-300">TracePoint will validate the current agency records again. If anything changed since preview, the import will stop and ask for a new review.</p><div className="mt-6 grid grid-cols-3 gap-3"><Stat label="Create" value={preview.summary.create} tone="green"/><Stat label="Update" value={preview.summary.update} tone="amber"/><Stat label="Skip" value={preview.summary.skip}/></div><button onClick={() => void execute()} disabled={busy} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={18}/> : <ShieldCheck size={18}/>} {busy ? "Revalidating and importing…" : "Import approved records"}</button><button onClick={() => setStep("review")} disabled={busy} className="mt-3 text-xs font-bold text-slate-400 hover:text-white">Return to review</button></div></section> : null}

          {step === "results" && result ? <section className="p-6 sm:p-10"><div className="text-center"><CheckCircle2 className={`mx-auto h-14 w-14 ${result.failed ? "text-amber-300" : "text-emerald-300"}`}/><p className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-blue-300">Audited import results</p><h2 className="mt-2 text-2xl font-black text-white">{result.failed ? "Import completed with rejected rows" : "Import completed"}</h2><p className="mt-2 text-xs text-slate-500">Job {result.jobId}</p></div><div className="mx-auto mt-7 grid max-w-4xl grid-cols-2 gap-3 md:grid-cols-5"><Stat label="Created" value={result.created} tone="green"/><Stat label="Updated" value={result.updated} tone="blue"/><Stat label="Skipped" value={result.skipped}/><Stat label="Failed" value={result.failed} tone="red"/><Stat label="Warnings" value={result.warnings} tone="amber"/></div>
            {result.failures.length ? <div className="mx-auto mt-6 max-w-4xl rounded-2xl border border-red-800 bg-red-950/20 p-5"><h3 className="font-black text-red-100">Rows not imported</h3><ul className="mt-3 space-y-2 text-sm text-red-200">{result.failures.map((failure) => <li key={failure.rowNumber}>Row {failure.rowNumber}: {failure.message}</li>)}</ul></div> : null}
            <div className="mt-7 flex flex-wrap justify-center gap-3">{result.rejectedRows.length ? <button onClick={() => saveRejected(result)} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200"><Download size={16}/> Download rejected rows</button> : null}<button onClick={reset} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-black text-white"><RotateCcw size={16}/> Start another import</button></div>
          </section> : null}
        </main>
      </div>
    </div>
  </TracePointShell>;
}
