"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Download, FileImage, FileText, Loader2, Paperclip, Upload } from "lucide-react";

type Attachment = {
  id: string; attachment_type: string; file_name: string; mime_type: string; file_size: number;
  description?: string | null; uploaded_by_user_id: string; uploaded_at: string;
};

const CATEGORIES = [
  ["acquisition", "Acquisition"], ["transfer_disposition", "Transfer / Disposition"],
  ["maintenance_repair", "Maintenance / Repair"], ["inspection", "Inspection"],
  ["photo", "Photograph"], ["other", "Other"],
] as const;

function label(value: string) { return CATEGORIES.find(([key]) => key === value)?.[1] ?? "Other"; }
function size(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export default function FirearmAttachments({ firearmId }: { firearmId: string }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("transfer_disposition");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/armory/firearms/${firearmId}/attachments`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Documents could not be loaded.");
      setItems(payload.attachments ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Documents could not be loaded."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [firearmId]);

  async function upload() {
    if (!file) { setError("Choose a PDF or image first."); return; }
    setSaving(true); setError(null);
    try {
      const form = new FormData(); form.set("file", file); form.set("attachmentType", category); form.set("description", description);
      const response = await fetch(`/api/armory/firearms/${firearmId}/attachments`, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Upload failed.");
      setFile(null); setDescription(""); if (inputRef.current) inputRef.current.value = ""; await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setSaving(false); }
  }

  async function archive(item: Attachment) {
    if (!window.confirm(`Archive ${item.file_name}? The audit history will be preserved.`)) return;
    const response = await fetch(`/api/attachments/${item.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Removed from active firearm record" }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setError(payload.error ?? "Document could not be archived."); return; }
    await load();
  }

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><Paperclip className="h-5 w-5 text-slate-400"/><h3 className="font-bold text-white">Documents & Evidence</h3></div>
          <p className="mt-1 text-xs leading-5 text-slate-500">Keep acquisition, transfer, repair, inspection, and photographic records with this firearm.</p></div>
        <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-400">{items.length} FILE{items.length === 1 ? "" : "S"}</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none">
          {CATEGORIES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
        <div className="min-w-0">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="sr-only"
            id={`firearm-attachment-${firearmId}`}
          />
          <label
            htmlFor={`firearm-attachment-${firearmId}`}
            className="inline-flex cursor-pointer items-center rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
          >
            Choose File
          </label>
          {file && (
            <p className="mt-1 truncate text-[11px] text-slate-500" title={file.name}>
              {file.name}
            </p>
          )}
        </div>
      </div>
      <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Optional description (e.g., Transfer to ABC Police Department)" className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none" />
      <button type="button" onClick={() => void upload()} disabled={saving || !file} className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin"/> : <Upload className="h-4 w-4"/>} Upload Document
      </button>

      {error && <p className="mt-3 rounded-2xl border border-red-900 bg-red-950/30 p-3 text-xs text-red-300">{error}</p>}
      <div className="mt-4 space-y-2">
        {loading ? <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin"/>Loading documentsâ€¦</div> : items.length === 0 ?
          <div className="rounded-2xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">No documents attached yet.</div> :
          items.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3">
            {item.mime_type.startsWith("image/") ? <FileImage className="h-5 w-5 shrink-0 text-slate-400"/> : <FileText className="h-5 w-5 shrink-0 text-slate-400"/>}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-100">{item.file_name}</p>
              <p className="text-[11px] text-slate-500">{label(item.attachment_type)} â€¢ {size(item.file_size)} â€¢ {new Date(item.uploaded_at).toLocaleDateString()}</p>
              {item.description && <p className="mt-1 text-xs text-slate-400">{item.description}</p>}</div>
            <a href={`/api/attachments/${item.id}/download`} className="rounded-xl border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" title="Download"><Download className="h-4 w-4"/></a>
            <button type="button" onClick={() => void archive(item)} className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:border-red-900 hover:text-red-300" title="Archive"><Archive className="h-4 w-4"/></button>
          </div>) }
      </div>
    </div>
  );
}

