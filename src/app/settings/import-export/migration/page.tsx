"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Files, Layers3, Loader2, LockKeyhole, Play, RefreshCcw, ShieldCheck, Upload, WandSparkles, X } from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import { DOMAIN_LABELS, IMPORT_FIELDS } from "@/lib/ai-importer/catalog";
import { normalizeLabel } from "@/lib/ai-importer/normalize";
import { IMPORT_DOMAINS, type ColumnMapping, type ImportDomain, type ImportExecutionResult, type ValidationIssue } from "@/lib/ai-importer/types";
import type { MigrationWorkspaceState, MigrationWorkspaceView, WorkspaceDashboard, WorkspaceDomainPlan, WorkspaceMergeRule, WorkspaceSource } from "@/lib/ai-importer/workspace-types";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type WorkspacePreview = {
  workspaceId: string;
  status: string;
  dashboard: WorkspaceDashboard;
  readyDomains: ImportDomain[];
  completedDomains: ImportDomain[];
  plans: Array<Omit<WorkspaceDomainPlan, "payload"> & { dependencies: ImportDomain[] }>;
  approvalToken: string;
  workspaceDigest: string;
};
type RecentWorkspace = { id: string; status: string; updatedAt: string; expiresAt: string; fileCount: number };
type Stage = "inventory" | "organize" | "resolve" | "review" | "results";

const STAGES: Array<{ id: Stage; label: string }> = [{ id: "inventory", label: "Inventory" }, { id: "organize", label: "Organize & Map" }, { id: "resolve", label: "Resolve" }, { id: "review", label: "Review Plan" }, { id: "results", label: "Results" }];

function headers(matrix: string[][], headerRow: number) {
  const seen = new Map<string, number>();
  return (matrix[headerRow - 1] ?? []).map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1; seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function mappingsFor(source: WorkspaceSource, domain: ImportDomain, headerRow = source.headerRow): ColumnMapping[] {
  const used = new Set<string>();
  return headers(source.matrix, headerRow).map((sourceColumn, columnIndex) => {
    const normalized = normalizeLabel(sourceColumn);
    const exact = IMPORT_FIELDS[domain].find((field) => !used.has(field.key) && [field.label, ...field.aliases].some((alias) => normalizeLabel(alias) === normalized));
    if (exact) used.add(exact.key);
    return { sourceColumn, targetField: exact?.key ?? null, confidence: exact ? "High" : "Needs Review", samples: source.matrix.slice(headerRow, headerRow + 4).map((row) => row[columnIndex] ?? "").filter(Boolean).slice(0, 3), reason: exact ? "Known field alias." : "Review this header." };
  });
}

async function responseError(response: Response) {
  try { return ((await response.json()) as { error?: string }).error ?? "TracePoint could not complete this step."; } catch { return "TracePoint could not complete this step."; }
}

function Metric({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "green" | "amber" | "red" | "violet" }) {
  const color = { slate: "border-slate-800 text-slate-200", green: "border-emerald-800 text-emerald-200", amber: "border-amber-800 text-amber-200", red: "border-red-800 text-red-200", violet: "border-violet-800 text-violet-200" }[tone];
  return <div className={`rounded-2xl border bg-slate-950/60 p-4 ${color}`}><p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>;
}

export default function MigrationWorkspacePage() {
  const access = useTracePointAccess();
  const [workspace, setWorkspace] = useState<MigrationWorkspaceView | null>(null);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const [previewState, setPreview] = useState<WorkspacePreview | null>(null);
  const preview = previewState!;
  const [stage, setStage] = useState<Stage>("inventory");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedDomains, setSelectedDomains] = useState<ImportDomain[]>([]);
  const [approved, setApproved] = useState(false);
  const [results, setResults] = useState<Partial<Record<ImportDomain, ImportExecutionResult>> | null>(null);
  const [resolver, setResolver] = useState<{ domain: ImportDomain; rowNumber: number; issue: ValidationIssue } | null>(null);
  const [replacement, setReplacement] = useState("");

  useEffect(() => { void (async () => {
    const response = await fetch("/api/settings/ai-importer/workspaces", { credentials: "same-origin" });
    if (response.ok) setRecent(((await response.json()) as { workspaces: RecentWorkspace[] }).workspaces);
  })(); }, []);

  const activeSources = workspace?.state.sources.filter((source) => !source.excluded) ?? [];
  const fileGroups = useMemo(() => [...new Map((workspace?.state.sources ?? []).map((source) => [source.fileId, { fileId: source.fileId, file: source.file }])).values()], [workspace]);
  const currentStage = STAGES.findIndex((item) => item.id === stage);

  async function stageFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(); files.forEach((file) => form.append("files", file));
      const response = await fetch("/api/settings/ai-importer/workspaces", { method: "POST", body: form, credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      setWorkspace(((await response.json()) as { workspace: MigrationWorkspaceView }).workspace); setPreview(null); setStage("inventory");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The migration batch could not be staged."); } finally { setBusy(false); }
  }

  function createWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]; event.target.value = ""; void stageFiles(files);
  }

  async function resume(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/settings/ai-importer/workspaces/${id}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      setWorkspace(((await response.json()) as { workspace: MigrationWorkspaceView }).workspace); setPreview(null); setStage("inventory");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The workspace could not be resumed."); } finally { setBusy(false); }
  }

  function updateState(update: (state: MigrationWorkspaceState) => MigrationWorkspaceState) {
    setWorkspace((current) => current ? { ...current, state: update(current.state) } : current); setPreview(null); setApproved(false);
  }

  async function saveState(state = workspace?.state) {
    if (!workspace || !state) return null;
    const response = await fetch(`/api/settings/ai-importer/workspaces/${workspace.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }), credentials: "same-origin" });
    if (!response.ok) throw new Error(await responseError(response));
    const saved = ((await response.json()) as { workspace: MigrationWorkspaceView }).workspace;
    setWorkspace(saved); return saved;
  }

  async function validateWorkspace(state = workspace?.state) {
    if (!workspace || !state) return;
    setBusy(true); setError("");
    try {
      await saveState(state);
      const response = await fetch(`/api/settings/ai-importer/workspaces/${workspace.id}/preview`, { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as WorkspacePreview; setPreview(data); setSelectedDomains(data.readyDomains); setStage("resolve"); setApproved(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The migration plan could not be validated."); } finally { setBusy(false); }
  }

  function changeSource(sourceId: string, patch: Partial<WorkspaceSource>) {
    updateState((state) => ({ ...state, sources: state.sources.map((source) => source.id === sourceId ? { ...source, ...patch } : source) }));
  }

  function setFileExcluded(fileId: string, excluded: boolean) {
    updateState((state) => ({ ...state, sources: state.sources.map((source) => source.fileId === fileId ? { ...source, excluded } : source) }));
  }

  function changeDomain(source: WorkspaceSource, domain: ImportDomain) {
    changeSource(source.id, { domain, mappings: mappingsFor(source, domain), headerConfidence: "Needs Review" });
  }

  function changeHeader(source: WorkspaceSource, headerRow: number) {
    changeSource(source.id, { headerRow, mappings: mappingsFor(source, source.domain, headerRow), headerConfidence: "Needs Review" });
  }

  function changeMapping(source: WorkspaceSource, sourceColumn: string, targetField: string | null) {
    const now = new Date().toISOString();
    updateState((state) => ({
      ...state,
      sources: state.sources.map((item) => item.id === source.id ? { ...item, mappings: item.mappings.map((mapping) => mapping.sourceColumn === sourceColumn ? { ...mapping, targetField, confidence: "High", reason: "Administrator-approved workspace mapping." } : mapping) } : item),
      sharedMappings: [...state.sharedMappings.filter((rule) => !(rule.domain === source.domain && normalizeLabel(rule.sourceHeader) === normalizeLabel(sourceColumn))), { domain: source.domain, sourceHeader: sourceColumn, targetField, approvedAt: now }],
    }));
  }

  async function applyMerge(rule: WorkspaceMergeRule) {
    if (!workspace) return;
    const state = { ...workspace.state, mergeRules: [...workspace.state.mergeRules.filter((item) => !(item.domain === rule.domain && item.groupKey === rule.groupKey && item.strategy === rule.strategy && (rule.strategy !== "field_source" || item.field === rule.field))), rule] };
    setWorkspace({ ...workspace, state }); await validateWorkspace(state);
  }

  function openResolver(domain: ImportDomain, rowNumber: number, issue: ValidationIssue) {
    setResolver({ domain, rowNumber, issue }); setReplacement(issue.resolution?.suggestedValue ?? issue.resolution?.options?.[0]?.value ?? "");
  }

  function remediationImpact(domain: ImportDomain, field: string, original: string) {
    if (!workspace) return { rows: 0, files: 0 };
    let rows = 0; const files = new Set<string>();
    for (const source of workspace.state.sources.filter((item) => !item.excluded && item.domain === domain)) {
      const mapping = source.mappings.find((item) => item.targetField === field); if (!mapping) continue;
      const index = headers(source.matrix, source.headerRow).indexOf(mapping.sourceColumn);
      const count = source.matrix.slice(source.headerRow).filter((row) => (row[index]?.trim() ?? "") === original).length;
      if (count) { rows += count; files.add(source.fileId); }
    }
    return { rows, files: files.size };
  }

  async function applyRemediation() {
    if (!workspace || !preview || !resolver?.issue.field) return;
    const plan = preview.plans.find((item) => item.domain === resolver.domain);
    const provenance = plan?.provenance[resolver.rowNumber];
    const source = workspace.state.sources.find((item) => item.id === provenance?.sourceId);
    const mapping = source?.mappings.find((item) => item.targetField === resolver.issue.field);
    if (!source || !mapping || !provenance) return;
    const columnIndex = headers(source.matrix, source.headerRow).indexOf(mapping.sourceColumn);
    const originalValue = source.matrix[provenance.sourceRowNumber - 1]?.[columnIndex] ?? "";
    const rule = { sourceId: source.id, rowNumber: provenance.sourceRowNumber, sourceColumn: mapping.sourceColumn, targetField: resolver.issue.field, originalValue, replacementValue: replacement, scope: "workspace" as const, approvedAt: new Date().toISOString() };
    const state = { ...workspace.state, remediations: [...workspace.state.remediations, rule] };
    setWorkspace({ ...workspace, state }); setResolver(null); await validateWorkspace(state);
  }

  async function execute() {
    if (!workspace || !preview || !approved || !selectedDomains.length) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/settings/ai-importer/workspaces/${workspace.id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ domains: selectedDomains, approvalToken: preview.approvalToken, workspaceDigest: preview.workspaceDigest, approval: { domain: true, mappings: true, validation: true, finalAction: true } }) });
      if (!response.ok && response.status !== 207) throw new Error(await responseError(response));
      const data = await response.json() as { results: Partial<Record<ImportDomain, ImportExecutionResult>>; status: MigrationWorkspaceView["status"]; completedDomains: ImportDomain[] };
      setResults(data.results); setWorkspace((current) => current ? { ...current, status: data.status } : current); setStage("results");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The migration could not be executed."); } finally { setBusy(false); }
  }

  if (stage === "resolve" && !preview) return null;

  return <TracePointShell activePage="Settings"><div onDragOver={(event) => { if (!workspace) event.preventDefault(); }} onDrop={(event) => { if (!workspace) { event.preventDefault(); void stageFiles([...event.dataTransfer.files]); } }} className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.18),transparent_38%),linear-gradient(180deg,#020617,#07111f)] px-4 py-8 text-slate-100 sm:px-7 lg:px-10"><div className="mx-auto max-w-[1550px]">
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><Link href="/settings/import-export" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-400 hover:text-white"><ArrowLeft size={14}/> Import &amp; Export</Link><div className="mt-4 flex items-center gap-3"><div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-3"><Layers3 className="text-violet-300"/></div><div><div className="flex items-center gap-2"><p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Migration command center</p><span className="rounded-full border border-violet-500/60 px-2 py-0.5 text-[10px] font-black text-violet-200">BETA</span></div><h1 className="mt-1 text-3xl font-black text-white sm:text-4xl">Multi-File Migration</h1></div></div><p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">Turn a mixed folder of agency exports into one dependency-aware, exception-first migration plan. Raw files are discarded after temporary structured staging.</p></div><div className="space-y-2"><div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-100"><span className="flex items-center gap-2 font-bold"><LockKeyhole size={14}/> Active agency enforced</span><span className="mt-1 block text-emerald-300/70">{access.departmentName || "Verifying access…"}</span></div>{workspace?.state.inference ? <div className={`rounded-full border px-3 py-1 text-center text-xs font-bold ${workspace.state.inference.assistanceMode === "ai-assisted" ? "border-emerald-700 text-emerald-200" : "border-amber-700 text-amber-200"}`}>{workspace.state.inference.statusMessage}</div> : null}</div></header>
    {error ? <div className="mt-5 flex gap-3 rounded-2xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-100"><AlertTriangle className="shrink-0" size={18}/>{error}</div> : null}
    {!workspace ? <main className="mt-7 grid gap-5 lg:grid-cols-[1.25fr_.75fr]"><label className={`flex min-h-96 cursor-pointer flex-col items-center justify-center rounded-[2rem] border border-dashed p-8 text-center ${busy ? "border-violet-600 bg-violet-950/20" : "border-slate-700 bg-slate-900/70 hover:border-violet-500"}`}>{busy ? <Loader2 className="h-12 w-12 animate-spin text-violet-300"/> : <Upload className="h-12 w-12 text-violet-300"/>}<h2 className="mt-5 text-2xl font-black text-white">Upload an agency migration folder</h2><p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">Select up to 50 mixed CSV, XLS, and XLSX files. Maximum 3 MB per file, 25 MB per batch, and 50,000 source rows.</p><span className="mt-6 rounded-xl bg-violet-600 px-5 py-3 text-sm font-black text-white">Choose multiple files</span><input type="file" multiple accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={createWorkspace} disabled={busy || access.loading} className="hidden"/></label><section className="rounded-[2rem] border border-slate-800 bg-slate-900/70 p-6"><h2 className="font-black text-white">Resume a workspace</h2><p className="mt-2 text-xs leading-5 text-slate-400">Structured staging expires after 14 days. No original workbook bytes are retained.</p><div className="mt-5 space-y-3">{recent.length ? recent.map((item) => <button key={item.id} onClick={() => void resume(item.id)} disabled={busy} className="w-full rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-left hover:border-violet-700"><span className="flex items-center justify-between"><strong className="text-sm text-white">{item.fileCount} file{item.fileCount === 1 ? "" : "s"}</strong><span className="text-[10px] font-black uppercase text-violet-300">{item.status.replaceAll("_", " ")}</span></span><span className="mt-2 block text-xs text-slate-500">Updated {new Date(item.updatedAt).toLocaleString()}</span></button>) : <p className="rounded-xl border border-slate-800 p-4 text-sm text-slate-500">No resumable workspaces yet.</p>}</div></section></main> : <>
      <nav className="mt-7 grid grid-cols-2 gap-2 md:grid-cols-5">{STAGES.map((item, index) => <div key={item.id} className={`rounded-xl border px-3 py-2 text-xs font-bold ${index === currentStage ? "border-violet-500 bg-violet-950/30 text-violet-100" : index < currentStage ? "border-emerald-800 text-emerald-300" : "border-slate-800 text-slate-600"}`}>{index < currentStage ? <Check className="mr-2 inline" size={12}/> : null}{item.label}</div>)}</nav>
      {stage === "inventory" ? <main className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900/75 p-6 sm:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Workspace inventory</p><h2 className="mt-2 text-2xl font-black text-white">{fileGroups.length} files · {workspace.state.sources.length} worksheets</h2><p className="mt-2 text-sm text-slate-400">Confirm the likely domain and relevant sheets. Excluded sources remain in the draft but never enter a plan.</p></div><button onClick={() => setStage("organize")} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white">Organize sources</button></div><div className="mt-6 grid gap-4 xl:grid-cols-2">{fileGroups.map(({ fileId, file }) => <section key={fileId} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-black text-white">{file.name}</h3><p className="mt-1 text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB · {file.type || "Spreadsheet"}</p></div><Files className="text-violet-300" size={20}/></div><div className="mt-4 space-y-3">{workspace.state.sources.filter((source) => source.fileId === fileId).map((source) => <div key={source.id} className={`rounded-xl border p-4 ${source.excluded ? "border-slate-800 opacity-50" : "border-slate-700"}`}><div className="flex flex-wrap items-center justify-between gap-3"><div><strong className="text-sm text-slate-100">{source.sheetName}</strong><p className="mt-1 text-xs text-slate-500">{Math.max(0, source.matrix.length - source.headerRow)} likely records · header row {source.headerRow} · {source.headerConfidence}</p></div><label className="flex items-center gap-2 text-xs font-bold text-slate-300"><input type="checkbox" checked={!source.excluded} onChange={(event) => changeSource(source.id, { excluded: !event.target.checked })} className="accent-violet-600"/> Include</label></div><div className="mt-3 grid grid-cols-2 gap-2"><select value={source.domain} onChange={(event) => changeDomain(source, event.target.value as ImportDomain)} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white">{IMPORT_DOMAINS.map((domain) => <option key={domain} value={domain}>{DOMAIN_LABELS[domain]}</option>)}</select><select value={source.headerRow} onChange={(event) => changeHeader(source, Number(event.target.value))} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-xs text-white">{source.matrix.slice(0, 25).map((_, index) => <option key={index} value={index + 1}>Header row {index + 1}</option>)}</select></div></div>)}</div></section>)}</div></main> : null}
      {stage === "organize" ? <main className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900/75 p-6 sm:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Domain grouping &amp; shared mappings</p><h2 className="mt-2 text-2xl font-black text-white">One staged dataset per domain</h2><p className="mt-2 text-sm text-slate-400">An accepted header mapping is reused across sources with the same header in this workspace.</p></div><button onClick={() => void validateWorkspace()} disabled={busy || !activeSources.length} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={16}/> : <RefreshCcw size={16}/>} Build migration plan</button></div>{workspace.state.inference && (workspace.state.inference.relationships.length || workspace.state.inference.sharedMappings.length || workspace.state.inference.remediations.length || workspace.state.inference.merges.length) ? <section className="mt-6 rounded-2xl border border-violet-800/60 bg-violet-950/15 p-5"><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">Inference suggestions</p><p className="mt-2 text-xs leading-5 text-slate-400">Suggestions are review-only. They do not change mappings, resolve conflicts, or create approved rules.</p><div className="mt-4 grid gap-3 lg:grid-cols-2">{workspace.state.inference.relationships.map((suggestion, index) => <div key={`relationship-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-300"><strong className="text-white">Suggested relationship:</strong> {suggestion.relationship.replaceAll("_", " ")} · {suggestion.confidence}<p className="mt-1 text-slate-500">{suggestion.reason}</p></div>)}{workspace.state.inference.sharedMappings.map((suggestion, index) => <div key={`mapping-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-300"><strong className="text-white">Suggested mapping:</strong> {suggestion.sourceHeader} → {suggestion.targetField ? IMPORT_FIELDS[suggestion.domain].find((field) => field.key === suggestion.targetField)?.label ?? suggestion.targetField : "Ignore"} · {suggestion.confidence}<p className="mt-1 text-slate-500">Review in the editable mapping controls below.</p></div>)}{workspace.state.inference.remediations.map((suggestion, index) => <div key={`remediation-${index}`} className="rounded-xl border border-emerald-900/60 bg-emerald-950/15 p-3 text-xs text-emerald-100"><strong>Suggested fix:</strong> {suggestion.sourceValue} → {suggestion.suggestedValue} · {suggestion.confidence}<p className="mt-1 text-emerald-300/60">Review during deterministic validation; never auto-applied.</p></div>)}{workspace.state.inference.merges.map((suggestion, index) => <div key={`merge-${index}`} className="rounded-xl border border-amber-900/60 bg-amber-950/15 p-3 text-xs text-amber-100"><strong>Suggested resolution:</strong> {suggestion.strategy.replaceAll("_", " ")} · {suggestion.confidence}<p className="mt-1 text-amber-300/60">Review after the deterministic overlap plan is built.</p></div>)}</div></section> : null}<div className="mt-6 space-y-6">{IMPORT_DOMAINS.map((domain) => { const sources = activeSources.filter((source) => source.domain === domain); return sources.length ? <section key={domain} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5"><div className="flex items-center justify-between"><h3 className="font-black text-white">{DOMAIN_LABELS[domain]}</h3><span className="text-xs text-slate-500">{sources.length} source{sources.length === 1 ? "" : "s"}</span></div><div className="mt-4 space-y-4">{sources.map((source) => <details key={source.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-slate-200"><span>{source.file.name} · {source.sheetName}</span><ChevronDown size={15}/></summary><div className="mt-4 grid gap-2 lg:grid-cols-2">{source.mappings.map((mapping) => <label key={mapping.sourceColumn} className="grid grid-cols-[1fr_1.2fr] items-center gap-3 rounded-lg border border-slate-800 p-3 text-xs"><span><strong className="block text-slate-200">{mapping.sourceColumn}</strong><span className="text-slate-600">{mapping.samples.join(" · ")}</span></span><select value={mapping.targetField ?? ""} onChange={(event) => changeMapping(source, mapping.sourceColumn, event.target.value || null)} className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-white"><option value="">Ignore</option>{IMPORT_FIELDS[domain].map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>)}</div></details>)}</div></section> : null; })}</div></main> : null}
      {stage === "resolve" && preview ? <main className="mt-6 space-y-5"><section className="rounded-[2rem] border border-slate-800 bg-slate-900/75 p-6 sm:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">Exception-first migration dashboard</p><h2 className="mt-2 text-2xl font-black text-white">What is preventing you from finishing?</h2><p className="mt-2 text-sm text-slate-400">Ready records stay collapsed. Resolve only the exceptions requiring judgment.</p></div><button onClick={() => setStage("review")} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white">Review ready domains</button></div><div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-9"><Metric label="Files" value={preview.dashboard.files}/><Metric label="Domains" value={preview.dashboard.domains}/><Metric label="Source rows" value={preview.dashboard.sourceRows}/><Metric label="Unique" value={preview.dashboard.uniqueRecords} tone="violet"/><Metric label="Ready" value={preview.dashboard.ready} tone="green"/><Metric label="Warnings" value={preview.dashboard.warnings} tone="amber"/><Metric label="Blocked" value={preview.dashboard.blocked} tone="red"/><Metric label="Duplicates" value={preview.dashboard.duplicates} tone="amber"/><Metric label="Conflicts" value={preview.dashboard.conflicts} tone="red"/></div></section>{preview.plans.map((plan) => { const exceptions = plan.preview.rows.filter((row) => row.status !== "valid"); return <section key={plan.domain} className="rounded-[2rem] border border-slate-800 bg-slate-900/75 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xl font-black text-white">{DOMAIN_LABELS[plan.domain]}</h3><p className="mt-1 text-xs text-slate-500">{plan.preview.summary.create} create · {plan.preview.summary.update} update · {plan.preview.summary.skip} skip · {plan.preview.summary.conflict} conflict</p></div>{plan.dependencies.length ? <span className="rounded-full border border-blue-800 px-3 py-1 text-[10px] font-black uppercase text-blue-200">Depends on Personnel</span> : <span className="rounded-full border border-emerald-800 px-3 py-1 text-[10px] font-black uppercase text-emerald-200">Independent</span>}</div>{plan.overlaps.filter((item) => !item.resolved).map((overlap) => <div key={overlap.groupKey} className="mt-4 rounded-xl border border-red-800/60 bg-red-950/15 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-red-100">{overlap.classification.replaceAll("_", " ")} across {overlap.sourceIds.length} sources</p><p className="mt-1 text-xs text-red-300/70">{overlap.conflictingFields.length ? `Conflicting fields: ${overlap.conflictingFields.join(", ")}` : "Values match; explicit duplicate approval is still required."}</p></div><div className="flex flex-wrap gap-2">{overlap.classification === "exact_duplicate" ? <button onClick={() => void applyMerge({ domain: plan.domain, groupKey: overlap.groupKey, strategy: "skip_exact_duplicates", approvedAt: new Date().toISOString() })} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-black text-white">Skip exact duplicates</button> : overlap.classification === "probable_same" ? <button onClick={() => void applyMerge({ domain: plan.domain, groupKey: overlap.groupKey, strategy: "nonblank", approvedAt: new Date().toISOString() })} className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-black text-white">Merge nonblank values</button> : overlap.sourceIds.map((sourceId) => <button key={sourceId} onClick={() => void applyMerge({ domain: plan.domain, groupKey: overlap.groupKey, strategy: "preferred_source", preferredSourceId: sourceId, approvedAt: new Date().toISOString() })} className="rounded-lg border border-violet-700 px-3 py-1.5 text-xs font-bold text-violet-100">Prefer {workspace.state.sources.find((source) => source.id === sourceId)?.file.name}</button>)}</div></div></div>)}{exceptions.length ? <div className="mt-4 space-y-2">{exceptions.slice(0, 100).map((row) => <div key={row.rowNumber} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4"><div className="flex items-center justify-between gap-4"><span className="text-xs font-black text-slate-400">{plan.provenance[row.rowNumber]?.filename} · source row {plan.provenance[row.rowNumber]?.sourceRowNumber}</span><span className={`text-[10px] font-black uppercase ${row.status === "blocked" ? "text-red-300" : "text-amber-200"}`}>{row.status}</span></div><div className="mt-3 space-y-2">{row.issues.map((issue, index) => <div key={index} className="flex items-start justify-between gap-4 text-sm text-slate-300"><span>{issue.message}</span>{issue.resolution ? <button onClick={() => openResolver(plan.domain, row.rowNumber, issue)} className="shrink-0 rounded-lg border border-violet-700 px-2.5 py-1 text-[10px] font-black uppercase text-violet-200">Resolve</button> : null}</div>)}</div></div>)}</div> : <p className="mt-4 rounded-xl border border-emerald-800/50 bg-emerald-950/15 p-4 text-sm text-emerald-200">No exceptions. {plan.preview.summary.total} unique records are ready.</p>}</section>; })}</main> : null}
      {stage === "review" && preview ? <main className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900/75 p-6 sm:p-8"><div className="mx-auto max-w-5xl"><div className="text-center"><ShieldCheck className="mx-auto h-12 w-12 text-violet-300"/><p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-violet-300">Migration plan</p><h2 className="mt-2 text-2xl font-black text-white">Choose ready domains to import</h2><p className="mt-2 text-sm text-slate-400">Blocked domains remain safely staged. Dependencies must run first or in this approved execution.</p></div><div className="mt-7 space-y-3">{preview.plans.map((plan) => { const ready = preview.readyDomains.includes(plan.domain); const completed = preview.completedDomains.includes(plan.domain); return <label key={plan.domain} className={`flex items-center gap-4 rounded-2xl border p-4 ${ready ? "cursor-pointer border-slate-700 bg-slate-950/50" : "border-slate-800 opacity-55"}`}><input type="checkbox" checked={selectedDomains.includes(plan.domain) || completed} disabled={!ready || completed} onChange={(event) => setSelectedDomains((current) => event.target.checked ? [...current, plan.domain] : current.filter((item) => item !== plan.domain))} className="h-5 w-5 accent-violet-600"/><span className="min-w-36 font-black text-white">{DOMAIN_LABELS[plan.domain]}</span><span className="text-sm text-slate-400">{plan.preview.summary.create} create · {plan.preview.summary.update} update · {plan.preview.summary.skip} skip · {plan.preview.summary.blocked} blocked</span><span className="ml-auto text-xs font-black uppercase text-slate-500">{completed ? "Completed" : ready ? "Ready" : "Not ready"}</span></label>; })}</div><label className="mt-6 flex cursor-pointer items-start gap-4 rounded-2xl border border-violet-800/60 bg-violet-950/20 p-5"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} className="mt-0.5 h-5 w-5 accent-violet-600"/><span className="text-sm leading-6 text-slate-200">I reviewed the domain grouping, shared mappings, remediation and merge rules, exceptions, dependencies, and exact planned actions. I authorize server-side revalidation and import of the selected ready domains.</span></label><div className="mt-7 flex justify-between"><button onClick={() => setStage("resolve")} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">Back to exceptions</button><button onClick={() => void execute()} disabled={busy || !approved || !selectedDomains.length} className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-black text-slate-950 disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={17}/> : <Play size={17}/>} Import {selectedDomains.length} ready domain{selectedDomains.length === 1 ? "" : "s"}</button></div></div></main> : null}
      {stage === "results" && results ? <main className="mt-6 rounded-[2rem] border border-slate-800 bg-slate-900/75 p-8"><div className="text-center"><ShieldCheck className="mx-auto h-12 w-12 text-emerald-300"/><h2 className="mt-4 text-2xl font-black text-white">Migration execution complete</h2><p className="mt-2 text-sm text-slate-400">Unresolved domains remain in this workspace for a later session.</p></div><div className="mx-auto mt-7 max-w-4xl space-y-3">{Object.entries(results).map(([domain, result]) => result ? <div key={domain} className="grid grid-cols-[1fr_repeat(4,auto)] gap-5 rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-sm"><strong className="text-white">{DOMAIN_LABELS[domain as ImportDomain]}</strong><span className="text-emerald-300">{result.created} created</span><span className="text-blue-300">{result.updated} updated</span><span className="text-slate-400">{result.skipped} skipped</span><span className="text-red-300">{result.failed} failed</span></div> : null)}</div><div className="mt-7 text-center"><button onClick={() => { setPreview(null); setStage("inventory"); }} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white">Continue workspace</button></div></main> : null}
      {stage === "inventory" ? <section className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/65 p-5"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">File-level controls</p><div className="mt-3 flex flex-wrap gap-2">{fileGroups.map(({ fileId, file }) => { const excluded = workspace.state.sources.filter((source) => source.fileId === fileId).every((source) => source.excluded); return <button key={fileId} onClick={() => setFileExcluded(fileId, !excluded)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${excluded ? "border-slate-800 text-slate-500" : "border-violet-800 text-violet-200"}`}>{excluded ? "Include" : "Exclude"} {file.name}</button>; })}</div></section> : null}
      {stage === "resolve" && preview.plans.some((plan) => plan.overlaps.some((overlap) => !overlap.resolved)) ? <section className="mt-5 rounded-[2rem] border border-violet-800/50 bg-violet-950/15 p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">Approved bulk precedence</p><h2 className="mt-2 text-lg font-black text-white">Resolve similar overlap groups by domain</h2><p className="mt-1 text-xs text-slate-400">Each action shows its domain boundary, is saved as an explicit rule, and revalidates the whole workspace.</p><div className="mt-4 grid gap-3 lg:grid-cols-2">{preview.plans.filter((plan) => plan.overlaps.some((overlap) => !overlap.resolved)).map((plan) => <div key={plan.domain} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex items-center justify-between"><strong className="text-sm text-white">{DOMAIN_LABELS[plan.domain]}</strong><span className="text-xs text-slate-500">{plan.overlaps.filter((overlap) => !overlap.resolved).length} overlap groups</span></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void applyMerge({ domain: plan.domain, strategy: "skip_exact_duplicates", approvedAt: new Date().toISOString() })} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200">Skip all exact duplicates</button><button onClick={() => void applyMerge({ domain: plan.domain, strategy: "newest", approvedAt: new Date().toISOString() })} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200">Newest source wins</button><button onClick={() => void applyMerge({ domain: plan.domain, strategy: "existing", approvedAt: new Date().toISOString() })} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200">Keep existing TracePoint values</button><select defaultValue="" onChange={(event) => { if (event.target.value) void applyMerge({ domain: plan.domain, strategy: "preferred_source", preferredSourceId: event.target.value, approvedAt: new Date().toISOString() }); }} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200"><option value="">Prefer source file…</option>{[...new Set(plan.overlaps.flatMap((overlap) => overlap.sourceIds))].map((sourceId) => <option key={sourceId} value={sourceId}>{workspace.state.sources.find((source) => source.id === sourceId)?.file.name}</option>)}</select></div></div>)}</div></section> : null}
      {stage === "resolve" && preview.plans.some((plan) => plan.overlaps.some((overlap) => !overlap.resolved && overlap.conflictingFields.length)) ? <section className="mt-5 rounded-[2rem] border border-slate-800 bg-slate-900/75 p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Field-level decisions</p><h2 className="mt-2 text-lg font-black text-white">Choose a source only where values disagree</h2><div className="mt-4 space-y-3">{preview.plans.flatMap((plan) => plan.overlaps.filter((overlap) => !overlap.resolved && overlap.conflictingFields.length).map((overlap) => <div key={overlap.groupKey} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-sm font-black text-white">{DOMAIN_LABELS[plan.domain]} · {overlap.sourceRows.length} matching source rows</p><div className="mt-3 grid gap-2 md:grid-cols-2">{overlap.conflictingFields.map((field) => <label key={field} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3 text-xs text-slate-300"><span>{IMPORT_FIELDS[plan.domain].find((item) => item.key === field)?.label ?? field}</span><select defaultValue="" onChange={(event) => { if (event.target.value) void applyMerge({ domain: plan.domain, groupKey: overlap.groupKey, strategy: "field_source", field, preferredSourceId: event.target.value, approvedAt: new Date().toISOString() }); }} className="max-w-60 rounded-lg border border-slate-700 bg-slate-950 p-2 text-white"><option value="">Choose source…</option>{overlap.sourceIds.map((sourceId) => <option key={sourceId} value={sourceId}>{workspace.state.sources.find((source) => source.id === sourceId)?.file.name}</option>)}</select></label>)}</div></div>))}</div></section> : null}
    </>}
    {resolver && workspace && preview ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-xl rounded-[2rem] border border-slate-700 bg-slate-900 p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">Shared remediation</p><h3 className="mt-2 text-xl font-black text-white">{IMPORT_FIELDS[resolver.domain].find((field) => field.key === resolver.issue.field)?.label}</h3></div><button onClick={() => setResolver(null)} className="text-slate-400"><X size={18}/></button></div><div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-xs text-slate-500">Source value</p><p className="mt-1 font-black text-white">{resolver.issue.sourceValue || "Blank"}</p><p className="mt-3 text-sm text-slate-300">{resolver.issue.message}</p></div>{resolver.issue.resolution?.suggestedValue ? <p className="mt-4 rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-3 text-sm text-emerald-200"><strong>Suggested:</strong> {resolver.issue.resolution.suggestedValue}</p> : null}<label className="mt-4 block text-xs font-black uppercase text-slate-400">Replace with{resolver.issue.resolution?.control === "enum" ? <select value={replacement} onChange={(event) => setReplacement(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm normal-case text-white">{resolver.issue.resolution.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <input type={resolver.issue.resolution?.control === "date" ? "date" : resolver.issue.resolution?.control === "number" ? "number" : "text"} value={replacement} onChange={(event) => setReplacement(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm normal-case text-white"/>}</label>{resolver.issue.field ? <p className="mt-4 text-xs text-violet-200">This will resolve {remediationImpact(resolver.domain, resolver.issue.field, resolver.issue.sourceValue ?? "").rows} matching rows across {remediationImpact(resolver.domain, resolver.issue.field, resolver.issue.sourceValue ?? "").files} files.</p> : null}<button onClick={() => void applyRemediation()} disabled={!replacement || busy} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-black text-white disabled:opacity-40"><WandSparkles size={16}/> Approve workspace mapping &amp; Revalidate</button></div></div> : null}
  </div></div></TracePointShell>;
}
