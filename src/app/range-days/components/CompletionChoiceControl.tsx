"use client";

import { displayedCompletion } from "@/lib/range/scoring-rules";

type CompletionChoiceControlProps = {
  scoringFormat: string;
  completed?: boolean;
  officerName: string;
  compact?: boolean;
  disabled?: boolean;
  onChange: (completed: boolean) => void;
};

// UX-RB-1: an explicit Complete / Incomplete choice. What is highlighted is
// exactly what will be saved; a Completion drill starts with neither chosen.
export default function CompletionChoiceControl({
  scoringFormat,
  completed,
  officerName,
  compact = false,
  disabled = false,
  onChange,
}: CompletionChoiceControlProps) {
  const choice = displayedCompletion(scoringFormat, completed);
  const size = compact ? "px-2 py-2 text-[11px]" : "px-3 py-3 text-[12px]";
  const option = (value: boolean, label: string, active: boolean, activeClass: string) => (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onChange(value)}
      className={`flex-1 rounded-xl border font-semibold disabled:opacity-60 ${size} ${
        active ? activeClass : "border-slate-700 text-slate-400"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div role="group" aria-label={`Completion for ${officerName}`} className="flex flex-col gap-1">
      <div className="flex gap-1">
        {option(true, "Complete", choice === "complete", "border-emerald-500/40 bg-emerald-500/10 text-emerald-300")}
        {option(false, "Incomplete", choice === "incomplete", "border-amber-500/40 bg-amber-500/10 text-amber-300")}
      </div>
      {choice === "not_recorded" ? (
        <span className="text-[11px] font-semibold text-slate-400">Not recorded</span>
      ) : null}
    </div>
  );
}
