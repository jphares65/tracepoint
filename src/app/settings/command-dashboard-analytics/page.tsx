"use client";

import Link from "next/link";
import { ArrowLeft, LoaderCircle, SlidersHorizontal } from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import AnalyticsDashboardSettingsPanel from "./AnalyticsDashboardSettingsPanel";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

export default function CommandDashboardAnalyticsSettingsPage() {
  const { loading, departmentId, hasPermission } = useTracePointAccess();
  const canAdminister = hasPermission("administer_department");

  return (
    <TracePointShell activePage="Settings">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            <ArrowLeft size={14} />
            Settings
          </Link>

          <div className="mt-4 flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-300">
              <SlidersHorizontal size={21} />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-400">
                Department presentation settings
              </p>
              <h1 className="mt-1 text-2xl font-bold text-white">
                Command Dashboard & Analytics
              </h1>
              <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">
                Configure dashboard cards and sections, Analytics metrics and
                sections, operational windows, list limits, and performance
                signal thresholds for this agency.
              </p>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/70">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <LoaderCircle size={18} className="animate-spin text-blue-400" />
              Verifying settings access...
            </div>
          </div>
        ) : canAdminister && departmentId ? (
          <AnalyticsDashboardSettingsPanel
            departmentId={departmentId}
            canAdminister={canAdminister}
          />
        ) : (
          <div className="rounded-2xl border border-red-800 bg-red-950/30 p-5 text-sm text-red-200">
            Department administration permission is required to configure the
            Command Dashboard and Analytics.
          </div>
        )}
      </div>
    </TracePointShell>
  );
}
