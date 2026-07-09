import Link from "next/link";

import TracePointShell from "@/app/components/TracePointShell";

const workflowSteps = [
  {
    title: "Select firearm",
    description:
      "Start from Armory and choose the firearm that needs inspection, maintenance, or return-to-service review.",
  },
  {
    title: "Review custody and condition",
    description:
      "Confirm the firearm's assigned officer, current condition, and active status before documenting any action.",
  },
  {
    title: "Document findings",
    description:
      "Record inspection findings, service notes, corrective action, and whether the firearm remains duty-ready.",
  },
  {
    title: "Update status",
    description:
      "Use the firearm record to place the firearm out of service or return it to service after the issue is resolved.",
  },
];

export default function InspectionsPage() {
  return (
    <TracePointShell activePage="Armory">
      <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-emerald-300">
                  Armory Workflow
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-white">
                  Maintenance & Inspections
                </h1>
                <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
                  Firearm inspections, maintenance notes, out-of-service review,
                  and return-to-service decisions should stay tied to the
                  selected firearm record inside Armory. This avoids disconnected
                  inspection records and keeps the workflow aligned with custody,
                  condition, and lifecycle history.
                </p>
              </div>

              <Link
                href="/firearms"
                className="inline-flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-bold text-slate-200 transition hover:border-emerald-500 hover:text-emerald-300"
              >
                Back to Armory
              </Link>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
              <h2 className="text-lg font-bold text-white">Status controlled</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Inspection outcomes should update the firearm condition and
                service status rather than living as unrelated notes.
              </p>
            </div>

            <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
              <h2 className="text-lg font-bold text-white">Maintenance linked</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Repairs, service notes, battery changes, parts replacement, and
                return-to-service actions belong on the firearm lifecycle record.
              </p>
            </div>

            <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-5">
              <h2 className="text-lg font-bold text-white">No mock records</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                This page no longer displays demo inspection data. Pilot work
                should begin from an actual firearm in Armory.
              </p>
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6">
            <h2 className="text-xl font-bold text-white">Inspection workflow</h2>
            <p className="mt-1 text-sm text-slate-400">
              Recommended pilot flow for firearm inspection and maintenance handling.
            </p>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {workflowSteps.map((step, index) => (
                <div
                  key={step.title}
                  className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                    Step {index + 1}
                  </p>
                  <h3 className="mt-2 text-sm font-bold text-white">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-amber-900/60 bg-amber-950/20 p-5">
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-amber-300">
              Pilot note
            </h2>
            <p className="mt-3 text-sm leading-6 text-amber-100/80">
              The next refinement step is to add an inspection and maintenance
              tab directly to the selected firearm record. Until then, this page
              serves as a clean Armory workflow landing page.
            </p>
          </section>
        </div>
      </main>
    </TracePointShell>
  );
}
