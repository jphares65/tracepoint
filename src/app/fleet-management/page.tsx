import {
  Activity,
  Car,
  CheckCircle2,
  ClipboardCheck,
  History,
  QrCode,
  Smartphone,
  Users,
  Wrench,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

const FEATURES = [
  {
    icon: QrCode,
    title: "QR Vehicle Access",
    description:
      "Scan the unit's QR code to immediately open the correct vehicle, inspection workflow, required-equipment checklist, current status, and service history.",
  },
  {
    icon: Smartphone,
    title: "Fast Mobile Inspections",
    description:
      "Complete routine vehicle and equipment inspections from a phone with a streamlined workflow designed to take seconds at the start of a shift.",
  },
  {
    icon: Wrench,
    title: "Direct Maintenance Routing",
    description:
      "Report a defect once and automatically route the vehicle, issue, notes, photos, and inspection record to the designated mechanic or fleet manager.",
  },
  {
    icon: History,
    title: "Permanent Maintenance History",
    description:
      "Keep inspections, repairs, preventive maintenance, mileage, defects, downtime, and return-to-service history attached to the vehicle.",
  },
  {
    icon: ClipboardCheck,
    title: "Vehicle & Equipment Readiness",
    description:
      "Track required equipment, inspection schedules, maintenance intervals, deficiencies, and operational readiness before problems affect a shift.",
  },
  {
    icon: Users,
    title: "Assignments & Pool Vehicles",
    description:
      "Maintain assignment and custody history for permanently assigned and shared vehicles with clear checkout, return, and accountability records.",
  },
  {
    icon: Activity,
    title: "Connected Fleet Data",
    description:
      "Support future telematics and external API integrations while TracePoint applies agency-specific readiness rules and accountability workflows.",
  },
];

export default function FleetManagementPage() {
  return (
    <TracePointShell activePage="Fleet Management">
      <div className="mx-auto w-full max-w-[1500px] space-y-7">

        <section className="overflow-hidden rounded-3xl border border-blue-500/20 bg-slate-900/80">
          <div className="px-6 py-10 sm:px-10 sm:py-14">

            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-300">
              <Car size={14} />
              Coming Soon
            </div>

            <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Fleet Management
            </h1>

            <p className="mt-4 max-w-4xl text-base leading-7 text-slate-300">
              Know whether every vehicle is inspected, equipped, maintained,
              assigned, and ready for service — while routing problems directly
              to the people responsible for resolving them.
            </p>

            <div className="mt-7 inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm font-semibold text-slate-300">
              <Car size={17} className="text-blue-300" />
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
              From QR scan to resolved maintenance issue
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

        <section className="grid gap-4 lg:grid-cols-2">

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <QrCode size={21} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Scan. Inspect. Go.
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Scan the cruiser, confirm mileage and required equipment, report
              any defect, and complete the inspection from a phone in seconds.
              TracePoint preserves who inspected the vehicle, when it occurred,
              what was found, and what still requires action.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <Wrench size={21} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Send the problem directly to the mechanic
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              A failed inspection item can immediately become a tracked
              maintenance task for the designated mechanic or fleet manager,
              carrying the vehicle details and reported problem with it.
              Repair, resolution, and return-to-service become part of the
              permanent record.
            </p>
          </div>

        </section>

        <section className="grid gap-4 lg:grid-cols-2">

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <ClipboardCheck size={21} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Accountability without slowing down the shift
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              The goal is not another lengthy inspection form. Routine checks
              should be fast enough that officers actually complete them while
              exceptions, missing equipment, and maintenance issues receive the
              attention they require.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <Activity size={21} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Built for connected fleet systems
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Fleet Management is planned around stable vehicle identities and
              an integration-ready architecture. Future telematics providers
              can supply vehicle data while TracePoint manages agency-specific
              inspections, readiness rules, accountability, exceptions, and
              workflow.
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