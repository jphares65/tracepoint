"use client";

import Link from "next/link";
import { useState } from "react";
import TracePointShell from "@/components/TracePointShell";
import {
  ArrowRightLeft,
  RotateCcw,
  Target,
  PlusCircle,
  X,
  Shield,
  CalendarRange,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Quick-action config
//   "route" → navigate via Link
//   "modal" → open placeholder modal
// ---------------------------------------------------------------------------

const QUICK_ACTIONS = [
  {
    category: "Firearms",
    label: "Issue Firearm",
    action: "modal" as const,
    modalTitle: "Issue Firearm",
    modalDescription:
      "The Issue Firearm workflow is under active development. It will be available as a guided modal form in the Firearms Repository module.",
    icon: ArrowRightLeft,
  },
  {
    category: "Firearms",
    label: "Return / RTS",
    action: "modal" as const,
    modalTitle: "Return / RTS",
    modalDescription:
      "The Return to Service workflow is under active development. It will be available as a guided modal form in the Firearms Repository module.",
    icon: RotateCcw,
  },
  {
    category: "Qualifications",
    label: "Record Qual",
    action: "modal" as const,
    modalTitle: "Record Qualification",
    modalDescription:
      "The qualification recording workflow is under active development and will be available in the Qualifications module.",
    icon: Target,
  },
  {
    category: "Training",
    label: "Range Days",
    action: "route" as const,
    href: "/range-days",
    icon: CalendarRange,
  },
  {
    category: "Inspections",
    label: "New Inspection",
    action: "modal" as const,
    modalTitle: "New Inspection",
    modalDescription:
      "The inspection workflow is under active development and will be available in the Inspections module.",
    icon: PlusCircle,
  },
  {
    category: "Off-Duty",
    label: "Add Off-Duty Firearm",
    action: "route" as const,
    href: "/off-duty-firearms",
    icon: Shield,
  },
] as const;

// ---------------------------------------------------------------------------
// Placeholder modal
// Replace with a real drawer/form once the workflow is built.
// ---------------------------------------------------------------------------

function PlaceholderModal({
  title,
  description,
  onClose,
}: {
  title: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-white"
        >
          <X size={16} />
        </button>

        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Coming Soon
        </p>

        <h3 className="pr-8 text-xl font-bold text-white">{title}</h3>

        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          {description}
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-slate-800 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-700"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard screen
// ---------------------------------------------------------------------------

function DashboardScreen({
  onOpenModal,
}: {
  onOpenModal: (title: string, description: string) => void;
}) {
  const kpiCards = [
    {
      label: "Readiness",
      value: "92%",
      color: "text-emerald-400",
      sub: "Compliant",
      href: "/qualifications",
    },
    {
      label: "Quals Due",
      value: "5",
      color: "text-amber-400",
      sub: "Spring cycle",
      href: "/qualifications",
    },
    {
      label: "Rifle Fam Due",
      value: "12",
      color: "text-red-400",
      sub: "Past due",
      href: "/qualifications",
    },
    {
      label: "Out of Service",
      value: "2",
      color: "text-orange-400",
      sub: "Maintenance",
      href: "/firearms",
    },
    {
      label: "Off-Duty",
      value: "2",
      color: "text-blue-400",
      sub: "Pending approval",
      href: "/off-duty-firearms",
    },
    {
      label: "Open Items",
      value: "6",
      color: "text-slate-300",
      sub: "Need attention",
      href: "/qualifications",
    },
  ];

  const openItems = [
    {
      text: "Off. Smith — Spring qual overdue",
      href: "/qualifications",
      dot: "bg-red-500",
      label: "Quals",
      textCls: "text-red-400",
    },
    {
      text: "Off. Walsh — personal firearm insp. overdue",
      href: "/off-duty-firearms",
      dot: "bg-red-500",
      label: "Off-Duty",
      textCls: "text-red-400",
    },
    {
      text: "Rifle #142 — Out of Service",
      href: "/firearms",
      dot: "bg-orange-500",
      label: "Firearms",
      textCls: "text-orange-400",
    },
    {
      text: "2 off-duty approvals expiring in 30 days",
      href: "/off-duty-firearms",
      dot: "bg-amber-500",
      label: "Off-Duty",
      textCls: "text-amber-400",
    },
    {
      text: "RMR battery inspection due in 7 days",
      href: "/inspections",
      dot: "bg-amber-500",
      label: "Insp.",
      textCls: "text-amber-400",
    },
    {
      text: "1 off-duty approval pending review",
      href: "/off-duty-firearms",
      dot: "bg-blue-500",
      label: "Off-Duty",
      textCls: "text-slate-400",
    },
  ];

  return (
    <div className="w-full min-w-0 space-y-4 sm:space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6">
        {kpiCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="group min-w-0 cursor-pointer rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 transition-all duration-200 hover:-translate-y-px hover:border-blue-500/25 hover:bg-slate-800/70 hover:shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
          >
            <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-600 transition-colors duration-200 group-hover:text-slate-500">
              {card.label}
            </p>

            <p className={`mt-1 text-2xl font-bold leading-none ${card.color}`}>
              {card.value}
            </p>

            <p className="mt-0.5 truncate text-[10px] text-slate-600">
              {card.sub}
            </p>
          </Link>
        ))}
      </div>

      {/* Open Items + Quick Actions */}
      <div className="grid min-w-0 gap-3 xl:grid-cols-5">
        {/* Open Items */}
        <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 xl:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
            <h3 className="text-[11.5px] font-semibold tracking-wide text-white">
              Open Items
            </h3>

            <span className="rounded-full bg-slate-800 px-1.5 py-px text-[9px] font-semibold text-slate-400">
              6
            </span>
          </div>

          <div className="divide-y divide-slate-800/40">
            {openItems.map((item) => (
              <Link
                key={item.text}
                href={item.href}
                className="flex min-w-0 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-slate-800/50 sm:py-1.5"
              >
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${item.dot}`}
                />

                <span
                  className={`min-w-0 flex-1 truncate text-[11.5px] leading-snug ${item.textCls}`}
                >
                  {item.text}
                </span>

                <span className="hidden flex-shrink-0 rounded bg-slate-800/50 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-slate-700 min-[420px]:inline">
                  {item.label}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 xl:col-span-2">
          <div className="border-b border-slate-800 px-4 py-2.5">
            <h3 className="text-[11.5px] font-semibold tracking-wide text-white">
              Quick Actions
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-2 p-2 min-[420px]:grid-cols-2">
            {QUICK_ACTIONS.map((qa) => {
              const btnCls =
                "group flex min-h-[48px] min-w-0 items-center gap-2 rounded-lg border border-slate-800 bg-slate-800/20 px-2.5 py-2 text-left transition-all duration-200 hover:-translate-y-px hover:border-blue-500/30 hover:bg-blue-500/[0.07] hover:shadow-[0_2px_8px_rgba(0,0,0,0.25),0_0_0_1px_rgba(59,130,246,0.08)]";

              const inner = (
                <>
                  <qa.icon
                    size={13}
                    className="flex-shrink-0 text-slate-500 transition-colors duration-200 group-hover:text-blue-400"
                  />

                  <div className="min-w-0">
                    <p className="truncate text-[8px] font-semibold uppercase leading-none tracking-widest text-slate-700">
                      {qa.category}
                    </p>

                    <p className="mt-px truncate text-[11px] font-semibold leading-tight text-slate-300">
                      {qa.label}
                    </p>
                  </div>
                </>
              );

              if (qa.action === "route") {
                return (
                  <Link key={qa.label} href={qa.href} className={btnCls}>
                    {inner}
                  </Link>
                );
              }

              return (
                <button
                  key={qa.label}
                  type="button"
                  className={btnCls}
                  onClick={() =>
                    onOpenModal(qa.modalTitle, qa.modalDescription)
                  }
                >
                  {inner}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Operational Snapshot */}
      <div className="min-w-0">
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-slate-700">
          Operational Snapshot
        </p>

        <div className="grid min-w-0 gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {/* Card 1 — Qual Completion */}
          <Link
            href="/qualifications"
            className="group min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-all duration-150 hover:border-slate-700 hover:bg-slate-800/50"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Qual Completion
              </p>

              <span className="rounded bg-emerald-500/10 px-1.5 py-px text-[9px] font-semibold text-emerald-500">
                Spring
              </span>
            </div>

            <p className="mt-1.5 text-[28px] font-bold leading-none tracking-tight text-emerald-400">
              92%
            </p>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="h-full w-[92%] rounded-full bg-emerald-500/55" />
            </div>

            <div className="mt-2 space-y-1 border-t border-slate-800/60 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-slate-500">Complete</span>
                <span className="text-[10.5px] font-semibold text-slate-300">
                  37 / 42
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-slate-500">Pending</span>
                <span className="text-[10.5px] font-semibold text-amber-400">
                  5 officers
                </span>
              </div>
            </div>
          </Link>

          {/* Card 2 — Upcoming */}
          <Link
            href="/range-days"
            className="group min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-all duration-150 hover:border-slate-700 hover:bg-slate-800/50"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Upcoming
            </p>

            <div className="mt-2.5 space-y-2">
              {[
                {
                  label: "Rifle Fam.",
                  date: "May 22",
                  dot: "bg-blue-500",
                  dateColor: "text-blue-400",
                },
                {
                  label: "Range Day",
                  date: "May 29",
                  dot: "bg-blue-500",
                  dateColor: "text-blue-400",
                },
                {
                  label: "Insp. Reminders",
                  date: "This week",
                  dot: "bg-amber-500",
                  dateColor: "text-amber-400",
                },
              ].map((r) => (
                <div
                  key={r.label}
                  className="flex min-w-0 items-center justify-between gap-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${r.dot}`}
                    />

                    <span className="truncate text-[11.5px] text-slate-400">
                      {r.label}
                    </span>
                  </div>

                  <span
                    className={`flex-shrink-0 rounded bg-slate-800 px-1.5 py-px text-[9px] font-semibold ${r.dateColor}`}
                  >
                    {r.date}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-2.5 border-t border-slate-800/60 pt-2">
              <p className="text-[10px] text-slate-700">
                2 range days scheduled this month
              </p>
            </div>
          </Link>

          {/* Card 3 — Recent Activity */}
          <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Recent Activity
            </p>

            <div className="mt-2.5 space-y-2">
              {[
                {
                  text: "Ptl. Smith — handgun qual complete",
                  time: "2h ago",
                  dot: "bg-emerald-500",
                },
                {
                  text: "Rifle #142 returned to service",
                  time: "Today",
                  dot: "bg-blue-500",
                },
                {
                  text: "Off-duty firearm approved",
                  time: "Today",
                  dot: "bg-emerald-500",
                },
                {
                  text: "Inspection logged — RMR",
                  time: "Yesterday",
                  dot: "bg-slate-600",
                },
              ].map((entry) => (
                <div
                  key={entry.text}
                  className="flex min-w-0 items-start justify-between gap-2"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span
                      className={`mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${entry.dot}`}
                    />

                    <span className="min-w-0 text-[11px] leading-snug text-slate-400">
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

          {/* Card 4 — Inventory */}
          <Link
            href="/firearms"
            className="group min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-all duration-150 hover:border-slate-700 hover:bg-slate-800/50"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Inventory
              </p>

              <span className="rounded bg-slate-800 px-1.5 py-px text-[9px] font-semibold text-slate-500">
                58 tracked
              </span>
            </div>

            <p className="mt-1.5 text-[28px] font-bold leading-none tracking-tight text-slate-200">
              98%
            </p>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div className="h-full w-[98%] rounded-full bg-blue-500/45" />
            </div>

            <div className="mt-2 space-y-1 border-t border-slate-800/60 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-slate-500">
                  Accounted for
                </span>

                <span className="text-[10.5px] font-semibold text-slate-300">
                  56 / 58
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10.5px] text-slate-500">
                  Out of service
                </span>

                <span className="text-[10.5px] font-semibold text-orange-400">
                  2 firearms
                </span>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

export default function Home() {
  const [modal, setModal] = useState<{
    title: string;
    description: string;
  } | null>(null);

  return (
    <TracePointShell activePage="Dashboard">
      {modal && (
        <PlaceholderModal
          title={modal.title}
          description={modal.description}
          onClose={() => setModal(null)}
        />
      )}

      <div className="w-full min-w-0 space-y-5">
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[20px] font-bold leading-tight text-white sm:text-[22px]">
              Operational Overview
            </h1>

            <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-slate-500">
              Current status, exceptions, and core workflows.
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[10px] text-slate-700">
                Updated 2 min ago
              </span>

              <span className="hidden text-slate-800 sm:inline">·</span>

              <span className="text-[10px] text-slate-700">
                Spring cycle closes in 24 days
              </span>

              <span className="hidden text-slate-800 sm:inline">·</span>

              <span className="inline-flex items-center gap-1 text-[10px] text-slate-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                System Healthy
              </span>
            </div>
          </div>

          <span className="w-fit rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold text-blue-400">
            Spring 2026
          </span>
        </header>

        <DashboardScreen
          onOpenModal={(title, description) => setModal({ title, description })}
        />
      </div>
    </TracePointShell>
  );
}