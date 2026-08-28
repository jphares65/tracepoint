"use client";
import { Award, CheckCircle2, Download, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Props = { eventId: string; eventStatus: string; canManage: boolean; onClosed: () => void };
type TrainingFile = { id: string; attachment_type: string; file_name: string; file_size: number };
type Certificate = { id: string; certificate_number: string; fullName: string; revoked_at: string | null };

export default function AgencyTrainingCloseoutPanel({ eventId, eventStatus, canManage, onClosed }: Props) {
  const [files, setFiles] = useState<TrainingFile[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState("lesson_plan");
  const input = useRef<HTMLInputElement>(null);
  const completed = eventStatus === "completed";

  const load = useCallback(async () => {
    const response = await fetch(`/api/agency-training/events/${encodeURIComponent(eventId)}/files`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setError(payload.error || "Training files could not be loaded."); return; }
    setFiles(payload.files ?? []); setCertificates(payload.certificates ?? []);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file || busy) return;
    setBusy(true); setError(""); setMessage("");
    const form = new FormData(); form.set("file", file); form.set("kind", kind);
    const response = await fetch(`/api/agency-training/events/${encodeURIComponent(eventId)}/files`, { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(payload.error || "File upload failed."); return; }
    if (input.current) input.current.value = ""; setMessage("Training file attached."); await load();
  }

  async function archive(id: string) {
    const reason = window.prompt("Reason for removing this training file:");
    if (!reason) return;
    const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setError(payload.error || "File could not be removed."); return; }
    await load();
  }

  async function closeout() {
    if (busy || !window.confirm("Complete this training event? Results will lock and eligible certifications will be issued.")) return;
    setBusy(true); setError(""); setMessage("");
    const response = await fetch(`/api/agency-training/events/${encodeURIComponent(eventId)}/closeout`, { method: "POST" });
    const payload = await response.json().catch(() => ({})); setBusy(false);
    if (!response.ok) { setError(payload.error || "Training closeout failed."); return; }
    const result = payload.closeout ?? {};
    setMessage(`Training completed. ${result.certifications ?? 0} certification record(s) and ${result.certificates ?? 0} certificate(s) processed.`);
    await load(); onClosed();
  }

  return <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">Documentation & Closeout</p><h3 className="mt-1 text-sm font-bold text-white">Training Record Package</h3></div>
      <div className="flex flex-wrap gap-2">
        <a href={`/api/agency-training/events/${encodeURIComponent(eventId)}/report`} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 hover:border-blue-500/50"><Download size={14}/> Event CSV</a>
        {canManage && !completed ? <button type="button" onClick={() => void closeout()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>} Complete Event</button> : null}
      </div>
    </div>
    {error ? <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div> : null}
    {message ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{message}</div> : null}
    {canManage && !completed ? <div className="grid gap-2 sm:grid-cols-[170px_1fr_auto]">
      <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"><option value="lesson_plan">Lesson Plan</option><option value="supporting_document">Supporting File</option></select>
      <input ref={input} type="file" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-1 file:text-xs file:font-bold file:text-white"/>
      <button type="button" onClick={() => void upload()} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-500/40 px-3 py-2 text-xs font-bold text-blue-200"><Upload size={14}/> Attach</button>
    </div> : null}
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-800 p-3"><p className="mb-2 flex items-center gap-2 text-xs font-bold text-white"><Paperclip size={14}/> Attached Files</p>{files.length ? <div className="space-y-2">{files.map((file) => <div key={file.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/60 px-3 py-2"><a href={`/api/attachments/${file.id}/download`} className="min-w-0 truncate text-xs text-blue-300 hover:text-blue-200"><FileText size={13} className="mr-2 inline"/>{file.file_name}</a>{canManage && !completed ? <button onClick={() => void archive(file.id)} className="text-slate-500 hover:text-rose-300" aria-label="Remove file"><Trash2 size={13}/></button> : null}</div>)}</div> : <p className="text-xs text-slate-500">No files attached.</p>}</div>
      <div className="rounded-xl border border-slate-800 p-3"><p className="mb-2 flex items-center gap-2 text-xs font-bold text-white"><Award size={14}/> Generated Certificates</p>{certificates.filter((item) => !item.revoked_at).length ? <div className="space-y-2">{certificates.filter((item) => !item.revoked_at).map((certificate) => <a key={certificate.id} href={`/api/agency-training/events/${encodeURIComponent(eventId)}/certificates/${certificate.id}`} className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2 text-xs text-blue-300 hover:text-blue-200"><span className="truncate">{certificate.fullName}</span><Download size={13}/></a>)}</div> : <p className="text-xs text-slate-500">Certificates appear after eligible closeout.</p>}</div>
    </div>
  </div>;
}