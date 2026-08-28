"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  GraduationCap,
  Loader2,
  Truck,
} from "lucide-react";
import { useEffect, useState } from "react";

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  priority: "blue" | "amber" | "red";
};

type OperationsPayload = {
  agencyTraining: {
    available: boolean;
    total: number;
    draft: number;
    scheduled: number;
    inProgress: number;
    completed: number;
    rosterAssignments: number;
    upcoming: Array<{
      id: string;
      title: string;
      trainingType: string;
      startsAt: string;
      location: string | null;
      attendeeCount: number;
    }>;
    attention: AttentionItem[];
  };
  fleet: {
    available: boolean;
    total: number;
    availableVehicles: number;
    attention: number;
    maintenance: number;
    outOfService: number;
    openIssues: number;
    attentionItems: AttentionItem[];
  };
};

function tone(priority: AttentionItem["priority"]) {
  return {
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
  }[priority];
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

export default function CommandOperationsPanel() {
  const [data, setData] = useState<OperationsPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/command-dashboard/operations", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as
          | OperationsPayload
          | { error?: string };
        if (!response.ok || !("agencyTraining" in payload)) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "Operational modules could not be loaded.",
          );
        }
        if (active) setData(payload);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Operational modules could not be loaded.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <section className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-xs text-red-200">
        Agency Training and Fleet command data could not be loaded: {error}
      </section>
    );
  }

  if (!data) {
    return (
      <section className="flex items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-xs text-slate-500">
        <Loader2 size={15} className="animate-spin" /> Loading operational modules
      </section>
    );
  }

  const attention = [
    ...data.agencyTraining.attention,
    ...data.fleet.attentionItems,
  ].slice(0, 8);

  return (
    <section className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Link
          href="/agency-training"
          className="group rounded-3xl border border-blue-500/20 bg-slate-900 p-5 transition hover:border-blue-500/45"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-400">
                <GraduationCap size={15} /> Agency Training
              </div>
              <p className="mt-3 text-3xl font-bold text-white">
                {data.agencyTraining.scheduled + data.agencyTraining.inProgress}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-300">
                Scheduled or active events
              </p>
            </div>
            <ChevronRight size={18} className="text-slate-600 group-hover:text-blue-300" />
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2 border-t border-slate-800 pt-4">
            {[
              ["Scheduled", data.agencyTraining.scheduled],
              ["In Progress", data.agencyTraining.inProgress],
              ["Completed", data.agencyTraining.completed],
              ["Roster", data.agencyTraining.rosterAssignments],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-lg font-bold text-white">{Number(value)}</p>
                <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-600">{String(label)}</p>
              </div>
            ))}
          </div>
        </Link>

        <Link
          href="/fleet-management"
          className="group rounded-3xl border border-violet-500/20 bg-slate-900 p-5 transition hover:border-violet-500/45"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400">
                <Truck size={15} /> Fleet Readiness
              </div>
              <p className="mt-3 text-3xl font-bold text-white">
                {data.fleet.availableVehicles}/{data.fleet.total}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-300">
                Vehicles available
              </p>
            </div>
            <ChevronRight size={18} className="text-slate-600 group-hover:text-violet-300" />
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2 border-t border-slate-800 pt-4">
            {[
              ["Attention", data.fleet.attention],
              ["Maintenance", data.fleet.maintenance],
              ["Out of Service", data.fleet.outOfService],
              ["Open Issues", data.fleet.openIssues],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <p className="text-lg font-bold text-white">{Number(value)}</p>
                <p className="mt-1 text-[9px] uppercase tracking-wide text-slate-600">{String(label)}</p>
              </div>
            ))}
          </div>
        </Link>
      </div>

      {(data.agencyTraining.upcoming.length > 0 || attention.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-blue-400" />
              <h2 className="text-sm font-bold text-white">Upcoming Agency Training</h2>
            </div>
            <div className="mt-4 space-y-2">
              {data.agencyTraining.upcoming.length === 0 ? (
                <p className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-500">No training is scheduled in the next 30 days.</p>
              ) : data.agencyTraining.upcoming.map((event) => (
                <Link key={event.id} href="/agency-training" className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 p-3 hover:border-blue-500/40">
                  <div><p className="text-xs font-bold text-white">{event.title}</p><p className="mt-1 text-[10px] text-slate-500">{formatDate(event.startsAt)} / {event.attendeeCount} assigned</p></div>
                  <ChevronRight size={14} className="text-slate-600" />
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" />
              <h2 className="text-sm font-bold text-white">Training and Fleet Attention</h2>
            </div>
            <div className="mt-4 space-y-2">
              {attention.length === 0 ? (
                <p className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-500">No Agency Training or Fleet attention items.</p>
              ) : attention.map((item) => (
                <Link key={`${item.href}-${item.id}`} href={item.href} className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${tone(item.priority)}`}>
                  <div><p className="text-xs font-bold text-white">{item.title}</p><p className="mt-1 text-[10px] leading-4 text-slate-400">{item.detail}</p></div>
                  <ChevronRight size={14} className="mt-0.5 shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}