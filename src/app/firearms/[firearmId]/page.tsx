"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Crosshair,
  FileText,
  Hash,
  ShieldCheck,
  UserRound,
  Wrench,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import ArmorySectionShell from "@/app/components/ArmorySectionShell";

type ActiveAssignment = {
  id: string;
  assigned_to_user_id: string;
  assigned_to_name: string;
  assigned_at: string;
  magazines_issued: number;
  magazine_description?: string | null;
  magazines_returned?: number | null;
  magazine_discrepancy_reason?: string | null;
};

type FirearmRecord = {
  id: string;
  department_id: string;
  make: string;
  model: string;
  serial_number: string;
  firearm_type: string;
  caliber?: string | null;
  asset_number?: string | null;
  condition_status?: string | null;
  notes?: string | null;
  is_active: boolean;
  archived_at?: string | null;
  archived_by_user_id?: string | null;
  archive_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  active_assignment?: ActiveAssignment | null;
};

type ArmoryResponse = {
  firearms?: FirearmRecord[];
  access?: {
    canViewAll?: boolean;
    canManage?: boolean;
    canInspect?: boolean;
  };
  error?: string;
};

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not recorded";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFirearmType(value?: string | null) {
  if (!value) return "Other";

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusClasses(status?: string | null, active = true) {
  if (!active) {
    return "border-slate-700 bg-slate-800/70 text-slate-400";
  }

  switch (status) {
    case "In Service":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "Out of Service":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    case "Maintenance":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "Inspection Required":
      return "border-orange-500/30 bg-orange-500/10 text-orange-300";
    case "Retired":
      return "border-slate-700 bg-slate-800/70 text-slate-400";
    default:
      return "border-slate-700 bg-slate-800/70 text-slate-300";
  }
}

function InfoField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
        {label}
      </p>

      <div className="mt-1 text-[13px] font-semibold text-slate-200">
        {value}
      </div>
    </div>
  );
}

export default function FirearmRecordPage() {
  const params = useParams<{ firearmId: string }>();
  const firearmId = params.firearmId;

  const [firearm, setFirearm] = useState<FirearmRecord | null>(null);
  const [canInspect, setCanInspect] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadFirearm() {
      setLoading(true);
      setLoadError("");
      setNotFound(false);

      try {
        const response = await fetch(
          "/api/armory/firearms?includeArchived=true",
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const payload = (await response.json().catch(() => ({}))) as ArmoryResponse;

        if (!response.ok) {
          throw new Error(
            payload.error ?? "The firearm record could not be loaded.",
          );
        }

        if (!mounted) return;

        const records = Array.isArray(payload.firearms)
          ? payload.firearms
          : [];

        const selected =
          records.find((record) => record.id === firearmId) ?? null;

        setCanInspect(Boolean(payload.access?.canInspect));
        setFirearm(selected);
        setNotFound(!selected);
      } catch (error) {
        if (!mounted) return;

        setLoadError(
          error instanceof Error
            ? error.message
            : "The firearm record could not be loaded.",
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadFirearm();

    return () => {
      mounted = false;
    };
  }, [firearmId]);

  const conditionStatus = firearm?.is_active
    ? firearm.condition_status ?? "In Service"
    : "Archived";

  return (
    <TracePointShell activePage="Armory">
      <div className="mx-auto w-full max-w-[1200px] space-y-5">
        <ArmorySectionShell
          title={
            firearm
              ? `${firearm.make} ${firearm.model}`
              : "Firearm Record"
          }
          description="Review firearm identity, custody, condition, and inspection access."
          backHref="/firearms"
          backLabel="Back to Inventory"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/firearms/inspections"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-[12px] font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white"
              >
                <Wrench size={14} />
                Inspections
              </Link>

              {canInspect && firearm?.is_active && (
                <Link
                  href={`/firearms/inspections/new?firearmId=${firearmId}`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-blue-500"
                >
                  <ClipboardCheck size={14} />
                  New Inspection
                </Link>
              )}
            </div>
          }
        />

        {loading && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-8 text-center">
            <p className="text-sm font-semibold text-slate-300">
              Loading firearm record...
            </p>
          </section>
        )}

        {!loading && loadError && (
          <section className="rounded-3xl border border-red-500/20 bg-red-500/[0.06] p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={18}
                className="mt-0.5 shrink-0 text-red-400"
              />

              <div>
                <p className="text-sm font-semibold text-red-300">
                  Firearm record unavailable
                </p>

                <p className="mt-1 text-[12px] leading-5 text-red-300/70">
                  {loadError}
                </p>
              </div>
            </div>
          </section>
        )}

        {!loading && !loadError && notFound && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
            <Crosshair
              size={28}
              className="mx-auto text-slate-700"
            />

            <h2 className="mt-4 text-lg font-bold text-white">
              Firearm record not found
            </h2>

            <p className="mx-auto mt-2 max-w-lg text-[12px] leading-5 text-slate-500">
              The firearm may have been removed, may not belong to your
              department, or your account may not have access to this record.
            </p>

            <Link
              href="/firearms"
              className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-[12px] font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white"
            >
              <ArrowLeft size={14} />
              Return to Inventory
            </Link>
          </section>
        )}

        {!loading && !loadError && firearm && (
          <>
            <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
              <div className="flex flex-col gap-5 border-b border-slate-800 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl border border-slate-800 bg-slate-950 text-blue-400">
                    <Crosshair size={23} />
                  </div>

                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-400">
                      Armory Record
                    </p>

                    <h1 className="mt-1 text-[22px] font-bold text-white">
                      {firearm.make} {firearm.model}
                    </h1>

                    <p className="mt-1 text-[12px] text-slate-500">
                      {formatFirearmType(firearm.firearm_type)}
                      {firearm.caliber ? ` · ${firearm.caliber}` : ""}
                      {firearm.asset_number
                        ? ` · Asset ${firearm.asset_number}`
                        : ""}
                    </p>
                  </div>
                </div>

                <span
                  className={`inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusClasses(
                    firearm.condition_status,
                    firearm.is_active,
                  )}`}
                >
                  {conditionStatus}
                </span>
              </div>

              <div className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-4">
                <InfoField
                  label="Make"
                  value={firearm.make}
                />

                <InfoField
                  label="Model"
                  value={firearm.model}
                />

                <InfoField
                  label="Serial Number"
                  value={
                    <span className="inline-flex items-center gap-1.5">
                      <Hash size={13} className="text-slate-600" />
                      {firearm.serial_number}
                    </span>
                  }
                />

                <InfoField
                  label="Asset Number"
                  value={firearm.asset_number || "Not assigned"}
                />

                <InfoField
                  label="Firearm Type"
                  value={formatFirearmType(firearm.firearm_type)}
                />

                <InfoField
                  label="Caliber"
                  value={firearm.caliber || "Not recorded"}
                />

                <InfoField
                  label="Condition"
                  value={firearm.condition_status || "In Service"}
                />

                <InfoField
                  label="Record Status"
                  value={firearm.is_active ? "Active" : "Archived"}
                />
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex items-center gap-3">
                  <span className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-2.5 text-blue-400">
                    <UserRound size={18} />
                  </span>

                  <div>
                    <h2 className="text-[15px] font-bold text-white">
                      Current Custody
                    </h2>

                    <p className="text-[11px] text-slate-500">
                      Current active firearm assignment.
                    </p>
                  </div>
                </div>

                {firearm.active_assignment ? (
                  <div className="mt-5 space-y-4">
                    <InfoField
                      label="Assigned Officer"
                      value={firearm.active_assignment.assigned_to_name}
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <InfoField
                        label="Assigned"
                        value={formatDate(
                          firearm.active_assignment.assigned_at,
                        )}
                      />

                      <InfoField
                        label="Magazines Issued"
                        value={String(
                          firearm.active_assignment.magazines_issued ?? 0,
                        )}
                      />
                    </div>

                    <InfoField
                      label="Magazine Description"
                      value={
                        firearm.active_assignment.magazine_description ||
                        "Not recorded"
                      }
                    />
                  </div>
                ) : (
                  <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <CheckCircle2
                      size={17}
                      className="mt-0.5 shrink-0 text-emerald-400"
                    />

                    <div>
                      <p className="text-[12px] font-semibold text-slate-200">
                        No active assignment
                      </p>

                      <p className="mt-1 text-[11px] leading-5 text-slate-500">
                        This firearm is not currently assigned to an officer.
                      </p>
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex items-center gap-3">
                  <span className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-emerald-400">
                    <ShieldCheck size={18} />
                  </span>

                  <div>
                    <h2 className="text-[15px] font-bold text-white">
                      Record Activity
                    </h2>

                    <p className="text-[11px] text-slate-500">
                      Inventory record lifecycle information.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <InfoField
                    label="Created"
                    value={formatDateTime(firearm.created_at)}
                  />

                  <InfoField
                    label="Last Updated"
                    value={formatDateTime(firearm.updated_at)}
                  />
                </div>

                {!firearm.is_active && (
                  <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      <CalendarDays size={14} />
                      Archive Record
                    </div>

                    <p className="mt-3 text-[12px] font-semibold text-slate-300">
                      Archived {formatDateTime(firearm.archived_at)}
                    </p>

                    {firearm.archive_reason && (
                      <p className="mt-2 text-[11px] leading-5 text-slate-500">
                        {firearm.archive_reason}
                      </p>
                    )}
                  </div>
                )}
              </section>
            </div>

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center gap-3">
                <span className="rounded-2xl border border-slate-700 bg-slate-950 p-2.5 text-slate-400">
                  <FileText size={18} />
                </span>

                <div>
                  <h2 className="text-[15px] font-bold text-white">
                    Record Notes
                  </h2>

                  <p className="text-[11px] text-slate-500">
                    General notes maintained with this firearm record.
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="whitespace-pre-wrap text-[12px] leading-6 text-slate-400">
                  {firearm.notes || "No notes are recorded for this firearm."}
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </TracePointShell>
  );
}
