"use client";

import Link from "next/link";
import { ArrowLeft, BarChart3, LayoutDashboard } from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";

export default function CommandDashboardAnalyticsSettingsPage() {
  return (
    <TracePointShell activePage="Settings">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            <ArrowLeft size={14} /> Settings
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-white">
            Customize Operational Views
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
            Build each view directly on the page where your agency uses it.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <Link
            href="/command-dashboard?customize=dashboard"
            className="group rounded-3xl border border-slate-800 bg-slate-900 p-6 transition hover:border-blue-500/50"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
              <LayoutDashboard size={22} />
            </span>
            <h2 className="mt-5 text-lg font-bold text-white">Command Dashboard</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Add, remove, arrange, and size operational cards while previewing the live dashboard.
            </p>
            <p className="mt-5 text-xs font-semibold text-blue-300">Customize Dashboard →</p>
          </Link>

          <Link
            href="/analytics?customize=analytics"
            className="group rounded-3xl border border-slate-800 bg-slate-900 p-6 transition hover:border-violet-500/50"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-300">
              <BarChart3 size={22} />
            </span>
            <h2 className="mt-5 text-lg font-bold text-white">Analytics</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Select metrics, arrange analysis sections, and open advanced signal controls.
            </p>
            <p className="mt-5 text-xs font-semibold text-violet-300">Customize Analytics →</p>
          </Link>
        </div>
      </div>
    </TracePointShell>
  );
}
