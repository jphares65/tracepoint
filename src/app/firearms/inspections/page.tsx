"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TracePointShell from "@/app/components/TracePointShell";
import ArmorySectionShell from "@/app/components/ArmorySectionShell";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Crosshair,
  Plus,
  Search,
  ShieldCheck,
  Wrench,
} from "lucide-react";

type CurrentFirearmStatus =
  | "In Service"
  | "Out of Service"
  | "Maintenance"
  | "Inspection Required"
  | "Retired";

type ActiveAssignment = {
  id: string;
  assigned_to_user_id: string;
  assigned_to_name: string;
  assigned_at: string;
};

type ArmoryFirearm = {
  id: string;
  department_id: string;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  firearm_type: string | null;
  caliber: string | null;
  asset_number: string | null;
  condition_status: CurrentFirearmStatus;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  active_assignment: ActiveAssignment | null;
};

type ArmoryResponse = {
  departmentId: string;
  firearms: ArmoryFirearm[];
  members: unknown[];
};

const STATUS_OPTIONS: CurrentFirearmStatus[] = [
  "In Service",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
];

function normalizeStatus(value?: string | null): CurrentFirearmStatus {
  if (STATUS_OPTIONS.includes(value as CurrentFirearmStatus)) {
    return value as CurrentFirearmStatus;
  }

  return "In Service";
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getFirearmName(firearm: ArmoryFirearm) {
  const make = firearm.make?.trim();
  const model = firearm.model?.trim();

  if (make && model) return `${make} ${model}`;
  if (make) return make;
  if (model) return model;

  return "Unnamed firearm";
}

function getStatusTone(status: CurrentFirearmStatus) {
  if (status === "In Service") return "green";
  if (status === "Maintenance" || status === "Inspection Required") {
    return "amber";
  }
  if (status === "Out of Service" || status === "Retired") return "red";

  return "slate";
}

function StatusPill({
  label,
  tone = "slate",
}: {
  label: string;
  tone?: "green" | "amber" | "red" | "blue" | "slate";
}) {
  const styles = {
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: typeof ClipboardList;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const iconStyles = {
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    green: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    red: "border-red-500/20 bg-red-500/10 text-red-300",
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-white">{value}</p>
          <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
        </div>

        <div
          className={`flex h-9 w-9 items-center justify-center rounded-2xl border ${iconStyles[tone]}`}
        >
          <Icon size={16} />
        </div>
      </div>
    </div>
  );
}

export default function ArmoryInspectionsPage() {
  const [firearms, setFirearms] = useState<ArmoryFirearm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  const loadArmory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/armory/firearms", {
        cache: "no-store",
      });

      const payload = (await response.json()) as
        | ArmoryResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "The Armory records could not be loaded.",
        );
      }

      const normalized = (payload as ArmoryResponse).firearms.map((firearm) => ({
        ...firearm,
        condition_status: normalizeStatus(firearm.condition_status),
      }));

      setFirearms(normalized);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "The Armory records could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadArmory();
  }, [loadArmory]);

  const inspectionRequired = firearms.filter(
    (firearm) => firearm.condition_status === "Inspection Required",
  );

  const maintenance = firearms.filter(
    (firearm) => firearm.condition_status === "Maintenance",
  );

  const outOfService = firearms.filter(
    (firearm) => firearm.condition_status === "Out of Service",
  );

  const inspectionQueue = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return firearms
      .filter((firearm) => firearm.condition_status !== "In Service")
      .filter((firearm) => {
        if (!normalizedSearch) return true;

        const searchable = [
          getFirearmName(firearm),
          firearm.serial_number ?? "",
          firearm.asset_number ?? "",
          firearm.condition_status,
          firearm.active_assignment?.assigned_to_name ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return searchable.includes(normalizedSearch);
      })
      .sort((left, right) => {
        const priority: Record<CurrentFirearmStatus, number> = {
          "Inspection Required": 0,
          Maintenance: 1,
          "Out of Service": 2,
          Retired: 3,
          "In Service": 4,
        };

        return (
          priority[left.condition_status] - priority[right.condition_status]
        );
      });
  }, [firearms, searchText]);

  return (
    <TracePointShell activePage="Armory">
      <div className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6 lg:p-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <ArmorySectionShell
          title="Maintenance & Inspections"
          description="Inspection, maintenance, and out-of-service follow-up."
          actions={
            <Link
              href="/firearms/inspections/new"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-blue-500"
            >
              <Plus size={14} />
              New Inspection
            </Link>
          }
        />

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard
            label="Inspection Required"
            value={inspectionRequired.length}
            sub="Firearms flagged for inspection"
            icon={ClipboardCheck}
            tone="amber"
          />

          <StatCard
            label="Maintenance"
            value={maintenance.length}
            sub="Service or repair queue"
            icon={Wrench}
            tone="amber"
          />

          <StatCard
            label="Out of Service"
            value={outOfService.length}
            sub="Unavailable for duty use"
            icon={AlertTriangle}
            tone="red"
          />

          <StatCard
            label="In Service"
            value={
              firearms.filter(
                (firearm) => firearm.condition_status === "In Service",
              ).length
            }
            sub="No inspection hold"
            icon={ShieldCheck}
            tone="green"
          />
        </section>

        {loadError ? (
          <section className="rounded-3xl border border-red-500/20 bg-red-500/[0.08] p-4 text-[12px] text-red-200">
            <div className="flex gap-3">
              <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-red-100">
                  Could not load Armory inspections.
                </p>
                <p className="mt-1 text-red-200/80">{loadError}</p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-800 bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-white">
                Inspection Work Queue
              </h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Firearms with a status that requires inspection, maintenance,
                or command review.
              </p>
            </div>

            <div className="relative w-full lg:w-[320px]">
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
              />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search firearm, serial, assignee..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-[12px] text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-500/60"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-[13px] text-slate-500">
              Loading inspection queue...
            </div>
          ) : inspectionQueue.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead className="border-b border-slate-800 bg-slate-950/60">
                  <tr className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    <th className="px-4 py-3">Firearm</th>
                    <th className="px-4 py-3">Serial</th>
                    <th className="px-4 py-3">Assigned To</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800">
                  {inspectionQueue.map((firearm) => (
                    <tr
                      key={firearm.id}
                      className="transition hover:bg-slate-800/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-slate-500">
                            <Crosshair size={15} />
                          </div>
                          <div>
                            <p className="text-[13px] font-bold text-white">
                              {getFirearmName(firearm)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {firearm.asset_number || "No asset number"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 text-[12px] font-semibold text-slate-300">
                        {firearm.serial_number || "Not recorded"}
                      </td>

                      <td className="px-4 py-3 text-[12px] text-slate-400">
                        {firearm.active_assignment?.assigned_to_name ??
                          "Unassigned"}
                      </td>

                      <td className="px-4 py-3">
                        <StatusPill
                          label={firearm.condition_status}
                          tone={getStatusTone(firearm.condition_status)}
                        />
                      </td>

                      <td className="px-4 py-3 text-[12px] text-slate-500">
                        {formatDate(firearm.updated_at)}
                      </td>

                      <td className="px-4 py-3">
                        <Link
                          href={`/firearms/${firearm.id}`}
                          className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white"
                        >
                          Open Record
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.08] p-6 text-center">
                <CheckCircle2 className="mx-auto text-emerald-300" size={28} />
                <p className="mt-3 text-[14px] font-bold text-emerald-100">
                  No firearms currently require inspection review.
                </p>
                <p className="mx-auto mt-1 max-w-xl text-[12px] leading-5 text-emerald-200/75">
                  Firearms marked Maintenance, Inspection Required, Out of
                  Service, or Retired will appear in this Armory inspection
                  queue.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900">
          <div className="border-b border-slate-800 px-4 py-4">
            <h2 className="text-[15px] font-bold text-white">
              Inspection History
            </h2>
            <p className="mt-1 text-[12px] text-slate-500">
              Saved inspection records will appear here after the inspection
              record workflow is connected.
            </p>
          </div>

          <div className="p-6">
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center">
              <ClipboardList className="mx-auto text-slate-600" size={28} />
              <p className="mt-3 text-[13px] font-semibold text-slate-300">
                No inspection records displayed yet.
              </p>
              <p className="mx-auto mt-1 max-w-xl text-[12px] leading-5 text-slate-500">
                This page is now properly embedded under Armory. The next build
                step is wiring the New Inspection button to create inspection
                records.
              </p>
            </div>
          </div>
        </section>
        </div>
      </div>
    </TracePointShell>
  );
}


