"use client";

export type InspectionChoiceTone = "pass" | "fail" | "warn" | "neutral";

type InspectionChoiceControlProps<T extends string> = {
  itemLabel: string;
  value: T | null;
  options: { value: T; label?: string; tone: InspectionChoiceTone }[];
  onChange: (value: T) => void;
  disabled?: boolean;
};

const ACTIVE: Record<InspectionChoiceTone, string> = {
  pass: "border-emerald-500 bg-emerald-500/10 text-emerald-200",
  fail: "border-red-500 bg-red-500/10 text-red-200",
  warn: "border-amber-500 bg-amber-500/10 text-amber-200",
  neutral: "border-slate-500 bg-slate-700/30 text-slate-200",
};

// UX-RB-2: one explicit answer per checklist item. No option is selected until
// the inspector chooses one, and "Not inspected" is shown until then.
export default function InspectionChoiceControl<T extends string>({
  itemLabel,
  value,
  options,
  onChange,
  disabled = false,
}: InspectionChoiceControlProps<T>) {
  return (
    <div role="group" aria-label={itemLabel} className="flex flex-wrap items-center gap-2">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`min-h-10 min-w-14 rounded-xl border px-3 text-[12px] font-semibold transition disabled:opacity-60 ${
              active ? ACTIVE[option.tone] : "border-slate-700 text-slate-400 hover:border-blue-500/50 hover:text-white"
            }`}
          >
            {option.label ?? option.value}
          </button>
        );
      })}
      {value === null ? (
        <span className="text-[11px] font-semibold text-amber-300">Not inspected</span>
      ) : null}
    </div>
  );
}
