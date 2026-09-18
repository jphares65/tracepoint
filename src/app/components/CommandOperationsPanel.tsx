"use client";

import Link from "next/link";
import {
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

export type OperationsPayload = {
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
    upcoming: Array<{
      id: string;
      vehicleId: string;
      unitNumber: string;
      label: string;
      dueDate: string;
    }>;
    attentionItems: AttentionItem[];
  };
};

export function useCommandOperationsData(enabled: boolean) {
  const [data, setData] = useState<OperationsPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return;

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
  }, [enabled]);

  return { data, error, loading: enabled && !data && !error };
}

export default function CommandOperationsPanel({
  configuration,
  agencyTrainingEnabled,
  fleetEnabled,
  cards,
  data,
  error,
  customizing = false,
  onHideCard,
  onMoveCard,
  onSizeCard,
}: {
  configuration: AnalyticsDashboardConfiguration;
  agencyTrainingEnabled: boolean;
  fleetEnabled: boolean;
  cards: Partial<Record<CommandDashboardCardKey, ReactNode>>;
  data: OperationsPayload | null;
  error?: string;
  customizing?: boolean;
  onHideCard?: (key: CommandDashboardCardKey) => void;
  onMoveCard?: (key: CommandDashboardCardKey, direction: -1 | 1) => void;
  onSizeCard?: (
    key: CommandDashboardCardKey,
    size: CommandDashboardCardSize,
  ) => void;
}) {
  const showAgencyTraining = agencyTrainingEnabled &&
    configuration.command_dashboard_cards.agency_training;
  const showFleet = fleetEnabled &&
    configuration.command_dashboard_cards.fleet_readiness;

  const agencyTrainingVisible =
    showAgencyTraining && (data?.agencyTraining.available ?? true);
  const fleetVisible = showFleet && (data?.fleet.available ?? true);

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

    </section>
  );
}
