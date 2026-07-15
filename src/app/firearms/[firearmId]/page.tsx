"use client";

import { useParams } from "next/navigation";
import TracePointShell from "@/app/components/TracePointShell";
import ArmorySectionShell from "@/app/components/ArmorySectionShell";
import { ClipboardCheck, Crosshair } from "lucide-react";

export default function FirearmRecordPage() {
  const params = useParams<{ firearmId: string }>();
  const firearmId = params.firearmId;

  return (
    <TracePointShell activePage="Armory">
      <div className="mx-auto w-full max-w-[1200px] space-y-5">
        <ArmorySectionShell
          title="Firearm Record"
          description="Review the selected firearm record and inspection history."
          backHref="/firearms/inspections"
          backLabel="Back to Inspections"
          actions={
            <a
              href={`/firearms/inspections/new?firearmId=${firearmId}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-blue-500"
            >
              <ClipboardCheck size={14} />
              New Inspection
            </a>
          }
        />

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl border border-slate-800 bg-slate-950 text-slate-500">
              <Crosshair size={22} />
            </div>

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Firearm ID
              </p>
              <p className="mt-1 break-all text-[14px] font-semibold text-slate-100">
                {firearmId}
              </p>
              <p className="mt-2 max-w-2xl text-[12px] leading-5 text-slate-500">
                The next step is replacing this placeholder with the actual
                firearm record details from the existing Armory API.
              </p>
            </div>
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}