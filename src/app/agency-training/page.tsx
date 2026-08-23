import {
  Award,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  GraduationCap,
  ShieldCheck,
  Users,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Create Training Events",
    description:
      "Create in-service, CPR, defensive tactics, policy, tactical, remedial, and other agency-defined training events from one structured workflow.",
  },
  {
    icon: Users,
    title: "Roster & Attendance",
    description:
      "Assign personnel and instructors, record attendance, training hours, locations, and individual completion outcomes without maintaining separate spreadsheets.",
  },
  {
    icon: FileText,
    title: "Lesson Plans & Records",
    description:
      "Keep lesson plans, syllabi, instructor credentials, supporting documents, certificates, and attachments with the permanent training record.",
  },
  {
    icon: Award,
    title: "Certification Automation",
    description:
      "Allow a completed event to create or renew qualifying certifications for an entire roster while preserving individual exceptions.",
  },
  {
    icon: ShieldCheck,
    title: "Readiness Integration",
    description:
      "Update personnel readiness automatically when required training is completed, expires, is missed, or requires remediation.",
  },
  {
    icon: FileCheck2,
    title: "Complete Training Reports",
    description:
      "Produce a professional event package containing the roster, results, hours, instructors, lesson plan, attachments, certification impact, and audit history.",
  },
];

const WORKFLOW = [
  ["01", "Create Event"],
  ["02", "Build Roster"],
  ["03", "Conduct Training"],
  ["04", "Record Outcomes"],
  ["05", "Close & Report"],
];

export default function AgencyTrainingPage() {
  return (
    <TracePointShell activePage="Agency Training">
      <div className="mx-auto w-full max-w-[1500px] space-y-7">

        <section className="overflow-hidden rounded-3xl border border-blue-500/20 bg-slate-900/80">
          <div className="px-6 py-10 sm:px-10 sm:py-14">

            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-300">
              <GraduationCap size={14} />
              Coming Soon
            </div>

            <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Agency Training
            </h1>

            <p className="mt-4 max-w-4xl text-base leading-7 text-slate-300">
              Plan, conduct, document, and prove agency training from one
              structured record — connecting attendance, instructors, lesson
              plans, outcomes, certifications, readiness, and reporting.
            </p>

            <div className="mt-7 inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm font-semibold text-slate-300">
              <ClipboardCheck size={17} className="text-blue-300" />
              This module is currently in development and is not yet available.
            </div>

          </div>
        </section>

        <section>
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400">
              Planned Capabilities
            </p>

            <h2 className="mt-1 text-xl font-bold text-white">
              One training record from scheduling through accreditation proof
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;

              return (
                <article
                  key={feature.title}
                  className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10 text-blue-300">
                    <Icon size={18} />
                  </div>

                  <h3 className="mt-4 text-sm font-bold text-white">
                    {feature.title}
                  </h3>

                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    {feature.description}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400">
            Planned Event Workflow
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-5">
            {WORKFLOW.map(([step, label]) => (
              <div
                key={step}
                className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"
              >
                <span className="text-[10px] font-bold tracking-[0.18em] text-blue-400">
                  {step}
                </span>

                <p className="mt-2 text-sm font-semibold text-slate-200">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <GraduationCap size={20} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Built like Range Days — for every kind of training
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Agency Training will use the same event-centered philosophy as
              TracePoint Range Days: schedule the event, identify who should be
              there, document what actually occurred, preserve individual
              results, and close the event into an auditable record.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <FileCheck2 size={20} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Documentation without the paperwork chase
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Supervisors, training officers, accreditation managers, and
              command staff will be able to retrieve the complete training
              record instead of rebuilding it from sign-in sheets, email,
              certificates, lesson plans, and separate files.
            </p>
          </div>

        </section>

        <div className="flex items-center justify-center gap-2 pb-2 text-xs text-slate-500">
          <CheckCircle2 size={14} />
          Planned for a future TracePoint release
        </div>

      </div>
    </TracePointShell>
  );
}