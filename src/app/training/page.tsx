import Link from "next/link";
import { Award, BellRing, BookOpenCheck, CalendarRange, ClipboardCheck, History } from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

const cards = [
  {
    title: "Training History",
    description: "Review completed training and qualification records across the department.",
    href: "/qualifications",
    icon: History,
  },
  {
    title: "Qualifications",
    description: "Open the existing qualification history, scores, and status workspace.",
    href: "/qualifications",
    icon: ClipboardCheck,
  },
  {
    title: "Certifications",
    description: "Track credentials, expiration dates, documents, and renewal reminders.",
    href: "/training/certifications",
    icon: Award,
  },
  {
    title: "Training Requirements",
    description: "Recurring agency requirements such as MATS, BJJ, OC, ASP, and less-lethal training.",
    href: "/training#requirements",
    icon: BookOpenCheck,
    comingSoon: true,
  },
  {
    title: "Range Days",
    description: "Plan and document range events, activities, attendance, and scoring.",
    href: "/range-days",
    icon: CalendarRange,
  },
  {
    title: "Training Alerts",
    description: "Review qualification, remediation, and training-related action items.",
    href: "/training-alerts",
    icon: BellRing,
  },
];

export default function TrainingPage() {
  return (
    <TracePointShell activePage="Training">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-400">Operational Readiness</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Training</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Manage qualifications, certifications, recurring requirements, and the records that prove officer readiness.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon;
            const content = (
              <div className="h-full rounded-2xl border border-slate-800 bg-slate-950/50 p-6 transition hover:border-blue-500/40 hover:bg-slate-900/70">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
                    <Icon size={21} className="text-blue-400" />
                  </div>
                  {card.comingSoon ? (
                    <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Coming next</span>
                  ) : null}
                </div>
                <h2 className="mt-5 text-lg font-semibold text-white">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{card.description}</p>
              </div>
            );

            return card.comingSoon ? (
              <div key={card.title} id="requirements" aria-disabled="true">{content}</div>
            ) : (
              <Link key={card.title} href={card.href}>{content}</Link>
            );
          })}
        </div>
      </div>
    </TracePointShell>
  );
}
