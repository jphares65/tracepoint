"use client";

import { useRef, useState } from "react";
import { Archive, Camera, ChevronDown, Download, Image as ImageIcon, Loader2, Upload } from "lucide-react";

type EvidenceAttachment = {
  id: string;
  attachment_type: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  description?: string | null;
  uploaded_at: string;
};

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function QualificationEvidence({
  qualificationResultId,
}: {
  qualificationResultId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<EvidenceAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/qualifications/${encodeURIComponent(qualificationResultId)}/evidence`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error ?? "Target evidence could not be loaded.");
      }
      setItems(Array.isArray(payload.attachments) ? payload.attachments : []);
      setLoaded(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Target evidence could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) await load();
  }

  async function upload() {
    if (files.length === 0) {
      setError("Choose at least one target photo first.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        form.set("description", description);

        const response = await fetch(
          `/api/qualifications/${encodeURIComponent(qualificationResultId)}/evidence`,
          { method: "POST", body: form },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error ?? `Could not upload ${file.name}.`);
        }
      }

      setFiles([]);
      setDescription("");
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(item: EvidenceAttachment) {
    if (!window.confirm(`Archive ${item.file_name}? The audit history will be preserved.`)) {
      return;
    }

    const response = await fetch(`/api/attachments/${item.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Removed from active qualification evidence" }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(payload.error ?? "Target evidence could not be archived.");
      return;
    }

    await load();
  }

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-950/30">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Camera size={14} className="shrink-0 text-blue-400" />
          <span className="text-[11px] font-semibold text-slate-300">Target Evidence</span>
          {loaded && items.length > 0 && (
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
              {items.length} photo{items.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-slate-800/80 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <input
                ref={inputRef}
                id={`qualification-evidence-${qualificationResultId}`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
              <label
                htmlFor={`qualification-evidence-${qualificationResultId}`}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
              >
                <Camera size={14} />
                Take / Choose Target Photo
              </label>
              {files.length > 0 && (
                <p className="mt-1 truncate text-[10px] text-slate-500">
                  {files.length === 1 ? files[0].name : `${files.length} photos selected`}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void upload()}
              disabled={saving || files.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload
            </button>
          </div>

          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={300}
            placeholder="Optional note (e.g., Q target — handgun qualification)"
            className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-200 outline-none placeholder:text-slate-600"
          />

          {error && (
            <p className="mt-2 rounded-xl border border-red-900 bg-red-950/30 px-3 py-2 text-[10px] text-red-300">
              {error}
            </p>
          )}

          <div className="mt-3 space-y-2">
            {loading ? (
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <Loader2 size={13} className="animate-spin" /> Loading target evidenceâ€¦
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-[10px] text-slate-600">
                No target photos attached to this qualification yet.
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5"
                >
                  <ImageIcon size={16} className="shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-slate-200">
                      {item.file_name}
                    </p>
                    <p className="text-[9px] text-slate-600">
                      {formatSize(item.file_size)} · {new Date(item.uploaded_at).toLocaleDateString()}
                    </p>
                    {item.description && (
                      <p className="mt-0.5 truncate text-[10px] text-slate-500">{item.description}</p>
                    )}
                  </div>
                  <a
                    href={`/api/attachments/${item.id}/download`}
                    title="Download photo"
                    className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <Download size={13} />
                  </a>
                  <button
                    type="button"
                    onClick={() => void archive(item)}
                    title="Archive photo"
                    className="rounded-lg border border-slate-700 p-1.5 text-slate-500 hover:border-red-900 hover:text-red-300"
                  >
                    <Archive size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

