"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  ClipboardList,
  Crosshair,
  ExternalLink,
  Filter,
  History,
  Search,
  Shield,
  ShieldAlert,
  Target,
  User,
  Wrench,
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

type FirearmHistoryStatus =
  | "Ready"
  | "Attention"
  | "Out of Service"
  | "No Linked Qualification";

type FirearmStatusFilter = "All" | FirearmHistoryStatus;

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

type FirearmUseEvent = {
  id: string;
  rangeDayId: string;
  rangeDayTitle: string;
  rangeDayStatus: string;
  date: string;
  location: string;
  officerId: string;
  drillName: string;
  drillCategory: string;
  runNumber: number;
  runLabel: string;
  score?: number;
  passed?: boolean;
  completed: boolean;
  instructorId?: string;
  notes?: string;
  deficiencyObserved?: boolean;
  remedialTrainingRecommended?: boolean;
  malfunctionCount: number;
  isQualification: boolean;
  isRifle: boolean;
};

type FirearmHistoryRecord = {
  firearm: MockFirearm;
  firearmId: string;
  name: string;
  shortName: string;
  serialNumber: string;
  typeLabel: string;
  sourceStatusLabel: string;
  currentStatus: CurrentFirearmStatus;
  assignedOfficerIds: string[];
  lastRosteredOfficerIds: string[];
  useEvents: FirearmUseEvent[];
  qualificationEvents: FirearmUseEvent[];
  lastDayQualification?: FirearmUseEvent;
  lastNightQualification?: FirearmUseEvent;
  lastRifleQualification?: FirearmUseEvent;
  failedEvents: FirearmUseEvent[];
  malfunctions: FirearmMalfunction[];
  unresolvedMalfunctions: FirearmMalfunction[];
  removedFromServiceCount: number;
  inspectionRequiredCount: number;
  operationalStatus: FirearmHistoryStatus;
  statusReason: string;
};

type StatusOverrides = Record<string, CurrentFirearmStatus>;

const RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1";
const FIREARM_STATUS_STORAGE_KEY = "tracepoint.armory.statusOverrides.v1";

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

const STATUS_FILTERS: FirearmStatusFilter[] = [
  "All",
  "Ready",
  "Attention",
  "Out of Service",
  "No Linked Qualification",
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
    const storedOverrides = window.localStorage.getItem(
      FIREARM_STATUS_STORAGE_KEY,
    );

    if (!storedOverrides) return {};

    const parsed = JSON.parse(storedOverrides) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, CurrentFirearmStatus] =>
          typeof entry[1] === "string" &&
          CURRENT_STATUS_OPTIONS.includes(entry[1] as CurrentFirearmStatus),
      ),
    );
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

function formatDate(date?: string) {
  if (!date) return "No date";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(date?: string) {
  if (!date) return "No date";

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) return formatDate(date.slice(0, 10));

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDateValue(date?: string) {
  if (!date) return 0;

  const value = date.includes("T")
    ? new Date(date).getTime()
    : new Date(`${date}T00:00:00`).getTime();

  return Number.isNaN(value) ? 0 : value;
}

function getUserName(userId?: string) {
  if (!userId) return "Unassigned";

  return MOCK_USERS.find((user) => user.id === userId)?.name ?? "Unknown User";
}

function getFirearmName(firearm?: MockFirearm) {
  if (!firearm) return "Unknown firearm";

  return `${firearm.make} ${firearm.model}`;
}

function getFirearmShortName(firearm?: MockFirearm) {
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

function isOutOfServiceStatus(status: CurrentFirearmStatus) {
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

function isRifleDrill(drill?: RangeDayDrill) {
  if (!drill) return false;

  const name = drill.name.toLowerCase();
  const category = drill.category.toLowerCase();
  const firearmType = drill.firearmType?.toLowerCase() ?? "";

  return (
    name.includes("rifle") ||
    category.includes("rifle") ||
    firearmType.includes("rifle")
  );
}

function getRunLabel(drill?: RangeDayDrill, runNumber?: number) {
  if (isQualificationDrill(drill)) {
    if (runNumber === 1) return "Day Qualification";
    if (runNumber === 2) return "Night Qualification";
  }

  return `Run ${runNumber ?? 1}`;
}

function getOperationalStatusTone(status: FirearmHistoryStatus) {
  if (status === "Ready") return "green";
  if (status === "Attention") return "amber";
  if (status === "Out of Service") return "red";

  return "slate";
}

function getCurrentStatusTone(status: CurrentFirearmStatus) {
  if (status === "In Service" || status === "Assigned") return "green";
  if (status === "Maintenance" || status === "Inspection Required") {
    return "amber";
  }
  if (status === "Out of Service" || status === "Retired") return "red";

  return "slate";
}

function getPrimaryOfficerLabel(history: FirearmHistoryRecord) {
  if (history.lastRosteredOfficerIds.length > 0) {
    return history.lastRosteredOfficerIds.map(getUserName).join(", ");
  }

  if (history.assignedOfficerIds.length > 0) {
    return history.assignedOfficerIds.map(getUserName).join(", ");
  }

  return "Unassigned";
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

function evaluateFirearmStatus({
  currentStatus,
  lastDayQualification,
  lastNightQualification,
  failedEvents,
  unresolvedMalfunctions,
  removedFromServiceCount,
  inspectionRequiredCount,
}: {
  currentStatus: CurrentFirearmStatus;
  lastDayQualification?: FirearmUseEvent;
  lastNightQualification?: FirearmUseEvent;
  failedEvents: FirearmUseEvent[];
  unresolvedMalfunctions: FirearmMalfunction[];
  removedFromServiceCount: number;
  inspectionRequiredCount: number;
}): { operationalStatus: FirearmHistoryStatus; statusReason: string } {
  if (isOutOfServiceStatus(currentStatus) || removedFromServiceCount > 0) {
    return {
      operationalStatus: "Out of Service",
      statusReason:
        removedFromServiceCount > 0
          ? `${removedFromServiceCount} malfunction record(s) removed this firearm from service.`
          : `Current firearm status is ${currentStatus}.`,
    };
  }

  if (
    unresolvedMalfunctions.length > 0 ||
    inspectionRequiredCount > 0 ||
    failedEvents.length > 0
  ) {
    return {
      operationalStatus: "Attention",
      statusReason: `${unresolvedMalfunctions.length} unresolved malfunction(s), ${inspectionRequiredCount} inspection-required record(s), and ${failedEvents.length} failed record(s) are linked to this firearm.`,
    };
  }

  if (!lastDayQualification && !lastNightQualification) {
    return {
      operationalStatus: "No Linked Qualification",
      statusReason:
        "No day or night qualification record is currently linked to this firearm.",
    };
  }

  return {
    operationalStatus: "Ready",
    statusReason:
      "No open reliability flags are linked to this firearm record.",
  };
}

function buildFirearmHistories(
  workspace: StoredRangeDayWorkspace,
  statusOverrides: StatusOverrides,
) {
  const rangeDayById = new Map(
    workspace.rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]),
  );

  const drillById = new Map(
    workspace.rangeDayDrills.map((drill) => [drill.id, drill]),
  );

  const resultsByFirearmId = new Map<string, DrillRunResult[]>();
  const rosterByFirearmId = new Map<string, RangeRosterEntry[]>();
  const malfunctionsByFirearmId = new Map<string, FirearmMalfunction[]>();

  workspace.results.forEach((result) => {
    if (!result.firearmId) return;

    const current = resultsByFirearmId.get(result.firearmId) ?? [];
    current.push(result);
    resultsByFirearmId.set(result.firearmId, current);
  });

  workspace.rangeRoster.forEach((entry) => {
    (entry.assignedFirearmIds ?? []).forEach((firearmId) => {
      const current = rosterByFirearmId.get(firearmId) ?? [];
      current.push(entry);
      rosterByFirearmId.set(firearmId, current);
    });
  });

  workspace.malfunctions.forEach((malfunction) => {
    if (!malfunction.firearmId) return;

    const current = malfunctionsByFirearmId.get(malfunction.firearmId) ?? [];
    current.push(malfunction);
    malfunctionsByFirearmId.set(malfunction.firearmId, current);
  });

  return MOCK_FIREARMS.map<FirearmHistoryRecord>((firearm) => {
    const firearmResults = resultsByFirearmId.get(firearm.id) ?? [];
    const rosterEntries = rosterByFirearmId.get(firearm.id) ?? [];
    const firearmMalfunctions = (malfunctionsByFirearmId.get(firearm.id) ?? [])
      .slice()
      .sort((a, b) => getDateValue(b.date) - getDateValue(a.date));

    const directAssignedOfficerId = getDirectAssignedOfficerId(firearm);
    const rosterOfficerIds = rosterEntries.map((entry) => entry.officerId);
    const assignedOfficerIds = Array.from(
      new Set(
        [directAssignedOfficerId, ...rosterOfficerIds].filter(
          (officerId): officerId is string => Boolean(officerId),
        ),
      ),
    );

    const latestRosterDate = rosterEntries.reduce((latest, entry) => {
      const rangeDay = rangeDayById.get(entry.rangeDayId);
      const dateValue = getDateValue(rangeDay?.date);
      return Math.max(latest, dateValue);
    }, 0);

    const lastRosteredOfficerIds = Array.from(
      new Set(
        rosterEntries
          .filter((entry) => {
            const rangeDay = rangeDayById.get(entry.rangeDayId);
            return getDateValue(rangeDay?.date) === latestRosterDate;
          })
          .map((entry) => entry.officerId),
      ),
    );

    const useEvents = firearmResults
      .map<FirearmUseEvent>((result) => {
        const drill = drillById.get(result.drillId);
        const rangeDay = rangeDayById.get(result.rangeDayId);
        const linkedMalfunctionCount = workspace.malfunctions.filter(
          (malfunction) =>
            malfunction.firearmId === firearm.id &&
            (malfunction.drillRunId === result.id ||
              result.malfunctionIds?.includes(malfunction.id)),
        ).length;

        const isQualification = isQualificationDrill(drill);
        const isRifle = isRifleDrill(drill);

        return {
          id: result.id,
          rangeDayId: result.rangeDayId,
          rangeDayTitle: rangeDay?.title ?? "Unknown Range Day",
          rangeDayStatus: rangeDay?.status ?? "Unknown",
          date: rangeDay?.date ?? "",
          location: rangeDay?.location ?? "No location recorded",
          officerId: result.officerId,
          drillName: drill?.name ?? "Unknown Drill",
          drillCategory: drill?.category ?? "Unknown",
          runNumber: result.runNumber,
          runLabel: getRunLabel(drill, result.runNumber),
          score: result.score,
          passed: result.passed,
          completed: result.completed,
          instructorId: result.instructorId,
          notes: result.notes,
          deficiencyObserved: result.deficiencyObserved,
          remedialTrainingRecommended: result.remedialTrainingRecommended,
          malfunctionCount: linkedMalfunctionCount,
          isQualification,
          isRifle,
        };
      })
      .sort((a, b) => getDateValue(b.date) - getDateValue(a.date));

    const qualificationEvents = useEvents.filter(
      (event) => event.isQualification || event.isRifle,
    );

    const passedQualificationEvents = qualificationEvents.filter(
      (event) => event.passed === true || event.completed === true,
    );

    const lastDayQualification = passedQualificationEvents.find(
      (event) =>
        event.isQualification &&
        !event.isRifle &&
        event.runNumber === 1 &&
        event.runLabel.toLowerCase().includes("day"),
    );

    const lastNightQualification = passedQualificationEvents.find(
      (event) =>
        event.isQualification &&
        !event.isRifle &&
        event.runNumber === 2 &&
        event.runLabel.toLowerCase().includes("night"),
    );

    const lastRifleQualification = passedQualificationEvents.find(
      (event) => event.isRifle,
    );

    const failedEvents = qualificationEvents.filter(
      (event) => event.passed === false || event.deficiencyObserved,
    );

    const unresolvedMalfunctions = firearmMalfunctions.filter(
      (malfunction) => !malfunction.resolvedOnRange,
    );

    const removedFromServiceCount = firearmMalfunctions.filter(
      (malfunction) => malfunction.removedFromService,
    ).length;

    const inspectionRequiredCount = firearmMalfunctions.filter(
      (malfunction) => malfunction.inspectionRequired,
    ).length;

    const typeLabel = getFirearmTypeLabel(firearm);
    const sourceStatusLabel = getFirearmStatusLabel(firearm);
    const currentStatus =
      statusOverrides[firearm.id] ?? normalizeCurrentStatus(sourceStatusLabel);

    const evaluatedStatus = evaluateFirearmStatus({
      currentStatus,
      lastDayQualification,
      lastNightQualification,
      failedEvents,
      unresolvedMalfunctions,
      removedFromServiceCount,
      inspectionRequiredCount,
    });

    return {
      firearm,
      firearmId: firearm.id,
      name: getFirearmName(firearm),
      shortName: getFirearmShortName(firearm),
      serialNumber: firearm.serialNumber,
      typeLabel,
      sourceStatusLabel,
      currentStatus,
      assignedOfficerIds,
      lastRosteredOfficerIds,
      useEvents,
      qualificationEvents,
      lastDayQualification,
      lastNightQualification,
      lastRifleQualification,
      failedEvents,
      malfunctions: firearmMalfunctions,
      unresolvedMalfunctions,
      removedFromServiceCount,
      inspectionRequiredCount,
      ...evaluatedStatus,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function DetailMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
        {label}
      </p>
      <p className="mt-1 text-[15px] font-bold text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
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

function FirearmInventoryTable({
  histories,
  selectedFirearmId,
  onSelect,
}: {
  histories: FirearmHistoryRecord[];
  selectedFirearmId: string;
  onSelect: (firearmId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900">
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[940px] text-left">
          <thead className="border-b border-slate-800 bg-slate-950/60">
            <tr className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              <th className="px-4 py-3">Firearm</th>
              <th className="px-4 py-3">Serial</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Assigned / Reference</th>
              <th className="px-4 py-3">Current Status</th>
              <th className="px-4 py-3">Record Status</th>
              <th className="px-4 py-3 text-right">Open Issues</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800">
            {histories.map((history) => {
              const selected = selectedFirearmId === history.firearmId;
              const issueCount =
                history.unresolvedMalfunctions.length +
                history.failedEvents.length +
                history.inspectionRequiredCount +
                history.removedFromServiceCount;

              return (
                <tr
                  key={history.firearmId}
                  onClick={() => onSelect(history.firearmId)}
                  className={`cursor-pointer transition ${
                    selected
                      ? "bg-blue-500/10"
                      : "hover:bg-slate-800/60"
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-slate-500">
                        <Crosshair size={15} />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-white">
                          {history.name}
                        </p>
                        <p className="mt-0.5 max-w-md truncate text-[11px] text-slate-500">
                          {history.statusReason}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-[12px] font-semibold text-slate-300">
                    {history.serialNumber}
                  </td>

                  <td className="px-4 py-3">
                    <StatusPill label={history.typeLabel} tone="slate" />
                  </td>

                  <td className="px-4 py-3 text-[12px] text-slate-400">
                    {getPrimaryOfficerLabel(history)}
                  </td>

                  <td className="px-4 py-3">
                    <StatusPill
                      label={history.currentStatus}
                      tone={getCurrentStatusTone(history.currentStatus)}
                    />
                  </td>

                  <td className="px-4 py-3">
                    <StatusPill
                      label={history.operationalStatus}
                      tone={getOperationalStatusTone(
                        history.operationalStatus,
                      )}
                    />
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span
                      className={`text-[13px] font-bold ${
                        issueCount > 0 ? "text-amber-300" : "text-slate-500"
                      }`}
                    >
                      {issueCount}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-slate-800 xl:hidden">
        {histories.map((history) => {
          const selected = selectedFirearmId === history.firearmId;
          const issueCount =
            history.unresolvedMalfunctions.length +
            history.failedEvents.length +
            history.inspectionRequiredCount +
            history.removedFromServiceCount;

          return (
            <button
              key={history.firearmId}
              type="button"
              onClick={() => onSelect(history.firearmId)}
              className={`block w-full p-4 text-left transition ${
                selected ? "bg-blue-500/10" : "hover:bg-slate-800/60"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[14px] font-bold text-white">
                    {history.name}
                  </h3>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Serial {history.serialNumber}
                  </p>
                </div>

                <StatusPill
                  label={history.currentStatus}
                  tone={getCurrentStatusTone(history.currentStatus)}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill label={history.typeLabel} tone="slate" />
                <StatusPill
                  label={history.operationalStatus}
                  tone={getOperationalStatusTone(history.operationalStatus)}
                />
                {issueCount > 0 ? (
                  <StatusPill label={`${issueCount} Issues`} tone="amber" />
                ) : null}
              </div>

              <p className="mt-3 text-[11px] text-slate-500">
                Assigned/reference: {getPrimaryOfficerLabel(history)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UseEventRow({ event }: { event: FirearmUseEvent }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill label={event.runLabel} tone="slate" />
            {event.passed === true ? (
              <StatusPill label="Pass" tone="green" />
            ) : null}
            {event.passed === false ? (
              <StatusPill label="Fail" tone="red" />
            ) : null}
            {event.passed === undefined && event.completed ? (
              <StatusPill label="Completed" tone="green" />
            ) : null}
            {event.deficiencyObserved ? (
              <StatusPill label="Deficiency" tone="red" />
            ) : null}
            {event.malfunctionCount > 0 ? (
              <StatusPill label="Malfunction" tone="amber" />
            ) : null}
          </div>

          <h4 className="text-[13px] font-bold text-white">
            {event.drillName}
          </h4>
          <p className="mt-1 text-[11px] text-slate-500">
            {event.rangeDayTitle} · {event.location}
          </p>
        </div>

        <div className="text-left text-[11px] text-slate-400 sm:text-right">
          <p>{formatDate(event.date)}</p>
          <p>Officer: {getUserName(event.officerId)}</p>
        </div>
      </div>
    </div>
  );
}

function MalfunctionRow({
  malfunction,
}: {
  malfunction: FirearmMalfunction;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill label={malfunction.type} tone="amber" />
            {malfunction.removedFromService ? (
              <StatusPill label="Removed From Service" tone="red" />
            ) : null}
            {malfunction.inspectionRequired ? (
              <StatusPill label="Inspection Required" tone="red" />
            ) : null}
            {malfunction.resolvedOnRange ? (
              <StatusPill label="Resolved On Range" tone="green" />
            ) : null}
          </div>

          <h4 className="text-[13px] font-bold text-white">
            {malfunction.type}
          </h4>
          <p className="mt-1 text-[11px] text-slate-500">
            Officer: {getUserName(malfunction.officerId)} · Reported by:{" "}
            {getUserName(malfunction.reportedByUserId)}
          </p>
        </div>

        <div className="text-left text-[11px] text-slate-400 sm:text-right">
          <p>{formatDateTime(malfunction.date)}</p>
          <p>{malfunction.rangeDayId ? "Range-linked" : "Inventory-linked"}</p>
        </div>
      </div>

      {malfunction.notes ? (
        <p className="mt-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-400">
          {malfunction.notes}
        </p>
      ) : null}
    </div>
  );
}

function SelectedFirearmPanel({
  history,
  onStatusChange,
}: {
  history: FirearmHistoryRecord;
  onStatusChange: (firearmId: string, status: CurrentFirearmStatus) => void;
}) {
  const latestUse = history.useEvents[0];
  const latestMalfunction = history.malfunctions[0];

  return (
    <aside className="space-y-4 xl:sticky xl:top-6">
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap gap-2">
              <StatusPill
                label={history.currentStatus}
                tone={getCurrentStatusTone(history.currentStatus)}
              />
              <StatusPill label={history.typeLabel} tone="slate" />
            </div>

            <h2 className="text-[20px] font-bold leading-tight text-white">
              {history.name}
            </h2>
            <p className="mt-1 text-[12px] text-slate-500">
              Serial {history.serialNumber}
            </p>
          </div>

          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950 text-blue-400">
            <Crosshair size={18} />
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            Update Firearm Status
          </label>
          <select
            value={history.currentStatus}
            onChange={(event) =>
              onStatusChange(
                history.firearmId,
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
            Armory controls the current firearm status. Inspection,
            maintenance, and qualification details are managed in their own
            modules and surfaced here as linked history.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <DetailMetric
          label="Assignment"
          value={getPrimaryOfficerLabel(history)}
          sub="Current or latest reference"
        />
        <DetailMetric
          label="Record Status"
          value={history.operationalStatus}
          sub="Computed from linked history"
        />
        <DetailMetric
          label="Open Issues"
          value={
            history.unresolvedMalfunctions.length +
            history.failedEvents.length +
            history.inspectionRequiredCount +
            history.removedFromServiceCount
          }
          sub="Reliability/compliance"
        />
        <DetailMetric
          label="Use Records"
          value={history.useEvents.length}
          sub="Range/training links"
        />
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
            <User size={15} className="text-blue-400" />
            Firearm Record
          </h3>
        </div>

        <div className="space-y-3">
          <DetailMetric
            label="Make / Model"
            value={history.shortName}
            sub={history.typeLabel}
          />
          <DetailMetric
            label="Serial Number"
            value={history.serialNumber}
            sub={`Original status: ${history.sourceStatusLabel}`}
          />
          <DetailMetric
            label="Officer References"
            value={
              history.assignedOfficerIds.length > 0
                ? history.assignedOfficerIds.map(getUserName).join(", ")
                : "None"
            }
            sub="Direct and range-day references"
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
            <ClipboardList size={15} className="text-blue-400" />
            Linked Inspection / Maintenance
          </h3>
          <ModuleLink href="/inspections" label="Open Module" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DetailMetric
            label="Inspection Req."
            value={history.inspectionRequiredCount}
            sub="From linked records"
          />
          <DetailMetric
            label="OOS Events"
            value={history.removedFromServiceCount}
            sub="Removed from service"
          />
          <DetailMetric
            label="Malfunctions"
            value={history.malfunctions.length}
            sub={`${history.unresolvedMalfunctions.length} unresolved`}
          />
          <DetailMetric
            label="Latest Issue"
            value={latestMalfunction ? latestMalfunction.type : "None"}
            sub={
              latestMalfunction
                ? formatDateTime(latestMalfunction.date)
                : "No linked issue"
            }
          />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
            <History size={15} className="text-blue-400" />
            Linked Range / Qualification
          </h3>
          <div className="flex flex-wrap gap-2">
            <ModuleLink href="/range-days" label="Range" />
            <ModuleLink href="/qualifications" label="Quals" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <DetailMetric
            label="Day Qual"
            value={
              history.lastDayQualification
                ? formatDate(history.lastDayQualification.date)
                : "Missing"
            }
            sub={
              history.lastDayQualification
                ? getUserName(history.lastDayQualification.officerId)
                : "No linked record"
            }
          />
          <DetailMetric
            label="Night Qual"
            value={
              history.lastNightQualification
                ? formatDate(history.lastNightQualification.date)
                : "Missing"
            }
            sub={
              history.lastNightQualification
                ? getUserName(history.lastNightQualification.officerId)
                : "No linked record"
            }
          />
          <DetailMetric
            label="Rifle"
            value={
              history.lastRifleQualification
                ? formatDate(history.lastRifleQualification.date)
                : "—"
            }
            sub={
              history.lastRifleQualification
                ? history.lastRifleQualification.drillName
                : "No rifle record"
            }
          />
          <DetailMetric
            label="Latest Use"
            value={latestUse ? formatDate(latestUse.date) : "None"}
            sub={latestUse ? latestUse.drillName : "No linked use"}
          />
        </div>
      </section>

      {history.operationalStatus !== "Ready" ? (
        <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.08] p-4 text-[12px] text-amber-200">
          <div className="flex gap-3">
            <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold text-amber-100">
                Firearm review recommended
              </p>
              <p className="mt-1 text-amber-200/80">
                {history.statusReason}
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </aside>
  );
}

export default function FirearmsPage() {
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [hasStoredWorkspace, setHasStoredWorkspace] = useState(false);
  const [statusOverrides, setStatusOverrides] =
    useState<StatusOverrides>({});
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<FirearmStatusFilter>("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [selectedFirearmId, setSelectedFirearmId] = useState<string>(
    MOCK_FIREARMS[0]?.id ?? "",
  );

  useEffect(() => {
    const storedWorkspace = loadStoredRangeDayWorkspace();

    if (storedWorkspace) {
      setWorkspace(storedWorkspace);
      setHasStoredWorkspace(true);
    }

    setStatusOverrides(loadStatusOverrides());
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

  const firearmHistories = useMemo(
    () => buildFirearmHistories(workspace, statusOverrides),
    [workspace, statusOverrides],
  );

  const selectedHistory =
    firearmHistories.find(
      (history) => history.firearmId === selectedFirearmId,
    ) ?? firearmHistories[0];

  const filteredHistories = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return firearmHistories.filter((history) => {
      const statusMatches =
        statusFilter === "All" ||
        history.operationalStatus === statusFilter;

      const typeMatches =
        typeFilter === "All" ||
        history.typeLabel.toLowerCase().includes(typeFilter.toLowerCase()) ||
        history.qualificationEvents.some((event) =>
          event.drillName.toLowerCase().includes(typeFilter.toLowerCase()),
        );

      const searchableText = [
        history.name,
        history.shortName,
        history.serialNumber,
        history.typeLabel,
        history.currentStatus,
        history.sourceStatusLabel,
        history.operationalStatus,
        history.statusReason,
        ...history.assignedOfficerIds.map(getUserName),
        ...history.useEvents.flatMap((event) => [
          event.rangeDayTitle,
          event.drillName,
          event.runLabel,
          event.location,
          event.notes ?? "",
          getUserName(event.officerId),
          getUserName(event.instructorId),
        ]),
        ...history.malfunctions.flatMap((malfunction) => [
          malfunction.type,
          malfunction.notes ?? "",
          getUserName(malfunction.officerId),
        ]),
      ]
        .join(" ")
        .toLowerCase();

      const searchMatches =
        !normalizedSearch || searchableText.includes(normalizedSearch);

      return statusMatches && typeMatches && searchMatches;
    });
  }, [firearmHistories, searchText, statusFilter, typeFilter]);

  const assignedCount = firearmHistories.filter(
    (history) => history.assignedOfficerIds.length > 0,
  ).length;

  const outOfServiceCount = firearmHistories.filter((history) =>
    isOutOfServiceStatus(history.currentStatus),
  ).length;

  const openIssueCount = firearmHistories.reduce(
    (total, history) =>
      total +
      history.unresolvedMalfunctions.length +
      history.failedEvents.length +
      history.inspectionRequiredCount +
      history.removedFromServiceCount,
    0,
  );

  const missingQualificationLinkCount = firearmHistories.filter(
    (history) => history.operationalStatus === "No Linked Qualification",
  ).length;

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
                Update firearm status and view the consolidated firearm record:
                assignment references, inspection/maintenance flags,
                malfunctions, range use, and qualification links.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-400">
              <Shield size={14} className="text-blue-400" />
              {hasStoredWorkspace
                ? "Connected to saved range data"
                : "No saved range data yet"}
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <StatCard
            label="Total Firearms"
            value={firearmHistories.length}
            sub="Inventory records"
          />
          <StatCard
            label="Assigned"
            value={assignedCount}
            sub="Assignment/reference found"
          />
          <StatCard
            label="Out of Service"
            value={outOfServiceCount}
            sub="Status control"
          />
          <StatCard
            label="Open Issues"
            value={openIssueCount}
            sub="Linked flags"
          />
          <StatCard
            label="Qual Link Missing"
            value={missingQualificationLinkCount}
            sub="No day/night reference"
          />
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_240px_220px_auto] lg:items-end">
            <div>
              <label className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                <Search size={12} />
                Search
              </label>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search firearm, serial, officer, range day, malfunction, drill..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none transition focus:border-blue-500"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                <Filter size={12} />
                Record Status
              </label>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as FirearmStatusFilter)
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
                <Target size={12} />
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
                  Linked firearm history is not populated yet.
                </p>
                <p className="mt-1 text-blue-200/80">
                  Armory can still control firearm status. Range, inspection,
                  maintenance, and qualification records will appear here once
                  those modules save linked data.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <h2 className="text-[15px] font-bold text-white">
                  Inventory Records
                </h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  {filteredHistories.length} of {firearmHistories.length}{" "}
                  firearms shown
                </p>
              </div>
            </div>

            {filteredHistories.length > 0 ? (
              <FirearmInventoryTable
                histories={filteredHistories}
                selectedFirearmId={selectedHistory?.firearmId ?? ""}
                onSelect={setSelectedFirearmId}
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

            {selectedHistory ? (
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-[16px] font-bold text-white">
                      <History size={16} className="text-blue-400" />
                      Recent Range / Qualification References
                    </h3>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Read-only linked records for the selected firearm.
                    </p>
                  </div>
                  <StatusPill
                    label={`${selectedHistory.useEvents.length} records`}
                    tone="slate"
                  />
                </div>

                <div className="space-y-3">
                  {selectedHistory.useEvents.length > 0 ? (
                    selectedHistory.useEvents
                      .slice(0, 6)
                      .map((event) => (
                        <UseEventRow key={event.id} event={event} />
                      ))
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-[12px] text-slate-500">
                      No range scoring records are linked to this firearm yet.
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            {selectedHistory ? (
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-[16px] font-bold text-white">
                      <Wrench size={16} className="text-blue-400" />
                      Recent Malfunctions / Inspection Flags
                    </h3>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Read-only reliability records linked from range and
                      inspection workflows.
                    </p>
                  </div>
                  {selectedHistory.malfunctions.length > 0 ? (
                    <StatusPill
                      label={`${selectedHistory.malfunctions.length} records`}
                      tone="amber"
                    />
                  ) : (
                    <StatusPill label="No records" tone="green" />
                  )}
                </div>

                <div className="space-y-3">
                  {selectedHistory.malfunctions.length > 0 ? (
                    selectedHistory.malfunctions
                      .slice(0, 6)
                      .map((malfunction) => (
                        <MalfunctionRow
                          key={malfunction.id}
                          malfunction={malfunction}
                        />
                      ))
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-[12px] text-slate-500">
                      No malfunction or inspection records are linked to this
                      firearm.
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </div>

          {selectedHistory ? (
            <SelectedFirearmPanel
              history={selectedHistory}
              onStatusChange={handleStatusChange}
            />
          ) : null}
        </section>
      </div>
    </TracePointShell>
  );
}