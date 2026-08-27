"use client";

import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Loader2,
} from "lucide-react";

export default function QuickQualificationCamera({
  qualificationResultId,
}: {
  qualificationResultId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  function openCamera() {
    if (!qualificationResultId) {
      window.alert(
        "Save this scoring run before attaching a target photo.",
      );
      return;
    }

    inputRef.current?.click();
  }

  async function uploadPhoto(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file || !qualificationResultId) {
      event.target.value = "";
      return;
    }

    setSaving(true);

    try {
      const form = new FormData();
      form.set("file", file);
      form.set(
        "description",
        "Target photo captured during live scoring.",
      );

      const response = await fetch(
        `/api/qualifications/${encodeURIComponent(
          qualificationResultId,
        )}/evidence`,
        {
          method: "POST",
          body: form,
        },
      );

      const payload = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload.error ??
            "The target photo could not be uploaded.",
        );
      }

      setUploaded(true);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "The target photo could not be uploaded.",
      );
    } finally {
      setSaving(false);
      event.target.value = "";
    }
  }

  const title = qualificationResultId
    ? uploaded
      ? "Target photo attached"
      : "Take or attach target photo"
    : "Save this scoring run before attaching a photo";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        onChange={(event) => void uploadPhoto(event)}
      />

      <button
        type="button"
        onClick={openCamera}
        disabled={saving}
        title={title}
        aria-label={title}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition ${
          uploaded
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : qualificationResultId
              ? "border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
              : "border-slate-700 bg-slate-900 text-slate-600 hover:text-slate-400"
        } disabled:cursor-wait disabled:opacity-60`}
      >
        {saving ? (
          <Loader2 size={15} className="animate-spin" />
        ) : uploaded ? (
          <CheckCircle2 size={15} />
        ) : (
          <Camera size={15} />
        )}
      </button>
    </>
  );
}