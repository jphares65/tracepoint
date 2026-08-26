"use client";

import Link from "next/link";
import { ArrowLeft, Settings2 } from "lucide-react";
import TracePointShell from "@/app/components/TracePointShell";
import FleetRulesPanel from "./FleetRulesPanel";

export default function FleetRulesPage() {
  return (
    <TracePointShell activePage="Settings">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <Link
            href="/settings?tab=rules"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            <ArrowLeft size={14} />
            Settings & Rules
          </Link>

          <div className="mt-4 flex items-center gap-3">
            <Settings2 className="text-blue-300" />

            <div>
              <h1 className="text-2xl font-bold text-white">
                Fleet Readiness Rules
              </h1>

              <p className="mt-1 text-xs text-slate-400">
                Configure status automation, maintenance intervals, warnings,
                notifications, escalation, inspections, and responsible agency
                roles.
              </p>
            </div>
          </div>
        </header>

        <FleetRulesPanel />
      </div>
    </TracePointShell>
  );
}
