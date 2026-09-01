"use client";
/* eslint-disable @next/next/no-img-element -- signed tenant images are dynamic previews, not page assets */

import { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, FileImage, FileText, Loader2, Paperclip, Trash2, Upload, X } from "lucide-react";

type DrillDocument = {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

export default function DrillDocuments({ drillTemplateId, compact = false }: { drillTemplateId: string; compact?: boolean }) {
  const [documents, setDocuments] = useState<DrillDocument[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<DrillDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const endpoint = `/api/drill-library/${encodeURIComponent(drillTemplateId)}/documents`;
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as { documents?: DrillDocument[]; canManage?: boolean };
    setDocuments(payload.documents ?? []);
    setCanManage(Boolean(payload.canManage));
  }, [endpoint]);

  useEffect(() => {
    // Loading is an external API synchronization; state changes occur after I/O.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError("");
    const form = new FormData(); form.append("file", file);
    const response = await fetch(endpoint, { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setError(payload.error ?? "The document could not be uploaded.");
    else await load();
    setBusy(false);
  }

  async function remove(document: DrillDocument) {
    if (!window.confirm(`Delete ${document.original_filename}? This removes the stored file and cannot be undone.`)) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/drill-documents/${document.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setError(payload.error ?? "The document could not be deleted.");
    else { if (selected?.id === document.id) setSelected(null); await load(); }
    setBusy(false);
  }

  if (compact && documents.length === 0) return null;
  if (!compact && documents.length === 0 && !canManage) return null;

  return (
    <>
      <button type="button" onClick={() => { setSelected(documents[0] ?? null); setOpen(true); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-500/40 px-3 py-2 text-[12px] font-semibold text-blue-200 hover:bg-blue-500/10">
        <Paperclip size={14} /> Documents ({documents.length})
      </button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Drill documents" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[95dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-slate-700 bg-slate-900 shadow-2xl sm:max-h-[90vh] sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3 sm:px-5">
              <div><h2 className="text-base font-bold text-white">Drill Documents ({documents.length})</h2><p className="text-xs text-slate-400">Diagrams and instructions for this Drill Library template.</p></div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close documents"><X size={20} /></button>
            </div>
            <div className="grid min-h-0 flex-1 md:grid-cols-[280px_minmax(0,1fr)]">
              <div className="overflow-y-auto border-b border-slate-800 p-3 md:border-b-0 md:border-r">
                {canManage ? <label className="mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-500"><Upload size={14} />{busy ? "Working..." : "Upload document"}<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} className="sr-only" onChange={(event) => void upload(event.target.files?.[0])} /></label> : null}
                {error ? <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200">{error}</p> : null}
                <div className="space-y-2">
                  {documents.map((document) => <div key={document.id} className={`rounded-xl border p-3 ${selected?.id === document.id ? "border-blue-500/50 bg-blue-500/10" : "border-slate-800 bg-slate-950/40"}`}>
                    <button type="button" onClick={() => setSelected(document)} className="flex w-full min-w-0 items-center gap-2 text-left"><span className="text-blue-300">{document.mime_type.startsWith("image/") ? <FileImage size={16} /> : <FileText size={16} />}</span><span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{document.original_filename}</span></button>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>{(document.file_size / 1024 / 1024).toFixed(1)} MB</span><span className="flex gap-1"><a href={`/api/drill-documents/${document.id}/download`} className="rounded-lg p-1.5 hover:bg-slate-800 hover:text-blue-200" aria-label={`Download ${document.original_filename}`}><Download size={14} /></a>{canManage ? <button type="button" disabled={busy} onClick={() => void remove(document)} className="rounded-lg p-1.5 hover:bg-red-500/10 hover:text-red-300" aria-label={`Delete ${document.original_filename}`}><Trash2 size={14} /></button> : null}</span></div>
                  </div>)}
                  {!documents.length ? <p className="py-8 text-center text-xs text-slate-500">No documents attached.</p> : null}
                </div>
              </div>
              <div className="min-h-[45vh] overflow-hidden bg-slate-950/60 p-3 sm:p-4">
                {selected ? <div className="flex h-full min-h-[45vh] flex-col"><div className="mb-2 flex items-center justify-between gap-2"><p className="truncate text-xs font-semibold text-white">{selected.original_filename}</p><a href={`/api/drill-documents/${selected.id}/view`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-300">Open <ExternalLink size={12} /></a></div>{selected.mime_type.startsWith("image/") ? <img src={`/api/drill-documents/${selected.id}/view`} alt={selected.original_filename} className="min-h-0 flex-1 rounded-xl object-contain" /> : <iframe title={selected.original_filename} src={`/api/drill-documents/${selected.id}/view`} className="min-h-[55vh] w-full flex-1 rounded-xl border border-slate-800 bg-white" />}</div> : <div className="flex min-h-[45vh] items-center justify-center text-center text-xs text-slate-500">{busy ? <Loader2 className="animate-spin" /> : "Select a document to preview it."}</div>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
