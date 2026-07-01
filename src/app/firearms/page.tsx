"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Crosshair,
  ExternalLink,
  Filter,
  Search,
  Shield,
  User,
  X,
} from "lucide-react";

import type { FirearmMalfunction } from "@/app/lib/tracepoint/types";

import type {
  DrillRunResult,
  DrillTemplate,
  RangeDay,
  RangeDayDrill,
  RangeRosterEntry,
} from "@/app/lib/tracepoint/range-day-types";

import {
  MOCK_FIREARMS,
  MOCK_USERS,
} from "@/app/lib/tracepoint/mock-data";

type MockFirearm = (typeof MOCK_FIREARMS)[number];

type CurrentFirearmStatus =
  | "In Service"
  | "Assigned"
  | "Out of Service"
  | "Maintenance"
  | "Inspection Required"
  | "Retired";

type CurrentStatusFilter = "All" | CurrentFirearmStatus;

type StoredRangeDay = RangeDay & {
  rangeType?: string;
  startTime?: string;
  endTime?: string;
  packetStatus?: string;
  staffingNotes?: string;
  outline?: string[];
};

type StoredRangeDayWorkspace = {
  rangeDays: StoredRangeDay[];
  drillLibrary: DrillTemplate[];
  rangeDayDrills: RangeDayDrill[];
  rangeRoster: RangeRosterEntry[];
  results: DrillRunResult[];
  malfunctions: FirearmMalfunction[];
};

type FirearmRecord = {
  firearm: MockFirearm;
  id: string;
  name: string;
  serialNumber: string;
  typeLabel: string;
  sourceStatusLabel: string;
  currentStatus: CurrentFirearmStatus;
  assignedOfficerId?: string;
  assignedOfficerName: string;
  assignmentLabel: string;
  rangeUseCount: number;
  qualificationReferenceCount: number;
  malfunctionCount: number;
  openMalfunctionCount: number;
  inspectionRequiredCount: number;
  removedFromServiceCount: number;
  openIssueCount: number;
  latestActivityLabel: string;
};

type StatusOverrides = Record<string, CurrentFirearmStatus>;
type AssignmentOverrides = Record<string, string | null>;

type AssignmentDialog =
  | {
      mode: "assign";
      firearmId: string;
    }
  | {
      mode: "return";
      firearmId: string;
    }
  | null;

const RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1";
const FIREARM_STATUS_STORAGE_KEY = "tracepoint.armory.statusOverrides.v1";
const FIREARM_ASSIGNMENT_STORAGE_KEY =
  "tracepoint.armory.assignmentOverrides.v1";

const EMPTY_WORKSPACE: StoredRangeDayWorkspace = {
  rangeDays: [],
  drillLibrary: [],
  rangeDayDrills: [],
  rangeRoster: [],
  results: [],
  malfunctions: [],
};

const CURRENT_STATUS_OPTIONS: CurrentFirearmStatus[] = [
  "In Service",
  "Assigned",
  "Out of Service",
  "Maintenance",
  "Inspection Required",
  "Retired",
];

const STATUS_FILTERS: CurrentStatusFilter[] = [
  "All",
  ...CURRENT_STATUS_OPTIONS,
];

const TYPE_FILTERS = [
  "All",
  "Handgun",
  "Rifle",
  "Shotgun",
  "Less Lethal",
  "Other",
];

function loadStoredRangeDayWorkspace(): StoredRangeDayWorkspace | null {
  if (typeof window === "undefined") return null;

  try {
    const storedWorkspace = window.localStorage.getItem(
      RANGE_DAY_WORKSPACE_STORAGE_KEY,
    );

    if (!storedWorkspace) return null;

    const parsed = JSON.parse(
      storedWorkspace,
    ) as Partial<StoredRangeDayWorkspace>;

    return {
      rangeDays: Array.isArray(parsed.rangeDays) ? parsed.rangeDays : [],
      drillLibrary: Array.isArray(parsed.drillLibrary)
        ? parsed.drillLibrary
        : [],
      rangeDayDrills: Array.isArray(parsed.rangeDayDrills)
        ? parsed.rangeDayDrills
        : [],
      rangeRoster: Array.isArray(parsed.rangeRoster)
        ? parsed.rangeRoster
        : [],
      results: Array.isArray(parsed.results) ? parsed.results : [],
      malfunctions: Array.isArray(parsed.malfunctions)
        ? parsed.malfunctions
        : [],
    };
  } catch (error) {
    console.warn("Could not load saved range day workspace.", error);
    return null;
  }
}

function loadStatusOverrides(): StatusOverrides {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(FIREARM_STATUS_STORAGE_KEY);

    if (!stored) return {};

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const overrides: StatusOverrides = {};

    for (const [firearmId, value] of Object.entries(parsed)) {
      if (
        typeof value === "string" &&
        CURRENT_STATUS_OPTIONS.includes(value as CurrentFirearmStatus)
      ) {
        overrides[firearmId] = value as CurrentFirearmStatus;
      }
    }

    return overrides;
  } catch (error) {
    console.warn("Could not load saved firearm status overrides.", error);
    return {};
  }
}

function persistStatusOverrides(overrides: StatusOverrides) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    FIREARM_STATUS_STORAGE_KEY,
    JSON.stringify(overrides),
  );
}

function loadAssignmentOverrides(): AssignmentOverrides {
  if (typeof window === "undefined") return {};

  try {
    const stored = window.localStorage.getItem(
      FIREARM_ASSIGNMENT_STORAGE_KEY,
    );

    if (!stored) return {};

    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const overrides: AssignmentOverrides = {};

    for (const [firearmId, value] of Object.entries(parsed)) {
      if (typeof value === "string" || value === null) {
        overrides[firearmId] = value;
      }
    }

    return overrides;
  } catch (error) {
    console.warn("Could not load saved firearm assignment overrides.", error);
    return {};
  }
}

function persistAssignmentOverrides(overrides: AssignmentOverrides) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    FIREARM_ASSIGNMENT_STORAGE_KEY,
    JSON.stringify(overrides),
  );
}

function getRecordValue(item: unknown, keys: string[]) {
  const record = item as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
  }

  return undefined;
}

function getDateValue(date?: string) {
  if (!date) return 0;

  const value = date.includes("T")
    ? new Date(date).getTime()
    : new Date(`${date}T00:00:00`).getTime();

  return Number.isNaN(value) ? 0 : value;
}

function formatDate(date?: string) {
  if (!date) return "No date";

  const parsed = date.includes("T")
    ? new Date(date)
    : new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) return "No date";

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getUserName(userId?: string) {
  if (!userId) return "Unassigned";

  return MOCK_USERS.find((user) => user.id === userId)?.name ?? "Unknown User";
}

function getFirearmName(firearm?: MockFirearm) {
  if (!firearm) return "Unknown firearm";

  return `${firearm.make} ${firearm.model}`;
}

function getFirearmTypeLabel(firearm: MockFirearm) {
  return (
    getRecordValue(firearm, [
      "type",
      "firearmType",
      "category",
      "weaponType",
      "classification",
    ]) ?? "Firearm"
  );
}

function getFirearmStatusLabel(firearm: MockFirearm) {
  return (
    getRecordValue(firearm, [
      "status",
      "condition",
      "inventoryStatus",
      "serviceStatus",
      "operationalStatus",
    ]) ?? "In Service"
  );
}

function getDirectAssignedOfficerId(firearm: MockFirearm) {
  return getRecordValue(firearm, [
    "assignedOfficerId",
    "assignedToOfficerId",
    "assignedUserId",
    "assignedToUserId",
    "issuedToUserId",
    "currentOfficerId",
  ]);
}

function normalizeCurrentStatus(value?: string): CurrentFirearmStatus {
  const normalized = value?.toLowerCase() ?? "";

  if (normalized.includes("assigned") || normalized.includes("issued")) {
    return "Assigned";
  }

  if (
    normalized.includes("out") ||
    normalized.includes("oos") ||
    normalized.includes("inactive")
  ) {
    return "Out of Service";
  }

  if (normalized.includes("maintenance") || normalized.includes("repair")) {
    return "Maintenance";
  }

  if (normalized.includes("inspection")) {
    return "Inspection Required";
  }

  if (normalized.includes("retired")) {
    return "Retired";
  }

  return "In Service";
}

function isUnavailableStatus(status: CurrentFirearmStatus) {
  return (
    status === "Out of Service" ||
    status === "Maintenance" ||
    status === "Inspection Required" ||
    status === "Retired"
  );
}

function isQualificationText(value?: string) {
  return Boolean(value?.toLowerCase().includes("qualification"));
}

function isQualificationDrill(drill?: RangeDayDrill) {
  if (!drill) return false;

  return drill.category === "Qualification" || isQualificationText(drill.name);
}

function getCurrentStatusTone(status: CurrentFirearmStatus) {
  if (status === "In Service" || status === "Assigned") return "green";
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

function ModuleLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-blue-500/40 hover:text-white"
    >
      {label}
      <ExternalLink size={12} />
    </Link>
  );
}

function buildFirearmRecords({
  workspace,
  statusOverrides,
  assignmentOverrides,
}: {
  workspace: StoredRangeDayWorkspace;
  statusOverrides: StatusOverrides;
  assignmentOverrides: AssignmentOverrides;
}) {
  const rangeDayById = new Map(
    workspace.rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]),
  );

  const drillById = new Map(
    workspace.rangeDayDrills.map((drill) => [drill.id, drill]),
  );

  const resultsByFirearmId = new Map<string, DrillRunResult[]>();
  const rosterByFirearmId = new Map<string, RangeRosterEntry[]>();
  const malfunctionsByFirearmId = new Map<string, FirearmMalfunction[]>();

  for (const result of workspace.results) {
    if (!result.firearmId) continue;

    const current = resultsByFirearmId.get(result.firearmId) ?? [];
    current.push(result);
    resultsByFirearmId.set(result.firearmId, current);
  }

  for (const entry of workspace.rangeRoster) {
    for (const firearmId of entry.assignedFirearmIds ?? []) {
      const current = rosterByFirearmId.get(firearmId) ?? [];
      current.push(entry);
      rosterByFirearmId.set(firearmId, current);
    }
  }

  for (const malfunction of workspace.malfunctions) {
    if (!malfunction.firearmId) continue;

    const current = malfunctionsByFirearmId.get(malfunction.firearmId) ?? [];
    current.push(malfunction);
    malfunctionsByFirearmId.set(malfunction.firearmId, current);
  }

  return MOCK_FIREARMS.map<FirearmRecord>((firearm) => {
    const sourceStatusLabel = getFirearmStatusLabel(firearm);
    const sourceStatus = normalizeCurrentStatus(sourceStatusLabel);
    const directAssignedOfficerId = getDirectAssignedOfficerId(firearm);

    const assignmentOverrideExists = Object.prototype.hasOwnProperty.call(
      assignmentOverrides,
      firearm.id,
    );

    const assignedOfficerId = assignmentOverrideExists
      ? assignmentOverrides[firearm.id] ?? undefined
      : directAssignedOfficerId;

    const currentStatus =
      statusOverrides[firearm.id] ??
      (assignedOfficerId && sourceStatus === "In Service"
        ? "Assigned"
        : sourceStatus);

    const results = (resultsByFirearmId.get(firearm.id) ?? []).slice().sort(
      (left, right) => {
        const leftRangeDay = rangeDayById.get(left.rangeDayId);
        const rightRangeDay = rangeDayById.get(right.rangeDayId);

        return (
          getDateValue(rightRangeDay?.date) -
          getDateValue(leftRangeDay?.date)
        );
      },
    );

    const rosterEntries = rosterByFirearmId.get(firearm.id) ?? [];
    const malfunctions = (malfunctionsByFirearmId.get(firearm.id) ?? [])
      .slice()
      .sort((left, right) => getDateValue(right.date) - getDateValue(left.date));

    const qualificationReferenceCount = results.filter((result) => {
      const drill = drillById.get(result.drillId);
      return isQualificationDrill(drill);
    }).length;

    const openMalfunctionCount = malfunctions.filter(
      (malfunction) => !malfunction.resolvedOnRange,
    ).length;

    const inspectionRequiredCount = malfunctions.filter(
      (malfunction) => malfunction.inspectionRequired,
    ).length;

    const removedFromServiceCount = malfunctions.filter(
      (malfunction) => malfunction.removedFromService,
    ).length;

    const latestResult = results[0];
    const latestResultRangeDay = latestResult
      ? rangeDayById.get(latestResult.rangeDayId)
      : undefined;
    const latestMalfunction = malfunctions[0];

    const latestActivityDateValue = Math.max(
      getDateValue(latestResultRangeDay?.date),
      getDateValue(latestMalfunction?.date),
    );

    const latestActivityLabel =
      latestActivityDateValue > 0
        ? formatDate(new Date(latestActivityDateValue).toISOString())
        : "No linked activity";

    const assignedOfficerName = assignedOfficerId
      ? getUserName(assignedOfficerId)
      : "Unassigned";

    return {
      firearm,
      id: firearm.id,
      name: getFirearmName(firearm),
      serialNumber: firearm.serialNumber,
      typeLabel: getFirearmTypeLabel(firearm),
      sourceStatusLabel,
      currentStatus,
      assignedOfficerId,
      assignedOfficerName,
      assignmentLabel: assignedOfficerId
        ? assignedOfficerName
        : rosterEntries.length > 0
          ? "Range reference only"
          : "Unassigned",
      rangeUseCount: results.length,
      qualificationReferenceCount,
      malfunctionCount: malfunctions.length,
      openMalfunctionCount,
      inspectionRequiredCount,
      removedFromServiceCount,
      openIssueCount:
        openMalfunctionCount + inspectionRequiredCount + removedFromServiceCount,
      latestActivityLabel,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function FirearmInventoryTable({
  records,
  selectedFirearmId,
  onSelect,
  onAssign,
  onReturn,
}: {
  records: FirearmRecord[];
  selectedFirearmId: string;
  onSelect: (firearmId: string) => void;
  onAssign: (firearmId: string) => void;
  onReturn: (firearmId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[900px] text-left">
          <thead className="border-b border-slate-800 bg-slate-950/60">
            <tr className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              <th className="px-4 py-3">Firearm</th>
              <th className="px-4 py-3">Serial</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Assigned To</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Issues</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800">
            {records.map((record) => {
              const selected = selectedFirearmId === record.id;
              const canAssign =
                !record.assignedOfficerId &&
                !isUnavailableStatus(record.currentStatus);
              const canReturn = Boolean(record.assignedOfficerId);

              return (
                <tr
                  key={record.id}
                  onClick={() => onSelect(record.id)}
                  className={`cursor-pointer transition ${
                    selected ? "bg-blue-500/10" : "hover:bg-slate-800/60"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-slate-500">
                        <Crosshair size={15} />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-white">
                          {record.name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Last activity: {record.latestActivityLabel}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-[12px] font-semibold text-slate-300">
                    {record.serialNumber}
                  </td>

                  <td className="px-4 py-3">
                    <StatusPill label={record.typeLabel} tone="slate" />
                  </td>

                  <td className="px-4 py-3 text-[12px] text-slate-400">
                    {record.assignmentLabel}
                  </td>

                  <td className="px-4 py-3">
                    <StatusPill
                      label={record.currentStatus}
                      tone={getCurrentStatusTone(record.currentStatus)}
                    />
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span
                      className={`text-[13px] font-bold ${
                        record.openIssueCount > 0
                          ? "text-amber-300"
                          : "text-slate-500"
                      }`}
                    >
                      {record.openIssueCount}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {canReturn ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onReturn(record.id);
                          }}
                          className="rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-amber-500/40 hover:text-amber-200"
                        >
                          Return
                        </button>
                      ) : canAssign ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onAssign(record.id);
                          }}
                          className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-[11px] font-semibold text-blue-200 transition hover:bg-blue-500/20"
                        >
                          Assign
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(record.id);
                          }}
                          className="rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:border-blue-500/40 hover:text-white"
                        >
                          View
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-slate-800 xl:hidden">
        {records.map((record) => {
          const selected = selectedFirearmId === record.id;
          const canAssign =
            !record.assignedOfficerId &&
            !isUnavailableStatus(record.currentStatus);
          const canReturn = Boolean(record.assignedOfficerId);

          return (
            <div
              key={record.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(record.id)}
              className={`block w-full p-4 text-left transition ${
                selected ? "bg-blue-500/10" : "hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-bold text-white">
                    {record.name}
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Serial {record.serialNumber}
                  </p>
                </div>

                <StatusPill
                  label={record.currentStatus}
                  tone={getCurrentStatusTone(record.currentStatus)}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill label={record.typeLabel} tone="slate" />
                {record.openIssueCount > 0 ? (
                  <StatusPill
                    label={`${record.openIssueCount} Issues`}
                    tone="amber"
                  />
                ) : null}
              </div>

              <p className="mt-3 text-[11px] text-slate-500">
                Assigned to: {record.assignmentLabel}
              </p>

              <div className="mt-3 flex gap-2">
                {canReturn ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReturn(record.id);
                    }}
                    className="rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300"
                  >
                    Return
                  </button>
                ) : canAssign ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAssign(record.id);
                    }}
                    className="rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-[11px] font-semibold text-blue-200"
                  >
                    Assign
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(record.id);
                    }}
                    className="rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300"
                  >
                    View
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SelectedFirearmRecord({
  record,
  onStatusChange,
  onAssign,
  onReturn,
}: {
  record: FirearmRecord;
  onStatusChange: (firearmId: string, status: CurrentFirearmStatus) => void;
  onAssign: (firearmId: string) => void;
  onReturn: (firearmId: string) => void;
}) {
  const canAssign =
    !record.assignedOfficerId && !isUnavailableStatus(record.currentStatus);
  const canReturn = Boolean(record.assignedOfficerId);

  return (
    <aside className="space-y-4 xl:sticky xl:top-6">
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-400">
          Selected Firearm
        </p>

        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-bold leading-tight text-white">
              {record.name}
            </h2>
            <p className="mt-1 text-[12px] text-slate-500">
              Serial {record.serialNumber} · {record.typeLabel}
            </p>
          </div>

          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-blue-400">
            <Crosshair size={18} />
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <DetailItem
            label="Assigned To"
            value={record.assignmentLabel}
            sub={
              record.assignedOfficerId
                ? "Current firearm assignment"
                : "No active assignment"
            }
          />

          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              Firearm Status
            </label>
            <select
              value={record.currentStatus}
              onChange={(event) =>
                onStatusChange(
                  record.id,
                  event.target.value as CurrentFirearmStatus,
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] font-semibold text-white outline-none transition focus:border-blue-500"
            >
              {CURRENT_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <p className="mt-2 text-[11px] leading-4 text-slate-500">
              Armory controls the firearm&apos;s current status. Detailed
              inspection, maintenance, and range records are entered in their
              own modules.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            {canReturn ? (
              <button
                type="button"
                onClick={() => onReturn(record.id)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] font-semibold text-amber-200 transition hover:bg-amber-500/20"
              >
                <User size={14} />
                Return This Firearm
              </button>
            ) : canAssign ? (
              <button
                type="button"
                onClick={() => onAssign(record.id)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[12px] font-semibold text-blue-200 transition hover:bg-blue-500/20"
              >
                <User size={14} />
                Assign This Firearm
              </button>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-500">
                Assignment disabled while firearm status is {record.currentStatus}.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-[14px] font-bold text-white">
          Record Summary
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <DetailItem
            label="Open Issues"
            value={record.openIssueCount}
            sub="Maintenance/inspection flags"
          />
          <DetailItem
            label="Malfunctions"
            value={record.malfunctionCount}
            sub={`${record.openMalfunctionCount} open`}
          />
          <DetailItem
            label="Qual Links"
            value={record.qualificationReferenceCount}
            sub="Range/qualification records"
          />
          <DetailItem
            label="Range Uses"
            value={record.rangeUseCount}
            sub="Linked range events"
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-[14px] font-bold text-white">
          Linked Modules
        </h3>

        <p className="mb-3 text-[12px] leading-5 text-slate-500">
          Armory shows the firearm record. Use the related modules to enter
          inspections, maintenance, malfunctions, and range/qualification
          details.
        </p>

        <div className="flex flex-wrap gap-2">
          <ModuleLink href="/inspections" label="Inspections" />
          <ModuleLink href="/range-days" label="Range Days" />
          <ModuleLink href="/qualifications" label="Qualifications" />
        </div>
      </section>

      {record.openIssueCount > 0 ? (
        <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.08] p-4 text-[12px] text-amber-200">
          <div className="flex gap-3">
            <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-amber-100">
                Review recommended
              </p>
              <p className="mt-1 text-amber-200/80">
                This firearm has linked issue flags. Review inspection,
                maintenance, or malfunction history before treating it as ready
                for use.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.08] p-4 text-[12px] text-emerald-200">
          <div className="flex gap-3">
            <CheckCircle2 size={17} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-emerald-100">
                No linked issues
              </p>
              <p className="mt-1 text-emerald-200/80">
                No open malfunction, inspection, or out-of-service flags are
                currently linked to this firearm record.
              </p>
            </div>
          </div>
        </section>
      )}
    </aside>
  );
}

function AssignmentModal({
  dialog,
  records,
  selectedOfficerId,
  onSelectedOfficerChange,
  onClose,
  onConfirmAssign,
  onConfirmReturn,
}: {
  dialog: AssignmentDialog;
  records: FirearmRecord[];
  selectedOfficerId: string;
  onSelectedOfficerChange: (officerId: string) => void;
  onClose: () => void;
  onConfirmAssign: () => void;
  onConfirmReturn: () => void;
}) {
  if (!dialog) return null;

  const record = records.find((item) => item.id === dialog.firearmId);

  if (!record) return null;

  const isAssign = dialog.mode === "assign";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <section className="relative z-10 w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-400">
              {isAssign ? "Assign Firearm" : "Return Firearm"}
            </p>
            <h2 className="mt-2 text-xl font-bold text-white">
              {record.name}
            </h2>
            <p className="mt-1 text-[12px] text-slate-500">
              Serial {record.serialNumber}
            </p>
          </div>

          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded-xl border border-slate-800 p-2 text-slate-500 transition hover:text-white"
          >
            <X size={17} />
          </button>
        </div>

        {isAssign ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Assign this firearm to
              </label>
              <select
                value={selectedOfficerId}
                onChange={(event) =>
                  onSelectedOfficerChange(event.target.value)
                }
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              >
                <option value="">Select officer</option>
                {MOCK_USERS.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>

              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                This will assign {record.name} to the selected officer and
                update the firearm status to Assigned.
              </p>
            </div>

            <button
              type="button"
              onClick={onConfirmAssign}
              disabled={!selectedOfficerId}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Assign {record.name}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 text-[13px] leading-5 text-slate-300">
              Return{" "}
              <span className="font-semibold text-white">{record.name}</span>{" "}
              from{" "}
              <span className="font-semibold text-white">
                {record.assignedOfficerName}
              </span>
              ?
              <p className="mt-2 text-[11px] text-slate-500">
                This will clear the current assignment and return the firearm to
                In Service unless a different status is selected later.
              </p>
            </div>

            <button
              type="button"
              onClick={onConfirmReturn}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-500/20"
            >
              Return {record.name}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function FirearmsPage() {
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [hasStoredWorkspace, setHasStoredWorkspace] = useState(false);
  const [statusOverrides, setStatusOverrides] =
    useState<StatusOverrides>({});
  const [assignmentOverrides, setAssignmentOverrides] =
    useState<AssignmentOverrides>({});
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<CurrentStatusFilter>("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [selectedFirearmId, setSelectedFirearmId] = useState<string>(
    MOCK_FIREARMS[0]?.id ?? "",
  );
  const [assignmentDialog, setAssignmentDialog] =
    useState<AssignmentDialog>(null);
  const [selectedOfficerId, setSelectedOfficerId] = useState("");

  useEffect(() => {
    const storedWorkspace = loadStoredRangeDayWorkspace();

    if (storedWorkspace) {
      setWorkspace(storedWorkspace);
      setHasStoredWorkspace(true);
    }

    setStatusOverrides(loadStatusOverrides());
    setAssignmentOverrides(loadAssignmentOverrides());
  }, []);

  function handleStatusChange(
    firearmId: string,
    status: CurrentFirearmStatus,
  ) {
    setStatusOverrides((current) => {
      const next = {
        ...current,
        [firearmId]: status,
      };

      persistStatusOverrides(next);
      return next;
    });
  }

  function beginAssign(firearmId: string) {
    setSelectedFirearmId(firearmId);
    setSelectedOfficerId("");
    setAssignmentDialog({ mode: "assign", firearmId });
  }

  function beginReturn(firearmId: string) {
    setSelectedFirearmId(firearmId);
    setAssignmentDialog({ mode: "return", firearmId });
  }

  function closeAssignmentDialog() {
    setAssignmentDialog(null);
    setSelectedOfficerId("");
  }

  function confirmAssign() {
    if (!assignmentDialog || assignmentDialog.mode !== "assign") return;
    if (!selectedOfficerId) return;

    const firearmId = assignmentDialog.firearmId;

    setAssignmentOverrides((current) => {
      const next = {
        ...current,
        [firearmId]: selectedOfficerId,
      };

      persistAssignmentOverrides(next);
      return next;
    });

    setStatusOverrides((current) => {
      const next = {
        ...current,
        [firearmId]: "Assigned" as CurrentFirearmStatus,
      };

      persistStatusOverrides(next);
      return next;
    });

    closeAssignmentDialog();
  }

  function confirmReturn() {
    if (!assignmentDialog || assignmentDialog.mode !== "return") return;

    const firearmId = assignmentDialog.firearmId;

    setAssignmentOverrides((current) => {
      const next = {
        ...current,
        [firearmId]: null,
      };

      persistAssignmentOverrides(next);
      return next;
    });

    setStatusOverrides((current) => {
      const next = {
        ...current,
        [firearmId]: "In Service" as CurrentFirearmStatus,
      };

      persistStatusOverrides(next);
      return next;
    });

    closeAssignmentDialog();
  }

  const firearmRecords = useMemo(
    () =>
      buildFirearmRecords({
        workspace,
        statusOverrides,
        assignmentOverrides,
      }),
    [workspace, statusOverrides, assignmentOverrides],
  );

  const selectedRecord =
    firearmRecords.find((record) => record.id === selectedFirearmId) ??
    firearmRecords[0];

  const filteredRecords = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return firearmRecords.filter((record) => {
      const statusMatches =
        statusFilter === "All" || record.currentStatus === statusFilter;

      const typeMatches =
        typeFilter === "All" ||
        record.typeLabel.toLowerCase().includes(typeFilter.toLowerCase());

      const searchableText = [
        record.name,
        record.serialNumber,
        record.typeLabel,
        record.sourceStatusLabel,
        record.currentStatus,
        record.assignmentLabel,
        record.assignedOfficerName,
      ]
        .join(" ")
        .toLowerCase();

      const searchMatches =
        !normalizedSearch || searchableText.includes(normalizedSearch);

      return statusMatches && typeMatches && searchMatches;
    });
  }, [firearmRecords, searchText, statusFilter, typeFilter]);

  const assignedCount = firearmRecords.filter(
    (record) => record.assignedOfficerId,
  ).length;

  const unassignedCount = firearmRecords.filter(
    (record) => !record.assignedOfficerId,
  ).length;

  const unavailableCount = firearmRecords.filter((record) =>
    isUnavailableStatus(record.currentStatus),
  ).length;

  const openIssueCount = firearmRecords.reduce(
    (total, record) => total + record.openIssueCount,
    0,
  );

  return (
    <TracePointShell activePage="Armory">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
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
                View firearms, see who has them, update current status, and
                open a simple firearm record.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-400">
              <Shield size={14} className="text-blue-400" />
              {hasStoredWorkspace
                ? "Linked data available"
                : "Inventory view only"}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <StatCard
            label="Total Firearms"
            value={firearmRecords.length}
            sub="Inventory records"
          />
          <StatCard
            label="Assigned"
            value={assignedCount}
            sub="Issued to personnel"
          />
          <StatCard
            label="Unassigned"
            value={unassignedCount}
            sub="Available or inactive"
          />
          <StatCard
            label="Unavailable"
            value={unavailableCount}
            sub="OOS, maintenance, retired"
          />
          <StatCard
            label="Open Issues"
            value={openIssueCount}
            sub="Linked flags"
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
                onChange={(event) => setTypeFilter(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              >
                {TYPE_FILTERS.map((type) => (
                  <option key={type} value={type}>
                    {type}
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

        {!hasStoredWorkspace ? (
          <section className="rounded-3xl border border-blue-500/20 bg-blue-500/[0.06] p-4 text-[12px] text-blue-200">
            <div className="flex gap-3">
              <ClipboardList size={17} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-blue-100">
                  This page is focused on the current armory inventory.
                </p>
                <p className="mt-1 text-blue-200/80">
                  Inspection, maintenance, range, and qualification details will
                  appear as simple linked summaries once those modules save
                  firearm-related records.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_410px]">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <h2 className="text-[15px] font-bold text-white">
                  Inventory
                </h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {filteredRecords.length} of {firearmRecords.length} firearms
                  shown
                </p>
              </div>
            </div>

            {filteredRecords.length > 0 ? (
              <FirearmInventoryTable
                records={filteredRecords}
                selectedFirearmId={selectedRecord?.id ?? ""}
                onSelect={setSelectedFirearmId}
                onAssign={beginAssign}
                onReturn={beginReturn}
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
          </div>

          {selectedRecord ? (
            <SelectedFirearmRecord
              record={selectedRecord}
              onStatusChange={handleStatusChange}
              onAssign={beginAssign}
              onReturn={beginReturn}
            />
          ) : null}
        </section>
      </div>

      <AssignmentModal
        dialog={assignmentDialog}
        records={firearmRecords}
        selectedOfficerId={selectedOfficerId}
        onSelectedOfficerChange={setSelectedOfficerId}
        onClose={closeAssignmentDialog}
        onConfirmAssign={confirmAssign}
        onConfirmReturn={confirmReturn}
      />
    </TracePointShell>
  );
}
