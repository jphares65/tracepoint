import {
  Award,
  CalendarDays,
  CheckCircle2,
  FileText,
  GraduationCap,
  Users,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

const metrics = [
  {
    label: "Scheduled Events",
    value: "0",
    detail: "Upcoming agency training events",
    icon: CalendarDays,
  },
  {
    label: "Personnel Scheduled",
    value: "0",
    detail: "Current roster assignments",
    icon: Users,
  },
  {
    label: "Certifications",
    value: "0",
    detail: "Credentials generated from events",
    icon: Award,
  },
  {
    label: "Completed Events",
    value: "0",
    detail: "Closed training records",
    icon: CheckCircle2,
  },
];

const workflow = [
  {
    step: "01",
    title: "Create Event",
    detail:
      "Define the course, instructors, date, location, training hours, topics, and supporting materials.",
  },
  {
    step: "02",
    title: "Build Roster",
    detail:
      "Assign personnel and preserve the exact attendance roster for the event.",
  },
  {
    step: "03",
    title: "Record Outcomes",
    detail:
      "Document completed, passed, failed, excused, no-show, incomplete, or remedial-required outcomes.",
  },
  {
    step: "04",
    title: "Update Readiness",
    detail:
      "Create or renew qualifying certifications and update personnel readiness from the completed event.",
  },
  {
    step: "05",
    title: "Close & Report",
    detail:
      "Lock the completed event record and generate a professional Complete Training Report.",
  },
];

export default function AgencyTrainingPage() {
  return (
    <TracePointShell activePage="Agency Training">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                Training
              </p>

              <h1 className="mt-1 text-2xl font-bold text-white">
                Agency Training
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Plan, document, and close agency training events using the same
                structured event model that powers Range Days.
              </p>
            </div>

            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-300">
              <GraduationCap size={14} />
              Module Scaffold
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;

            return (
              <div
                key={metric.label}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {metric.label}
                    </p>

                    <p className="mt-2 text-2xl font-bold text-white">
                      {metric.value}
                    </p>
                  </div>

                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-300">
                    <Icon size={17} />
                  </div>
                </div>

                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {metric.detail}
                </p>
              </div>
            );
          })}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="text-base font-bold text-white">
              Training Event Lifecycle
            </h2>

            <p className="mt-1 text-xs text-slate-500">
              Agency Training will use a structured event lifecycle parallel to
              Range Days.
            </p>
          </div>

          <div className="grid gap-3 p-4 lg:grid-cols-5">
            {workflow.map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4"
              >
                <p className="text-[10px] font-bold tracking-[0.18em] text-blue-400">
                  {item.step}
                </p>

                <h3 className="mt-2 text-sm font-semibold text-white">
                  {item.title}
                </h3>

                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-300">
                <CalendarDays size={18} />
              </div>

              <div>
                <h2 className="text-base font-bold text-white">
                  Training Events
                </h2>

                <p className="text-xs text-slate-500">
                  Scheduled and completed agency training will appear here.
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-950/35 px-5 py-10 text-center">
              <p className="text-sm font-semibold text-slate-300">
                No agency training events yet
              </p>

              <p className="mx-auto mt-2 max-w-xl text-xs leading-5 text-slate-500">
                The production workflow will support in-service training,
                CPR/First Aid, defensive tactics, policy training, tactical
                training, and other agency-defined event types.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-3">
              <FileText size={18} className="text-blue-300" />

              <h2 className="text-base font-bold text-white">
                Record Package
              </h2>
            </div>

            <p className="mt-3 text-xs leading-5 text-slate-500">
              Closed events will preserve the roster, outcomes, hours,
              instructors, syllabus or lesson plan, attachments, certification
              effects, and Complete Training Report in one auditable record.
            </p>
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}