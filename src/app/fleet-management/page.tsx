import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ClipboardCheck,
  History,
  QrCode,
  ShieldCheck,
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
      "Scan the unit's QR code to immediately open the correct vehicle, mobile inspection, required-equipment checklist, current status, and maintenance history.",
  },
  {
    icon: Smartphone,
    title: "Fast Mobile Inspections",
    description:
      "Complete routine vehicle and equipment checks from a phone with a streamlined workflow designed to take seconds at the beginning of a shift.",
  },
  {
    icon: ShieldCheck,
    title: "Automatic Vehicle Readiness",
    description:
      "Inspection results can automatically update vehicle availability. Critical defects, missing required equipment, overdue inspections, or other agency-defined deficiencies can immediately restrict or remove a unit from service.",
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
    icon: Users,
    title: "Assignments & Pool Vehicles",
    description:
      "Maintain assignment and custody history for permanently assigned and shared vehicles with clear checkout, return, and accountability records.",
  },
];

const STATUS_EXAMPLES = [
  {
    status: "Available",
    detail:
      "Inspection complete with no readiness condition preventing operational use.",
    icon: CheckCircle2,
  },
  {
    status: "Attention",
    detail:
      "A non-critical issue requires follow-up, but agency rules permit the vehicle to remain available.",
    icon: AlertTriangle,
  },
  {
    status: "Out of Service",
    detail:
      "A critical mechanical issue, missing required equipment, failed inspection item, or other configured deficiency removes the vehicle from available inventory.",
    icon: Wrench,
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
              assigned, and ready for service — while automatically removing
              deficient vehicles from availability and routing problems to the
              people responsible for resolving them.
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
              From QR scan to verified vehicle readiness
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
              Scan. Inspect. Status Updated.
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Scan the cruiser, confirm mileage and required equipment, record
              any defect, and complete the inspection from a phone in seconds.
              TracePoint evaluates the inspection result and immediately
              updates whether the vehicle remains available for service.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <Wrench size={21} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Send the problem directly to the mechanic
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              A failed inspection item can become a tracked maintenance task
              for the designated mechanic or fleet manager, carrying the
              vehicle details, reported issue, inspection record, and supporting
              information with it. Repair and return-to-service become part of
              the permanent vehicle history.
            </p>
          </div>

        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">

          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400">
            Automatic Status
          </p>

          <h2 className="mt-2 text-lg font-bold text-white">
            Inspection results drive availability
          </h2>

          <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-400">
            Agencies will be able to define which deficiencies affect vehicle
            availability. TracePoint can evaluate those rules as soon as an
            inspection is submitted so fleet status reflects operational
            reality instead of waiting for someone to update another list.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {STATUS_EXAMPLES.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.status}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} className="text-blue-300" />

                    <h3 className="text-sm font-bold text-slate-200">
                      {item.status}
                    </h3>
                  </div>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {item.detail}
                  </p>
                </div>
              );
            })}
          </div>

        </section>

        <section className="grid gap-4 lg:grid-cols-2">

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <ClipboardCheck size={21} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Accountability without slowing down the shift
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Routine checks should be fast enough that officers actually
              complete them. TracePoint handles the accountability behind the
              scenes while exceptions, missing equipment, and mechanical issues
              receive the attention they require.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <ShieldCheck size={21} className="text-blue-300" />

            <h2 className="mt-4 text-lg font-bold text-white">
              Agency-defined readiness rules
            </h2>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              Different agencies can decide what constitutes a warning,
              restriction, or out-of-service condition. A missing non-critical
              item may generate attention while a safety-related mechanical
              defect can immediately remove the vehicle from service until it
              is resolved.
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