import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  Wrench,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

const metrics = [
  {
    label: "Active Vehicles",
    value: "0",
    detail: "Vehicles currently in agency service",
    icon: Car,
  },
  {
    label: "Service Due",
    value: "0",
    detail: "Preventive maintenance requiring attention",
    icon: Wrench,
  },
  {
    label: "Inspections Due",
    value: "0",
    detail: "Vehicle inspections approaching due date",
    icon: ClipboardCheck,
  },
  {
    label: "Out of Service",
    value: "0",
    detail: "Vehicles unavailable for deployment",
    icon: AlertTriangle,
  },
];

export default function FleetManagementPage() {
  return (
    <TracePointShell activePage="Fleet Management">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                Assets & Fleet
              </p>

              <h1 className="mt-1 text-2xl font-bold text-white">
                Fleet Management
              </h1>

              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Centralize vehicle inventory, assignment, inspections,
                maintenance, lifecycle status, and future telematics-based
                readiness.
              </p>
            </div>

            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-700 bg-slate-950/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              Coming Soon
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

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-3">
              <Car size={18} className="text-blue-300" />

              <h2 className="text-base font-bold text-white">
                Vehicle Lifecycle
              </h2>
            </div>

            <div className="mt-4 space-y-3">
              {[
                "Vehicle inventory and stable asset identity",
                "Unit assignment and operational status",
                "Preventive maintenance and service history",
                "Inspection schedules and deficiencies",
                "Out-of-service and return-to-service workflow",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3"
                >
                  <CheckCircle2
                    size={15}
                    className="mt-0.5 shrink-0 text-slate-500"
                  />

                  <p className="text-xs leading-5 text-slate-400">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
            <div className="flex items-center gap-3">
              <Gauge size={18} className="text-blue-300" />

              <h2 className="text-base font-bold text-white">
                Connected Fleet Readiness
              </h2>
            </div>

            <p className="mt-4 text-xs leading-5 text-slate-500">
              The fleet architecture will be designed for future external
              telematics integrations while keeping TracePoint responsible for
              agency-specific readiness rules, accountability workflows, and
              operational attention items.
            </p>

            <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-950/35 px-5 py-8 text-center">
              <p className="text-sm font-semibold text-slate-300">
                Fleet data is not enabled yet
              </p>

              <p className="mt-2 text-xs leading-5 text-slate-500">
                This module is intentionally staged for a later TracePoint
                release.
              </p>
            </div>
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}