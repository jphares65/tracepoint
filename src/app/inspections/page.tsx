"use client";

import { useState } from "react";
import Link from "next/link";
import TracePointShell from "@/components/TracePointShell";
import {
  Plus,
  X,
  ChevronDown,
  Battery,
  Wrench,
  RotateCcw,
  Download,
  ArrowUpRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InspectionResult = "Pass" | "Fail" | "Complete" | "Maintenance";

type InspectionType =
  | "Function / Cleaning"
  | "RMR Battery"
  | "Weapon Light"
  | "Annual Inspection"
  | "Armorer Review";

type QueuePriority = "overdue" | "today" | "soon" | "upcoming";

type ChecklistKey =
  | "functionCheck"
  | "cleaning"
  | "rmrBattery"
  | "weaponLight";

interface InspectionQueueItem {
  id: string;
  firearm: string;
  serial: string;
  dueLabel: string;
  priority: QueuePriority;
  type: InspectionType;
}

interface InspectionRecord {
  id: string;
  date: string;
  firearm: string;
  serial: string;
  type: InspectionType;
  inspector: string;
  result: InspectionResult;
  notes: string;
}

interface InspectionForm {
  firearm: string;
  type: InspectionType | "";
  inspector: string;
  date: string;
  functionCheck: boolean;
  cleaning: boolean;
  rmrBattery: boolean;
  weaponLight: boolean;
  result: InspectionResult | "";
  notes: string;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_QUEUE: InspectionQueueItem[] = [
  {
    id: "q1",
    firearm: "Sig Sauer P320",
    serial: "SIG7731",
    dueLabel: "Overdue",
    priority: "overdue",
    type: "RMR Battery",
  },
  {
    id: "q2",
    firearm: "Patrol Rifle #142",
    serial: "RFL142",
    dueLabel: "Due today",
    priority: "today",
    type: "Weapon Light",
  },
  {
    id: "q3",
    firearm: "Glock 17 Gen5",
    serial: "GBR4921",
    dueLabel: "Due in 3 days",
    priority: "soon",
    type: "Function / Cleaning",
  },
  {
    id: "q4",
    firearm: "Remington 870",
    serial: "REM8834",
    dueLabel: "Due in 7 days",
    priority: "upcoming",
    type: "Annual Inspection",
  },
];

const MOCK_HISTORY: InspectionRecord[] = [
  {
    id: "h1",
    date: "May 16, 2026",
    firearm: "Glock 17 Gen5",
    serial: "GBR4921",
    type: "Function / Cleaning",
    inspector: "Off. Smith",
    result: "Pass",
    notes: "No issues found.",
  },
  {
    id: "h2",
    date: "May 15, 2026",
    firearm: "Sig Sauer P320",
    serial: "SIG7731",
    type: "RMR Battery",
    inspector: "Sgt. Rivera",
    result: "Complete",
    notes: "Battery replaced. CR2032.",
  },
  {
    id: "h3",
    date: "May 14, 2026",
    firearm: "Patrol Rifle #142",
    serial: "RFL142",
    type: "Weapon Light",
    inspector: "Armorer",
    result: "Maintenance",
    notes: "Switch issue noted. Sent to armorer.",
  },
  {
    id: "h4",
    date: "May 14, 2026",
    firearm: "Remington 870",
    serial: "REM8834",
    type: "Annual Inspection",
    inspector: "Sgt. Rivera",
    result: "Pass",
    notes: "Annual complete. All functions checked.",
  },
  {
    id: "h5",
    date: "May 12, 2026",
    firearm: "Glock 26 Gen5",
    serial: "GLK0080",
    type: "Function / Cleaning",
    inspector: "Off. Martinez",
    result: "Pass",
    notes: "Routine cleaning.",
  },
  {
    id: "h6",
    date: "May 10, 2026",
    firearm: "S&W 686 Plus",
    serial: "SW29401",
    type: "Armorer Review",
    inspector: "Armorer",
    result: "Maintenance",
    notes: "Cylinder timing issue. Retained.",
  },
];

const FIREARM_OPTIONS = [
  "Glock 17 Gen5 — GBR4921",
  "Glock 19 Gen4 — GBR5503",
  "Glock 17 Gen5 — GBR6102",
  "S&W M&P Shield — SW22819",
  "S&W 686 Plus — SW29401",
  "Remington 870 Express — REM8834",
  "Sig Sauer P320 — SIG7731",
  "Sig Sauer P226 — SIG7890",
  "Colt LE6920 — AR15112",
  "Patrol Rifle #142 — RFL142",
  "Beretta 92FS — BER0041",
  "Glock 26 Gen5 — GLK0080",
  "Winchester SXP — WIN4490",
  "Sig Sauer MCX — SIG8821",
];

const INSPECTOR_OPTIONS = [
  "Off. Smith",
  "Sgt. Rivera, M.",
  "Lt. Brooks, C.",
  "Det. Patel, A.",
  "Off. Chen, D.",
  "Off. Martinez, K.",
  "Armorer",
];

const INSPECTION_TYPES: InspectionType[] = [
  "Function / Cleaning",
  "RMR Battery",
  "Weapon Light",
  "Annual Inspection",
  "Armorer Review",
];

const EMPTY_FORM: InspectionForm = {
  firearm: "",
  type: "",
  inspector: "",
  date: "",
  functionCheck: false,
  cleaning: false,
  rmrBattery: false,
  weaponLight: false,
  result: "",
  notes: "",
};

// ---------------------------------------------------------------------------
// Badge config
// ---------------------------------------------------------------------------

const RESULT_CFG: Record<InspectionResult, { cls: string; dot: string }> = {
  Pass: {
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dot: "bg-emerald-400",
  },
  Complete: {
    cls: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dot: "bg-blue-400",
  },
  Fail: {
    cls: "bg-red-500/15 text-red-300 border-red-500/30",
    dot: "bg-red-400",
  },
  Maintenance: {
    cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dot: "bg-amber-400",
  },
};

const TYPE_CFG: Record<InspectionType, string> = {
  "Function / Cleaning": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "RMR Battery": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Weapon Light": "bg-violet-500/10 text-violet-400 border-violet-500/20",
  "Annual Inspection":
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "Armorer Review": "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const PRIORITY_CFG: Record<
  QueuePriority,
  { dot: string; textCls: string; labelCls: string }
> = {
  overdue: {
    dot: "bg-red-500",
    textCls: "text-red-400",
    labelCls: "text-red-400",
  },
  today: {
    dot: "bg-orange-500",
    textCls: "text-orange-400",
    labelCls: "text-orange-400",
  },
  soon: {
    dot: "bg-amber-500",
    textCls: "text-amber-400",
    labelCls: "text-amber-400",
  },
  upcoming: {
    dot: "bg-slate-500",
    textCls: "text-slate-300",
    labelCls: "text-slate-500",
  },
};

// ---------------------------------------------------------------------------
// Small components
// ---------------------------------------------------------------------------

function ResultBadge({ result }: { result: InspectionResult }) {
  const cfg = RESULT_CFG[result];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {result}
    </span>
  );
}

function TypePill({ type }: { type: InspectionType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${TYPE_CFG[type]}`}
    >
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// New Inspection Modal
// ---------------------------------------------------------------------------

function NewInspectionModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (record: InspectionRecord) => void;
}) {
  const [form, setForm] = useState<InspectionForm>(EMPTY_FORM);

  const patch = (update: Partial<InspectionForm>) => {
    setForm((current) => ({ ...current, ...update }));
  };

  const canSave = Boolean(
    form.firearm && form.type && form.inspector && form.date && form.result,
  );

  function handleChecklistChange(key: ChecklistKey, value: boolean) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSave() {
    if (!canSave) return;

    const parts = form.firearm.split(" — ");
    const serial = parts[1] ?? "";
    const firearm = parts[0] ?? form.firearm;

    onSave({
      id: `insp-${Date.now()}`,
      date: new Date(form.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      firearm,
      serial,
      type: form.type as InspectionType,
      inspector: form.inspector,
      result: form.result as InspectionResult,
      notes: form.notes,
    });

    onClose();
  }

  const selectClass =
    "w-full appearance-none rounded-xl border border-slate-800 bg-slate-900 py-2 pl-3 pr-8 text-[12px] text-white outline-none transition-colors focus:border-blue-500 cursor-pointer";

  const inputClass =
    "w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[12px] text-white outline-none placeholder:text-slate-600 transition-colors focus:border-blue-500";

  const checkboxClass =
    "flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-800 px-3 py-2 transition-colors hover:border-slate-700";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-white">
              New Inspection
            </h3>

            <p className="mt-0.5 text-[11px] text-slate-500">
              Log a firearm inspection record.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Firearm *
            </label>

            <div className="relative">
              <select
                value={form.firearm}
                onChange={(e) => patch({ firearm: e.target.value })}
                className={selectClass}
              >
                <option value="">Select firearm…</option>
                {FIREARM_OPTIONS.map((firearm) => (
                  <option key={firearm}>{firearm}</option>
                ))}
              </select>

              <ChevronDown
                size={11}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Inspection Type *
              </label>

              <div className="relative">
                <select
                  value={form.type}
                  onChange={(e) =>
                    patch({ type: e.target.value as InspectionType | "" })
                  }
                  className={selectClass}
                >
                  <option value="">Select type…</option>
                  {INSPECTION_TYPES.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>

                <ChevronDown
                  size={11}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Inspector *
              </label>

              <div className="relative">
                <select
                  value={form.inspector}
                  onChange={(e) => patch({ inspector: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Select…</option>
                  {INSPECTOR_OPTIONS.map((inspector) => (
                    <option key={inspector}>{inspector}</option>
                  ))}
                </select>

                <ChevronDown
                  size={11}
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Date *
            </label>

            <input
              type="date"
              value={form.date}
              onChange={(e) => patch({ date: e.target.value })}
              className={inputClass}
              style={{ colorScheme: "dark" }}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Checklist
            </label>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { key: "functionCheck", label: "Function Check" },
                { key: "cleaning", label: "Cleaning Completed" },
                { key: "rmrBattery", label: "RMR Battery Checked" },
                { key: "weaponLight", label: "Weapon Light Checked" },
              ].map(({ key, label }) => {
                const typedKey = key as ChecklistKey;

                return (
                  <label
                    key={key}
                    className={`${checkboxClass} ${
                      form[typedKey] ? "border-blue-500/30 bg-blue-500/5" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form[typedKey]}
                      onChange={(e) =>
                        handleChecklistChange(typedKey, e.target.checked)
                      }
                      className="h-3.5 w-3.5 cursor-pointer accent-blue-500"
                    />

                    <span className="text-[11px] text-slate-300">
                      {label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Result *
            </label>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["Pass", "Complete", "Fail", "Maintenance"] as const).map(
                (result) => (
                  <button
                    key={result}
                    type="button"
                    onClick={() => patch({ result })}
                    className={`rounded-xl border py-2 text-[11px] font-semibold transition-all ${
                      form.result === result
                        ? result === "Pass" || result === "Complete"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                          : result === "Fail"
                            ? "border-red-500/40 bg-red-500/10 text-red-400"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-400"
                        : "border-slate-800 text-slate-500 hover:border-slate-700"
                    }`}
                  >
                    {result}
                  </button>
                ),
              )}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Notes
            </label>

            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Observations, issues, follow-up required…"
              className={`${inputClass} resize-none`}
            />
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-800 px-4 py-2 text-[12px] text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            className={`rounded-xl px-5 py-2 text-[12px] font-semibold transition ${
              canSave
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "cursor-not-allowed bg-slate-800 text-slate-600"
            }`}
          >
            Save Inspection
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InspectionsPage() {
  const [showModal, setShowModal] = useState(false);
  const [history, setHistory] = useState<InspectionRecord[]>(MOCK_HISTORY);

  function handleSave(record: InspectionRecord) {
    setHistory((prev) => [record, ...prev]);
  }

  function handleAction(action: string) {
    console.log(`[TracePoint] inspection action="${action}"`);
  }

  const quickActions = [
    {
      label: "New Inspection",
      category: "Inspections",
      icon: Plus,
      action: () => setShowModal(true),
    },
    {
      label: "Log Battery Change",
      category: "Maintenance",
      icon: Battery,
      action: () => handleAction("battery"),
    },
    {
      label: "Mark Maintenance",
      category: "Firearms",
      icon: Wrench,
      action: () => handleAction("maintenance"),
    },
    {
      label: "Return to Service",
      category: "Firearms",
      icon: RotateCcw,
      action: () => handleAction("rts"),
    },
    {
      label: "View OOS Firearms",
      category: "Firearms",
      icon: ArrowUpRight,
      action: () => handleAction("oos"),
    },
    {
      label: "Export Log",
      category: "Reports",
      icon: Download,
      action: () => handleAction("export"),
    },
  ];

  const kpiCards = [
    {
      label: "Due This Week",
      value: 2,
      color: "text-amber-400",
      sub: "Action required",
    },
    {
      label: "Overdue",
      value: 1,
      color: "text-red-400",
      sub: "Immediate action",
    },
    {
      label: "Completed This Month",
      value: 14,
      color: "text-emerald-400",
      sub: "May 2026",
    },
    {
      label: "RMR Batteries Due",
      value: 3,
      color: "text-amber-400",
      sub: "Check scheduled",
    },
    {
      label: "Lights Due",
      value: 2,
      color: "text-amber-400",
      sub: "Weapon lights",
    },
    {
      label: "OOS Linked",
      value: 2,
      color: "text-orange-400",
      sub: "Via maintenance",
    },
  ];

  return (
    <TracePointShell activePage="Inspections">
      {showModal && (
        <NewInspectionModal
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}

      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold leading-tight text-white sm:text-[22px]">
                Inspections
              </h1>

              <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-slate-500">
                Inspection status, maintenance readiness, and firearm condition
                history.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-700">
                <span>Updated 2 min ago</span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span className="text-amber-600">
                  2 inspections due this week
                </span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                  System Healthy
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-500 sm:w-fit"
            >
              <Plus size={14} />
              New Inspection
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className="group cursor-default rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 transition-all duration-200 hover:-translate-y-px hover:border-blue-500/25 hover:bg-slate-800/70 hover:shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 transition-colors group-hover:text-slate-500">
                {card.label}
              </p>

              <p className={`mt-1 text-2xl font-bold leading-none ${card.color}`}>
                {card.value}
              </p>

              <p className="mt-0.5 text-[10px] text-slate-600">{card.sub}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-3 xl:grid-cols-5">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 xl:col-span-3">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
              <h3 className="text-[11.5px] font-semibold tracking-wide text-white">
                Inspection Queue
              </h3>

              <span className="rounded-full bg-slate-800 px-1.5 py-px text-[9px] font-semibold text-slate-400">
                {MOCK_QUEUE.length}
              </span>
            </div>

            <div className="divide-y divide-slate-800/40">
              {MOCK_QUEUE.map((item) => {
                const priority = PRIORITY_CFG[item.priority];

                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-slate-800/50 md:flex-row md:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span
                        className={`mt-[6px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${priority.dot}`}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span
                            className={`truncate text-[12px] font-medium ${priority.textCls}`}
                          >
                            {item.firearm}
                          </span>

                          <span className="flex-shrink-0 font-mono text-[10px] text-slate-600">
                            {item.serial}
                          </span>
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className={`text-[10.5px] ${priority.labelCls}`}>
                            {item.dueLabel}
                          </span>

                          <TypePill type={item.type} />
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowModal(true)}
                      className="w-full flex-shrink-0 rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2 text-[11px] font-medium text-slate-400 transition hover:border-blue-500/30 hover:text-blue-400 md:w-auto md:px-2 md:py-1 md:text-[10px]"
                    >
                      Log
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 xl:col-span-2">
            <div className="border-b border-slate-800 px-4 py-2.5">
              <h3 className="text-[11.5px] font-semibold tracking-wide text-white">
                Quick Actions
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-2 p-2 min-[420px]:grid-cols-2">
              {quickActions.map((qa) => (
                <button
                  key={qa.label}
                  type="button"
                  onClick={qa.action}
                  className="group flex min-h-[48px] items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/20 px-2.5 py-2 text-left transition-all duration-200 hover:-translate-y-px hover:border-blue-500/30 hover:bg-blue-500/[0.07] hover:shadow-[0_2px_8px_rgba(0,0,0,0.25),0_0_0_1px_rgba(59,130,246,0.08)]"
                >
                  <qa.icon
                    size={12}
                    className="flex-shrink-0 text-slate-500 transition-colors duration-200 group-hover:text-blue-400"
                  />

                  <div className="min-w-0">
                    <p className="text-[8px] font-semibold uppercase leading-none tracking-widest text-slate-700">
                      {qa.category}
                    </p>

                    <p className="mt-px truncate text-[11px] font-semibold leading-tight text-slate-300">
                      {qa.label}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-slate-700">
            Operational Snapshot
          </p>

          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <div className="group rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-all duration-150 hover:border-slate-700 hover:bg-slate-800/50">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Inspection Compliance
                </p>

                <span className="rounded bg-emerald-500/10 px-1.5 py-px text-[9px] font-semibold text-emerald-500">
                  May
                </span>
              </div>

              <p className="mt-1.5 text-[28px] font-bold leading-none tracking-tight text-emerald-400">
                84%
              </p>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full w-[84%] rounded-full bg-emerald-500/55" />
              </div>

              <div className="mt-2 space-y-1 border-t border-slate-800/60 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-slate-500">
                    Current
                  </span>
                  <span className="text-[10.5px] font-semibold text-slate-300">
                    49 / 58
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-slate-500">
                    Due / Overdue
                  </span>
                  <span className="text-[10.5px] font-semibold text-amber-400">
                    9 firearms
                  </span>
                </div>
              </div>
            </div>

            <div className="group rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-all duration-150 hover:border-slate-700 hover:bg-slate-800/50">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Battery Checks
              </p>

              <div className="mt-2.5 space-y-2">
                {[
                  {
                    label: "RMR",
                    value: "3 due",
                    dot: "bg-amber-500",
                    valCls: "text-amber-400",
                  },
                  {
                    label: "Weapon Light",
                    value: "2 due",
                    dot: "bg-amber-500",
                    valCls: "text-amber-400",
                  },
                  {
                    label: "Next batch",
                    value: "This week",
                    dot: "bg-blue-500",
                    valCls: "text-blue-400",
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${row.dot}`}
                      />

                      <span className="truncate text-[11.5px] text-slate-400">
                        {row.label}
                      </span>
                    </div>

                    <span
                      className={`flex-shrink-0 rounded bg-slate-800 px-1.5 py-px text-[9px] font-semibold ${row.valCls}`}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-2.5 border-t border-slate-800/60 pt-2">
                <p className="text-[10px] text-slate-700">
                  5 total battery checks due
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Recent Activity
              </p>

              <div className="mt-2.5 space-y-2">
                {[
                  {
                    text: "Off. Smith — Glock inspection complete",
                    time: "2h ago",
                    dot: "bg-emerald-500",
                  },
                  {
                    text: "RMR battery replaced — SIG7731",
                    time: "Today",
                    dot: "bg-blue-500",
                  },
                  {
                    text: "Rifle #142 marked maintenance",
                    time: "Yesterday",
                    dot: "bg-amber-500",
                  },
                  {
                    text: "Remington 870 annual inspection logged",
                    time: "Yesterday",
                    dot: "bg-emerald-500",
                  },
                ].map((entry) => (
                  <div
                    key={entry.text}
                    className="flex items-start justify-between gap-2"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <span
                        className={`mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${entry.dot}`}
                      />

                      <span className="text-[11px] leading-snug text-slate-400">
                        {entry.text}
                      </span>
                    </div>

                    <span className="flex-shrink-0 whitespace-nowrap pt-px text-[9px] text-slate-700">
                      {entry.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <Link
              href="/firearms"
              className="group rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-all duration-150 hover:border-slate-700 hover:bg-slate-800/50"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Maintenance Status
                </p>

                <span className="rounded bg-slate-800 px-1.5 py-px text-[9px] font-semibold text-slate-500">
                  → Firearms
                </span>
              </div>

              <p className="mt-1.5 text-[28px] font-bold leading-none tracking-tight text-orange-400">
                2
              </p>

              <p className="mt-0.5 text-[11px] text-slate-500">
                firearms currently OOS
              </p>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div className="h-full w-[96%] rounded-full bg-orange-500/35" />
              </div>

              <div className="mt-2 space-y-1 border-t border-slate-800/60 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-slate-500">
                    Pending armorer review
                  </span>

                  <span className="text-[10.5px] font-semibold text-slate-300">
                    1
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-slate-500">
                    Returned this week
                  </span>

                  <span className="text-[10.5px] font-semibold text-emerald-400">
                    1
                  </span>
                </div>
              </div>
            </Link>
          </div>
        </section>

        <section>
          <div className="mb-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
              Inspection History
            </p>

            <button
              type="button"
              onClick={() => handleAction("export")}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-800 px-3 py-1.5 text-[11px] text-slate-500 transition hover:border-slate-700 hover:text-slate-300 sm:w-fit"
            >
              <Download size={11} />
              Export
            </button>
          </div>

          <div className="space-y-2 lg:hidden">
            {history.map((row) => (
              <article
                key={row.id}
                className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-500">{row.date}</p>
                    <h3 className="mt-0.5 truncate text-[14px] font-semibold text-white">
                      {row.firearm}
                    </h3>
                    <p className="mt-1 font-mono text-[10px] text-slate-600">
                      {row.serial}
                    </p>
                  </div>

                  <ResultBadge result={row.result} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <TypePill type={row.type} />
                  <span className="text-[11px] text-slate-500">
                    {row.inspector}
                  </span>
                </div>

                <p className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                  {row.notes || "—"}
                </p>
              </article>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead className="bg-slate-900/80">
                  <tr>
                    {[
                      "Date",
                      "Firearm",
                      "Serial",
                      "Type",
                      "Inspector",
                      "Result",
                      "Notes",
                    ].map((col) => (
                      <th
                        key={col}
                        className="border-b border-slate-800 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/60">
                  {history.map((row) => (
                    <tr
                      key={row.id}
                      className="group cursor-pointer transition-colors duration-100 hover:bg-slate-800/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-slate-400">
                        {row.date}
                      </td>

                      <td className="px-4 py-3 text-[12px] font-medium text-slate-200">
                        {row.firearm}
                      </td>

                      <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                        {row.serial}
                      </td>

                      <td className="px-4 py-3">
                        <TypePill type={row.type} />
                      </td>

                      <td className="px-4 py-3 text-[11.5px] text-slate-400">
                        {row.inspector}
                      </td>

                      <td className="px-4 py-3">
                        <ResultBadge result={row.result} />
                      </td>

                      <td className="max-w-[240px] truncate px-4 py-3 text-[11px] text-slate-500">
                        {row.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-2.5 text-[11px] text-slate-600">
              <span>Showing {history.length} records</span>

              <div className="flex items-center gap-1">
                {["‹", "1", "›"].map((page, index) => (
                  <button
                    key={`${page}-${index}`}
                    type="button"
                    className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg border text-[11px] transition-colors ${
                      page === "1"
                        ? "border-blue-500 bg-blue-500 text-white"
                        : "border-slate-800 bg-transparent text-slate-600 hover:border-slate-700 hover:text-slate-300"
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}