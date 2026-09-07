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
import { type ReactNode, useEffect, useState } from "react";

import {
  type AnalyticsDashboardConfiguration,
  type CommandDashboardCardKey,
  type CommandDashboardCardSize,
} from "@/lib/tracepoint/analytics-dashboard-config";
import {
  CardSizeControl,
  ReorderButtons,
} from "@/app/components/VisualCustomization";

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

export default function CommandOperationsPanel({
  configuration,
  agencyTrainingEnabled,
  fleetEnabled,
  cards,
  customizing = false,
  onHideCard,
  onMoveCard,
  onSizeCard,
}: {
  configuration: AnalyticsDashboardConfiguration;
  agencyTrainingEnabled: boolean;
  fleetEnabled: boolean;
  cards: Partial<Record<CommandDashboardCardKey, ReactNode>>;
  customizing?: boolean;
  onHideCard?: (key: CommandDashboardCardKey) => void;
  onMoveCard?: (key: CommandDashboardCardKey, direction: -1 | 1) => void;
  onSizeCard?: (
    key: CommandDashboardCardKey,
    size: CommandDashboardCardSize,
  ) => void;
}) {
  const [data, setData] = useState<OperationsPayload | null>(null);
  const [error, setError] = useState("");
  const showAgencyTraining = agencyTrainingEnabled &&
    configuration.command_dashboard_cards.agency_training;
  const showFleet = fleetEnabled &&
    configuration.command_dashboard_cards.fleet_readiness;

  useEffect(() => {
    if (!showAgencyTraining && !showFleet) return;

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
  }, [showAgencyTraining, showFleet]);

  const agencyTrainingVisible =
    showAgencyTraining && (data?.agencyTraining.available ?? true);
  const fleetVisible = showFleet && (data?.fleet.available ?? true);
  const attention = [
    ...(agencyTrainingVisible ? (data?.agencyTraining.attention ?? []) : []),
    ...(fleetVisible ? (data?.fleet.attentionItems ?? []) : []),
  ].slice(0, configuration.command_operations_attention_item_limit);

  const cardLabels: Record<CommandDashboardCardKey, string> = {
    qualification_readiness: "Qualification Readiness",
    certification_readiness: "Certification Readiness",
    equipment_readiness: "Equipment Readiness",
    range_readiness: "Range Readiness",
    records_health: "Range Records",
    performance_signal: "Performance Signal",
    firearm_reliability: "Firearm Reliability",
    agency_training: "Agency Training",
    fleet_readiness: "Fleet Readiness",
  };

  const operationCards: Partial<Record<CommandDashboardCardKey, ReactNode>> = {};

  if (agencyTrainingVisible) {
    operationCards.agency_training = data ? (
      <Link
        href="/agency-training"
        className="group block h-full rounded-3xl border border-blue-500/20 bg-slate-900 p-5 transition hover:border-blue-500/45"
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
    ) : (
      <div className="flex h-full min-h-36 items-center justify-center gap-2 rounded-3xl border border-slate-800 bg-slate-900 p-5 text-xs text-slate-500">
        <Loader2 size={15} className="animate-spin" /> Loading Agency Training
      </div>
    );
  }

  if (fleetVisible) {
    operationCards.fleet_readiness = data ? (
      <Link
        href="/fleet-management"
        className="group block h-full rounded-3xl border border-violet-500/20 bg-slate-900 p-5 transition hover:border-violet-500/45"
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
    ) : (
      <div className="flex h-full min-h-36 items-center justify-center gap-2 rounded-3xl border border-slate-800 bg-slate-900 p-5 text-xs text-slate-500">
        <Loader2 size={15} className="animate-spin" /> Loading Fleet Readiness
      </div>
    );
  }

  const allCards = { ...cards, ...operationCards };
  const visibleOrder = configuration.command_dashboard_card_order.filter(
    (key) => configuration.command_dashboard_cards[key] && allCards[key],
  );
  const spanClasses: Record<CommandDashboardCardSize, string> = {
    compact: "xl:col-span-3",
    standard: "xl:col-span-4",
    wide: "xl:col-span-6",
  };

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
        {visibleOrder.map((key, index) => (
          <div
            key={key}
            className={`${spanClasses[configuration.command_dashboard_card_sizes[key]]} min-w-0 ${
              customizing
                ? "rounded-[1.75rem] border border-dashed border-blue-400/45 bg-blue-500/[0.035] p-1.5"
                : ""
            }`}
          >
            {customizing ? (
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-0.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-blue-300">
                  {cardLabels[key]}
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <CardSizeControl
                    value={configuration.command_dashboard_card_sizes[key]}
                    onChange={(size) => onSizeCard?.(key, size)}
                  />
                  <ReorderButtons
                    label={cardLabels[key]}
                    first={index === 0}
                    last={index === visibleOrder.length - 1}
                    onPrevious={() => onMoveCard?.(key, -1)}
                    onNext={() => onMoveCard?.(key, 1)}
                  />
                  <button
                    type="button"
                    onClick={() => onHideCard?.(key)}
                    className="rounded-lg border border-slate-700 bg-slate-950/80 px-2 py-1.5 text-[9px] font-semibold text-slate-400 transition hover:border-red-500/40 hover:text-red-200"
                  >
                    Remove
                  </button>
                </span>
              </div>
            ) : null}
            <div className="h-full">{allCards[key]}</div>
          </div>
        ))}
        {customizing && visibleOrder.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center rounded-3xl border border-dashed border-blue-500/35 bg-blue-500/[0.035] px-6 text-center text-xs text-slate-500 sm:col-span-2 xl:col-span-12">
            Your canvas is empty. Use Add Card above to build this dashboard.
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-xs text-red-200">
          Agency Training and Fleet command data could not be loaded: {error}
        </div>
      ) : null}

      {data && ((agencyTrainingVisible && data.agencyTraining.upcoming.length > 0) || attention.length > 0) && (
        <div className={`grid gap-4 ${agencyTrainingVisible && attention.length > 0 ? "xl:grid-cols-2" : "grid-cols-1"}`}>
          {agencyTrainingVisible ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-blue-400" />
              <h2 className="text-sm font-bold text-white">Upcoming Agency Training</h2>
            </div>
            <div className="mt-4 space-y-2">
              {data.agencyTraining.upcoming.length === 0 ? (
                <p className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-500">No training is scheduled in the next {configuration.command_training_upcoming_window_days} days.</p>
              ) : data.agencyTraining.upcoming.map((event) => (
                <Link key={event.id} href="/agency-training" className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/40 p-3 hover:border-blue-500/40">
                  <div><p className="text-xs font-bold text-white">{event.title}</p><p className="mt-1 text-[10px] text-slate-500">{formatDate(event.startsAt)} / {event.attendeeCount} assigned</p></div>
                  <ChevronRight size={14} className="text-slate-600" />
                </Link>
              ))}
            </div>
          </div>
          ) : null}

          {attention.length > 0 ? (
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
          ) : null}
        </div>
      )}
    </section>
  );
}
