"use client";

import { ChevronRight } from "lucide-react";

export default function CollapsibleTableGroupHeader({
  label,
  count,
  expanded,
  onToggle,
  summary,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  summary?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center gap-2 bg-slate-950/70 px-4 py-2 text-left text-xs font-semibold text-slate-300 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
    >
      <ChevronRight
        className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
        aria-hidden="true"
      />
      <span>{label}</span>
      <span className="text-slate-500">— {count}</span>
      {summary ? <span className="hidden text-slate-500 sm:inline">· {summary}</span> : null}
    </button>
  );
}
