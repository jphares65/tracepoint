"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Filter,
  Search,
  Shield,
  User,
  X,
} from "lucide-react";

type CurrentFirearmStatus =
  | "In Service"
  | "Out of Service"
  | "Maintenance"
  | "Inspection Required"
  | "Retired";

type CurrentStatusFilter = "All" | CurrentFirearmStatus;

type FirearmTypeFilter =
  | "All"
  | "handgun"
  | "rifle"
  | "shotgun"
  | "less_lethal"
  | "other";

type ArmoryMember = {
  user_id: string;
  full_name: string;
  email: string;
  rank_title?: string | null;
  badge_number?: string | null;
};

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
  members: ArmoryMember[];
};

type DetailModalState =
  | {
      firearmId: string;
      assignmentMode?: "assign" | "return";
    }
  | null;


type AddFirearmForm = {
  make: string;
  model: string;
  serialNumber: string;
  firearmType: FirearmTypeFilter;
  caliber: string;
  assetNumber: string;
  conditionStatus: CurrentFirearmStatus;
  notes: string;
};

const CURRENT_STATUS_OPTIONS: CurrentFirearmStatus[] = [
  "In Service",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
];

const STATUS_FILTERS: CurrentStatusFilter[] = [
  "All",
  ...CURRENT_STATUS_OPTIONS,
];

const TYPE_FILTERS: { value: FirearmTypeFilter; label: string }[] = [
  { value: "All", label: "All" },
  { value: "handgun", label: "Handgun" },
  { value: "rifle", label: "Rifle" },
  { value: "shotgun", label: "Shotgun" },
  { value: "less_lethal", label: "Less Lethal" },
  { value: "other", label: "Other" },
];

const EMPTY_ADD_FIREARM_FORM: AddFirearmForm = {
  make: "",
  model: "",
  serialNumber: "",
  firearmType: "handgun",
  caliber: "",
  assetNumber: "",
  conditionStatus: "In Service",
  notes: "",
};

function normalizeStatus(value?: string | null): CurrentFirearmStatus {
  if (CURRENT_STATUS_OPTIONS.includes(value as CurrentFirearmStatus)) {
    return value as CurrentFirearmStatus;
  }

  return "In Service";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not recorded";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatFirearmType(value?: string | null) {
  if (!value) return "Other";

  const match = TYPE_FILTERS.find((type) => type.value === value);

  if (match && match.value !== "All") return match.label;

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getFirearmName(firearm: ArmoryFirearm) {
  const make = firearm.make?.trim();
  const model = firearm.model?.trim();

  if (make && model) return `${make} ${model}`;
  if (make) return make;
  if (model) return model;

  return "Unnamed firearm";
}

function isUnavailableStatus(status: CurrentFirearmStatus) {
  return (
    status === "Out of Service" ||
    status === "Maintenance" ||
    status === "Inspection Required" ||
    status === "Retired"
  );
}

function getCurrentStatusTone(status: CurrentFirearmStatus) {
  if (status === "In Service") return "green";
  if (status === "Maintenance" || status === "Inspection Required") {
    return "amber";
  }
  if (status === "Out of Service" || status === "Retired") return "red";

  return "slate";
}

function StatusPill({
  label,
  tone = "blue",
}: {
  label: string;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const styles = {
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
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
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

function DetailItem({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
        {label}
      </p>
      <p className="mt-1 text-[14px] font-bold text-white">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p> : null}
    </div>
  );
}

function FirearmList({
  firearms,
  onOpen,
}: {
  firearms: ArmoryFirearm[];
  onOpen: (firearmId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[760px] text-left">
          <thead className="border-b border-slate-800 bg-slate-950/60">
            <tr className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              <th className="px-4 py-3">Firearm</th>
              <th className="px-4 py-3">Serial</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Assigned To</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800">
            {firearms.map((firearm) => (
              <tr
                key={firearm.id}
                onClick={() => onOpen(firearm.id)}
                className="cursor-pointer transition hover:bg-slate-800/60"
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
                        Click to open firearm record
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-4 py-3 text-[12px] font-semibold text-slate-300">
                  {firearm.serial_number || "Not recorded"}
                </td>

                <td className="px-4 py-3">
                  <StatusPill
                    label={formatFirearmType(firearm.firearm_type)}
                    tone="slate"
                  />
                </td>

                <td className="px-4 py-3 text-[12px] text-slate-400">
                  {firearm.active_assignment?.assigned_to_name ?? "Unassigned"}
                </td>

                <td className="px-4 py-3">
                  <StatusPill
                    label={firearm.condition_status}
                    tone={getCurrentStatusTone(firearm.condition_status)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-slate-800 lg:hidden">
        {firearms.map((firearm) => (
          <button
            key={firearm.id}
            type="button"
            onClick={() => onOpen(firearm.id)}
            className="block w-full p-4 text-left transition hover:bg-slate-800/60"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-bold text-white">
                  {getFirearmName(firearm)}
                </h3>
                <p className="mt-1 text-[11px] text-slate-500">
                  Serial {firearm.serial_number || "Not recorded"}
                </p>
              </div>

              <StatusPill
                label={firearm.condition_status}
                tone={getCurrentStatusTone(firearm.condition_status)}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill
                label={formatFirearmType(firearm.firearm_type)}
                tone="slate"
              />
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Assigned to:{" "}
              {firearm.active_assignment?.assigned_to_name ?? "Unassigned"}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function AddFirearmModal({
  form,
  saving,
  errorMessage,
  onClose,
  onChange,
  onSubmit,
}: {
  form: AddFirearmForm;
  saving: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onChange: <Key extends keyof AddFirearmForm>(
    key: Key,
    value: AddFirearmForm[Key],
  ) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close add firearm form"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <section className="relative z-10 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50">
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                New Inventory Record
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">
                Add Firearm
              </h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Create the armory record first. Assignment is handled separately
                after the firearm exists.
              </p>
            </div>

            <button
              type="button"
              aria-label="Close add firearm form"
              onClick={onClose}
              className="rounded-xl border border-slate-800 p-2 text-slate-500 transition hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {errorMessage ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
              {errorMessage}
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Make
              </label>
              <input
                value={form.make}
                onChange={(event) => onChange("make", event.target.value)}
                placeholder="Glock"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Model
              </label>
              <input
                value={form.model}
                onChange={(event) => onChange("model", event.target.value)}
                placeholder="19 Gen 5"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Serial Number
              </label>
              <input
                value={form.serialNumber}
                onChange={(event) =>
                  onChange("serialNumber", event.target.value)
                }
                placeholder="Serial number"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Asset Number
              </label>
              <input
                value={form.assetNumber}
                onChange={(event) =>
                  onChange("assetNumber", event.target.value)
                }
                placeholder="Optional agency asset number"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Type
              </label>
              <select
                value={form.firearmType}
                onChange={(event) =>
                  onChange("firearmType", event.target.value as FirearmTypeFilter)
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              >
                {TYPE_FILTERS.filter((type) => type.value !== "All").map(
                  (type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Caliber / Gauge
              </label>
              <input
                value={form.caliber}
                onChange={(event) => onChange("caliber", event.target.value)}
                placeholder="9mm"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Initial Status
              </label>
              <select
                value={form.conditionStatus}
                onChange={(event) =>
                  onChange(
                    "conditionStatus",
                    event.target.value as CurrentFirearmStatus,
                  )
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              >
                {CURRENT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Notes
              </label>
              <textarea
                value={form.notes}
                onChange={(event) => onChange("notes", event.target.value)}
                placeholder="Optional notes"
                rows={4}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              />
            </div>
          </section>

          <div className="flex flex-col-reverse gap-2 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={saving}
              className="rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Adding..." : "Add Firearm"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FirearmDetailModal({
  firearm,
  members,
  selectedOfficerId,
  saving,
  errorMessage,
  assignmentMode,
  onSelectedOfficerChange,
  onClose,
  onStatusChange,
  onBeginAssign,
  onBeginReturn,
  onConfirmAssign,
  onConfirmReturn,
  onCancelAssignmentMode,
}: {
  firearm: ArmoryFirearm;
  members: ArmoryMember[];
  selectedOfficerId: string;
  saving: boolean;
  errorMessage: string | null;
  assignmentMode?: "assign" | "return";
  onSelectedOfficerChange: (officerId: string) => void;
  onClose: () => void;
  onStatusChange: (firearmId: string, status: CurrentFirearmStatus) => void;
  onBeginAssign: () => void;
  onBeginReturn: () => void;
  onConfirmAssign: () => void;
  onConfirmReturn: () => void;
  onCancelAssignmentMode: () => void;
}) {
  const canAssign =
    !firearm.active_assignment && !isUnavailableStatus(firearm.condition_status);
  const canReturn = Boolean(firearm.active_assignment);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close firearm record"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <section className="relative z-10 max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50">
        <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-900/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                Firearm Record
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">
                {getFirearmName(firearm)}
              </h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Serial {firearm.serial_number || "Not recorded"} ·{" "}
                {formatFirearmType(firearm.firearm_type)}
              </p>
            </div>

            <button
              type="button"
              aria-label="Close firearm record"
              onClick={onClose}
              className="rounded-xl border border-slate-800 p-2 text-slate-500 transition hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          {errorMessage ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-200">
              {errorMessage}
            </div>
          ) : null}

          <section className="grid gap-3 md:grid-cols-4">
            <DetailItem
              label="Status"
              value={firearm.condition_status}
              sub="Current armory status"
            />
            <DetailItem
              label="Assigned To"
              value={firearm.active_assignment?.assigned_to_name ?? "Unassigned"}
              sub={
                firearm.active_assignment
                  ? `Since ${formatDateTime(firearm.active_assignment.assigned_at)}`
                  : "No active assignment"
              }
            />
            <DetailItem
              label="Asset Number"
              value={firearm.asset_number || "Not recorded"}
              sub="Agency inventory reference"
            />
            <DetailItem
              label="Updated"
              value={formatDateTime(firearm.updated_at)}
              sub="Last record update"
            />
          </section>

          <section className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/30 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-white">
                  <Crosshair size={16} className="text-blue-400" />
                  Firearm Details
                </h3>

                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem label="Make" value={firearm.make || "Not recorded"} />
                  <DetailItem label="Model" value={firearm.model || "Not recorded"} />
                  <DetailItem
                    label="Serial Number"
                    value={firearm.serial_number || "Not recorded"}
                  />
                  <DetailItem
                    label="Type"
                    value={formatFirearmType(firearm.firearm_type)}
                  />
                  <DetailItem
                    label="Caliber / Gauge"
                    value={firearm.caliber || "Not recorded"}
                  />
                  <DetailItem
                    label="Created"
                    value={formatDateTime(firearm.created_at)}
                  />
                </div>

                {firearm.notes ? (
                  <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-3 text-[12px] leading-5 text-slate-400">
                    {firearm.notes}
                  </div>
                ) : null}
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/30 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-white">
                  <AlertTriangle size={16} className="text-blue-400" />
                  Linked Record Summary
                </h3>

                <p className="text-[12px] leading-5 text-slate-500">
                  This card now reads firearm condition and custody records from
                  Supabase. Inspection, maintenance, malfunction, range, and
                  qualification summaries can be connected here as those modules
                  are moved to real database records.
                </p>
              </div>

              {firearm.condition_status === "In Service" ? (
                <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.08] p-4 text-[12px] text-emerald-200">
                  <div className="flex gap-3">
                    <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-emerald-100">
                        Firearm is in service
                      </p>
                      <p className="mt-1 text-emerald-200/80">
                        No unavailable status is currently applied to this
                        firearm.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.08] p-4 text-[12px] text-amber-200">
                  <div className="flex gap-3">
                    <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-amber-100">
                        Firearm is not available
                      </p>
                      <p className="mt-1 text-amber-200/80">
                        Current status is {firearm.condition_status}. Review
                        the linked inspection or maintenance record before use.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/30 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-white">
                  <Shield size={16} className="text-blue-400" />
                  Status
                </h3>

                <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                  Current Status
                </label>
                <select
                  value={firearm.condition_status}
                  disabled={saving}
                  onChange={(event) =>
                    onStatusChange(
                      firearm.id,
                      event.target.value as CurrentFirearmStatus,
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] font-semibold text-white outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {CURRENT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <p className="mt-2 text-[11px] leading-4 text-slate-500">
                  This controls service condition only. Assignment is handled
                  separately through Assign / Return.
                </p>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-950/30 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-white">
                  <User size={16} className="text-blue-400" />
                  Assignment
                </h3>

                <DetailItem
                  label="Assigned To"
                  value={
                    firearm.active_assignment?.assigned_to_name ?? "Unassigned"
                  }
                  sub={
                    firearm.active_assignment
                      ? `Assigned ${formatDateTime(
                          firearm.active_assignment.assigned_at,
                        )}`
                      : "No active assignment"
                  }
                />

                {assignmentMode === "assign" ? (
                  <div className="mt-3 rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-3">
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-blue-300">
                      Assign this firearm to
                    </label>
                    <select
                      value={selectedOfficerId}
                      disabled={saving}
                      onChange={(event) =>
                        onSelectedOfficerChange(event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="">Select officer</option>
                      {members.map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {member.full_name}
                        </option>
                      ))}
                    </select>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={onConfirmAssign}
                        disabled={!selectedOfficerId || saving}
                        className="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Confirm Assign"}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelAssignmentMode}
                        disabled={saving}
                        className="rounded-xl border border-slate-700 px-3 py-2 text-[12px] font-semibold text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : assignmentMode === "return" ? (
                  <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-[12px] text-amber-100">
                    Return this firearm from{" "}
                    {firearm.active_assignment?.assigned_to_name}?
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={onConfirmReturn}
                        disabled={saving}
                        className="flex-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Confirm Return"}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelAssignmentMode}
                        disabled={saving}
                        className="rounded-xl border border-slate-700 px-3 py-2 text-[12px] font-semibold text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3">
                    {canReturn ? (
                      <button
                        type="button"
                        onClick={onBeginReturn}
                        disabled={saving}
                        className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Return This Firearm
                      </button>
                    ) : canAssign ? (
                      <button
                        type="button"
                        onClick={onBeginAssign}
                        disabled={saving}
                        className="w-full rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[12px] font-semibold text-blue-200 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Assign This Firearm
                      </button>
                    ) : (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-500">
                        Assignment is disabled while this firearm is{" "}
                        {firearm.condition_status}.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export default function FirearmsPage() {
  const [data, setData] = useState<ArmoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<AddFirearmForm>(
    EMPTY_ADD_FIREARM_FORM,
  );
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<CurrentStatusFilter>("All");
  const [typeFilter, setTypeFilter] = useState<FirearmTypeFilter>("All");
  const [detailModal, setDetailModal] = useState<DetailModalState>(null);
  const [selectedOfficerId, setSelectedOfficerId] = useState("");

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

      setData(payload as ArmoryResponse);
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

  const firearms = useMemo(
    () =>
      (data?.firearms ?? []).map((firearm) => ({
        ...firearm,
        condition_status: normalizeStatus(firearm.condition_status),
      })),
    [data?.firearms],
  );

  const members = data?.members ?? [];

  const selectedFirearm = detailModal
    ? firearms.find((firearm) => firearm.id === detailModal.firearmId)
    : undefined;

  const filteredFirearms = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return firearms.filter((firearm) => {
      const statusMatches =
        statusFilter === "All" || firearm.condition_status === statusFilter;

      const typeMatches =
        typeFilter === "All" || firearm.firearm_type === typeFilter;

      const searchableText = [
        getFirearmName(firearm),
        firearm.serial_number ?? "",
        firearm.asset_number ?? "",
        firearm.firearm_type ?? "",
        firearm.caliber ?? "",
        firearm.condition_status,
        firearm.active_assignment?.assigned_to_name ?? "Unassigned",
      ]
        .join(" ")
        .toLowerCase();

      const searchMatches =
        !normalizedSearch || searchableText.includes(normalizedSearch);

      return statusMatches && typeMatches && searchMatches;
    });
  }, [firearms, searchText, statusFilter, typeFilter]);

  const assignedCount = firearms.filter(
    (firearm) => firearm.active_assignment,
  ).length;

  const unavailableCount = firearms.filter((firearm) =>
    isUnavailableStatus(firearm.condition_status),
  ).length;

  function openAddFirearmForm() {
    setAddError(null);
    setAddForm(EMPTY_ADD_FIREARM_FORM);
    setAddModalOpen(true);
  }

  function closeAddFirearmForm() {
    if (saving) return;

    setAddError(null);
    setAddForm(EMPTY_ADD_FIREARM_FORM);
    setAddModalOpen(false);
  }

  function updateAddForm<Key extends keyof AddFirearmForm>(
    key: Key,
    value: AddFirearmForm[Key],
  ) {
    setAddForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function submitAddFirearm() {
    setSaving(true);
    setAddError(null);

    try {
      const response = await fetch("/api/armory/firearms", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(addForm),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "The firearm could not be added.");
      }

      await loadArmory();
      setAddForm(EMPTY_ADD_FIREARM_FORM);
      setAddModalOpen(false);
    } catch (error) {
      setAddError(
        error instanceof Error
          ? error.message
          : "The firearm could not be added.",
      );
    } finally {
      setSaving(false);
    }
  }

  function openFirearmRecord(firearmId: string) {
    setModalError(null);
    setSelectedOfficerId("");
    setDetailModal({ firearmId });
  }

  function closeFirearmRecord() {
    setModalError(null);
    setSelectedOfficerId("");
    setDetailModal(null);
  }

  function setAssignmentMode(mode: "assign" | "return") {
    if (!detailModal) return;

    setModalError(null);
    setSelectedOfficerId("");
    setDetailModal({
      firearmId: detailModal.firearmId,
      assignmentMode: mode,
    });
  }

  function clearAssignmentMode() {
    if (!detailModal) return;

    setModalError(null);
    setSelectedOfficerId("");
    setDetailModal({ firearmId: detailModal.firearmId });
  }

  async function handleStatusChange(
    firearmId: string,
    status: CurrentFirearmStatus,
  ) {
    setSaving(true);
    setModalError(null);

    try {
      const response = await fetch(`/api/armory/firearms/${firearmId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error || "The firearm status could not be updated.",
        );
      }

      await loadArmory();
    } catch (error) {
      setModalError(
        error instanceof Error
          ? error.message
          : "The firearm status could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmAssign() {
    if (!detailModal || !selectedOfficerId) return;

    setSaving(true);
    setModalError(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${detailModal.firearmId}/assignments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ assignedToUserId: selectedOfficerId }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "The firearm could not be assigned.");
      }

      await loadArmory();
      setSelectedOfficerId("");
      setDetailModal({ firearmId: detailModal.firearmId });
    } catch (error) {
      setModalError(
        error instanceof Error
          ? error.message
          : "The firearm could not be assigned.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmReturn() {
    if (!detailModal) return;

    setSaving(true);
    setModalError(null);

    try {
      const response = await fetch(
        `/api/armory/firearms/${detailModal.firearmId}/assignments`,
        {
          method: "PATCH",
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "The firearm could not be returned.");
      }

      await loadArmory();
      setSelectedOfficerId("");
      setDetailModal({ firearmId: detailModal.firearmId });
    } catch (error) {
      setModalError(
        error instanceof Error
          ? error.message
          : "The firearm could not be returned.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <TracePointShell activePage="Armory">
      <div className="mx-auto w-full max-w-[1450px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                Armory
              </p>
              <h1 className="text-[22px] font-bold text-white">
                Firearms Inventory
              </h1>
              <p className="mt-1 max-w-3xl text-[12px] leading-5 text-slate-500">
                Select a firearm from the inventory list to view its record,
                assignment, current status, and linked history summary.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-400">
                <Shield size={14} className="text-blue-400" />
                Supabase inventory
              </div>

              <button
                type="button"
                onClick={openAddFirearmForm}
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-500"
              >
                Add Firearm
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Total Firearms"
            value={firearms.length}
            sub="Inventory records"
          />
          <StatCard
            label="Assigned"
            value={assignedCount}
            sub="Active custody"
          />
          <StatCard
            label="Unavailable"
            value={unavailableCount}
            sub="OOS, maintenance, retired"
          />
          <StatCard
            label="Members"
            value={members.length}
            sub="Assignment options"
          />
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px_auto] lg:items-end">
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                <Search size={12} />
                Search
              </label>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search firearm, serial number, assigned officer..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                <Filter size={12} />
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as CurrentStatusFilter)
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              >
                {STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                <Crosshair size={12} />
                Type
              </label>
              <select
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as FirearmTypeFilter)
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              >
                {TYPE_FILTERS.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                setSearchText("");
                setStatusFilter("All");
                setTypeFilter("All");
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 transition hover:border-blue-500/40 hover:text-white"
            >
              <X size={14} />
              Clear
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3 px-1">
            <div>
              <h2 className="text-[15px] font-bold text-white">Inventory</h2>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {loading
                  ? "Loading firearms..."
                  : `${filteredFirearms.length} of ${firearms.length} firearms shown`}
              </p>
            </div>
          </div>

          {loadError ? (
            <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-5 text-[13px] text-red-200">
              {loadError}
            </div>
          ) : loading ? (
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-[13px] text-slate-400">
              Loading Armory records...
            </div>
          ) : filteredFirearms.length > 0 ? (
            <FirearmList
              firearms={filteredFirearms}
              onOpen={openFirearmRecord}
            />
          ) : (
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
              <Search size={22} className="mx-auto text-slate-600" />
              <p className="mt-3 text-[14px] font-semibold text-white">
                No firearms match those filters.
              </p>
              <p className="mt-1 text-[12px] text-slate-500">
                Clear the search or broaden the status/type filter.
              </p>
            </div>
          )}
        </section>
      </div>

      {addModalOpen ? (
        <AddFirearmModal
          form={addForm}
          saving={saving}
          errorMessage={addError}
          onClose={closeAddFirearmForm}
          onChange={updateAddForm}
          onSubmit={submitAddFirearm}
        />
      ) : null}

      {selectedFirearm ? (
        <FirearmDetailModal
          firearm={selectedFirearm}
          members={members}
          selectedOfficerId={selectedOfficerId}
          saving={saving}
          errorMessage={modalError}
          onSelectedOfficerChange={setSelectedOfficerId}
          onClose={closeFirearmRecord}
          onStatusChange={handleStatusChange}
          onBeginAssign={() => setAssignmentMode("assign")}
          onBeginReturn={() => setAssignmentMode("return")}
          onConfirmAssign={confirmAssign}
          onConfirmReturn={confirmReturn}
          onCancelAssignmentMode={clearAssignmentMode}
          assignmentMode={detailModal?.assignmentMode}
        />
      ) : null}
    </TracePointShell>
  );
}
