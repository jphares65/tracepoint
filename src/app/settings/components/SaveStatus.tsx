"use client";

// SV-29 / E-04: the result of a Settings save, shown beside the Save button
// that was pressed. It stays until the next edit or save; it is never cleared
// by the refresh that follows a save.
export type SaveResult = { tone: "success" | "error"; message: string } | null;

export default function SaveStatus({
  name,
  result,
  dirty,
}: {
  /** What the button saves, e.g. "Off-Duty Rules"; names the status region. */
  name: string;
  result: SaveResult;
  dirty: boolean;
}) {
  const unsaved = dirty ? (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
      Unsaved changes
    </span>
  ) : null;
  if (result?.tone === "error") {
    return (
      <>
        <p role="alert" aria-label={`${name} save status`} className="text-xs font-semibold text-red-300">
          {result.message}
        </p>
        {unsaved}
      </>
    );
  }
  if (unsaved) return unsaved;
  if (result?.tone === "success") {
    return (
      <p role="status" aria-label={`${name} save status`} className="text-xs font-semibold text-emerald-300">
        {result.message}
      </p>
    );
  }
  return null;
}
