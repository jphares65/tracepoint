"use client";

import { useEffect, useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  ClipboardList,
  Crosshair,
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

type FirearmHistoryStatus =
  | "Qualified"
  | "Missing Night"
  | "Attention"
  | "No Qual"
  | "Out of Service";

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
  statusLabel: string;
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
  status: FirearmHistoryStatus;
  statusReason: string;
};

const RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1";

const EMPTY_WORKSPACE: StoredRangeDayWorkspace = {
  rangeDays: [],
  drillLibrary: [],
  rangeDayDrills: [],
  rangeRoster: [],
  results: [],
  malfunctions: [],
};

const STATUS_FILTERS: FirearmStatusFilter[] = [
  "All",
  "Qualified",
  "Missing Night",
  "Attention",
  "No Qual",
  "Out of Service",
];

const TYPE_FILTERS = ["All", "Handgun", "Rifle", "Shotgun", "Less Lethal", "Other"];

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
      drillLibrary: Array.isArray(parsed.drillLibrary) ? parsed.drillLibrary : [],
      rangeDayDrills: Array.isArray(parsed.rangeDayDrills)
        ? parsed.rangeDayDrills
        : [],
      rangeRoster: Array.isArray(parsed.rangeRoster) ? parsed.rangeRoster : [],
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

  return `${firearm.make} ${firearm.model} (${firearm.serialNumber})`;
}

function getFirearmShortName(firearm?: MockFirearm) {
  if (!firearm) return "Unknown firearm";

  return `${firearm.model} · ${firearm.serialNumber}`;
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
    ]) ?? "Active"
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

function isOutOfServiceStatus(statusLabel: string) {
  const normalized = statusLabel.toLowerCase();

  return (
    normalized.includes("out") ||
    normalized.includes("oos") ||
    normalized.includes("maintenance") ||
    normalized.includes("repair") ||
    normalized.includes("inactive")
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

function getStatusTone(status: FirearmHistoryStatus) {
  if (status === "Qualified") return "green";
  if (status === "Missing Night") return "blue";
  if (status === "Attention") return "amber";
  if (status === "Out of Service") return "red";

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
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${styles[tone]}`}
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

function evaluateFirearmStatus({
  statusLabel,
  lastDayQualification,
  lastNightQualification,
  failedEvents,
  unresolvedMalfunctions,
  removedFromServiceCount,
  inspectionRequiredCount,
}: {
  statusLabel: string;
  lastDayQualification?: FirearmUseEvent;
  lastNightQualification?: FirearmUseEvent;
  failedEvents: FirearmUseEvent[];
  unresolvedMalfunctions: FirearmMalfunction[];
  removedFromServiceCount: number;
  inspectionRequiredCount: number;
}): { status: FirearmHistoryStatus; statusReason: string } {
  if (isOutOfServiceStatus(statusLabel) || removedFromServiceCount > 0) {
    return {
      status: "Out of Service",
      statusReason:
        removedFromServiceCount > 0
          ? `${removedFromServiceCount} malfunction record(s) removed this firearm from service.`
          : `Inventory status is ${statusLabel}.`,
    };
  }

  if (unresolvedMalfunctions.length > 0 || inspectionRequiredCount > 0) {
    return {
      status: "Attention",
      statusReason: `${unresolvedMalfunctions.length} unresolved malfunction(s); ${inspectionRequiredCount} inspection-required record(s).`,
    };
  }

  if (failedEvents.length > 0) {
    return {
      status: "Attention",
      statusReason: `${failedEvents.length} failed qualification/drill record(s) are linked to this firearm.`,
    };
  }

  if (!lastDayQualification && !lastNightQualification) {
    return {
      status: "No Qual",
      statusReason: "No day or night qualification result is linked to this firearm yet.",
    };
  }

  if (!lastDayQualification || !lastNightQualification) {
    return {
      status: "Missing Night",
      statusReason:
        "Qualification history is incomplete because day and night records are not both present.",
    };
  }

  return {
    status: "Qualified",
    statusReason:
      "Day and night qualification records are both linked to this firearm.",
  };
}

function buildFirearmHistories(workspace: StoredRangeDayWorkspace) {
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
    const statusLabel = getFirearmStatusLabel(firearm);

    const evaluatedStatus = evaluateFirearmStatus({
      statusLabel,
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
      statusLabel,
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

function FirearmSummaryCard({
  history,
  selected,
  onClick,
}: {
  history: FirearmHistoryRecord;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border p-4 text-left transition hover:-translate-y-[1px] hover:border-blue-500/40 hover:bg-slate-800/70 ${
        selected
          ? "border-blue-500/50 bg-blue-500/10"
          : "border-slate-800 bg-slate-900"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill
              label={history.status}
              tone={getStatusTone(history.status)}
            />
            <StatusPill label={history.typeLabel} tone="slate" />
            {history.malfunctions.length > 0 && (
              <StatusPill label="Malfunction" tone="amber" />
            )}
          </div>

          <h3 className="text-[15px] font-bold text-white">{history.name}</h3>
          <p className="mt-1 text-[11px] text-slate-500">
            {history.statusReason}
          </p>
        </div>

        <Crosshair size={17} className="mt-1 text-slate-600" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Day Qual
          </p>
          <p className="mt-1 font-semibold text-white">
            {history.lastDayQualification
              ? formatDate(history.lastDayQualification.date)
              : "Missing"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Night Qual
          </p>
          <p className="mt-1 font-semibold text-white">
            {history.lastNightQualification
              ? formatDate(history.lastNightQualification.date)
              : "Missing"}
          </p>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        <p>
          Last rostered: {" "}
          {history.lastRosteredOfficerIds.length > 0
            ? history.lastRosteredOfficerIds.map(getUserName).join(", ")
            : history.assignedOfficerIds.length > 0
              ? history.assignedOfficerIds.map(getUserName).join(", ")
              : "No officer assignment found"}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest text-slate-600">
        <span>{history.useEvents.length} uses</span>
        <span>·</span>
        <span>{history.qualificationEvents.length} qual refs</span>
        {history.malfunctions.length > 0 && (
          <>
            <span>·</span>
            <span className="text-amber-300">
              {history.malfunctions.length} malfunction
              {history.malfunctions.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

function UseEventRow({ event }: { event: FirearmUseEvent }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill label={event.runLabel} tone="slate" />
            {event.passed === true && <StatusPill label="Pass" tone="green" />}
            {event.passed === false && <StatusPill label="Fail" tone="red" />}
            {event.passed === undefined && event.completed && (
              <StatusPill label="Completed" tone="green" />
            )}
            {event.deficiencyObserved && (
              <StatusPill label="Deficiency" tone="red" />
            )}
            {event.malfunctionCount > 0 && (
              <StatusPill label="Malfunction" tone="amber" />
            )}
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

      <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Score
          </p>
          <p className="mt-1 font-semibold text-white">
            {event.score ?? "—"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Category
          </p>
          <p className="mt-1 font-semibold text-white">
            {event.drillCategory}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Instructor
          </p>
          <p className="mt-1 font-semibold text-white">
            {getUserName(event.instructorId)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Remedial
          </p>
          <p className="mt-1 font-semibold text-white">
            {event.remedialTrainingRecommended ? "Yes" : "No"}
          </p>
        </div>
      </div>

      {event.notes && (
        <p className="mt-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-400">
          {event.notes}
        </p>
      )}
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
            {malfunction.removedFromService && (
              <StatusPill label="Removed From Service" tone="red" />
            )}
            {malfunction.inspectionRequired && (
              <StatusPill label="Inspection Required" tone="red" />
            )}
            {malfunction.resolvedOnRange && (
              <StatusPill label="Resolved On Range" tone="green" />
            )}
          </div>

          <h4 className="text-[13px] font-bold text-white">
            {malfunction.type}
          </h4>
          <p className="mt-1 text-[11px] text-slate-500">
            Officer: {getUserName(malfunction.officerId)} · Reported by: {" "}
            {getUserName(malfunction.reportedByUserId)}
          </p>
        </div>

        <div className="text-left text-[11px] text-slate-400 sm:text-right">
          <p>{formatDateTime(malfunction.date)}</p>
          <p>{malfunction.rangeDayId ? "Range-linked" : "Inventory-linked"}</p>
        </div>
      </div>

      {malfunction.notes && (
        <p className="mt-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] text-slate-400">
          {malfunction.notes}
        </p>
      )}
    </div>
  );
}

export default function FirearmsPage() {
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [hasStoredWorkspace, setHasStoredWorkspace] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<FirearmStatusFilter>("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [selectedFirearmId, setSelectedFirearmId] = useState<string>(
    MOCK_FIREARMS[0]?.id ?? "",
  );

  useEffect(() => {
    const storedWorkspace = loadStoredRangeDayWorkspace();

    if (!storedWorkspace) return;

    setWorkspace(storedWorkspace);
    setHasStoredWorkspace(true);
  }, []);

  const firearmHistories = useMemo(
    () => buildFirearmHistories(workspace),
    [workspace],
  );

  const selectedHistory =
    firearmHistories.find(
      (history) => history.firearmId === selectedFirearmId,
    ) ?? firearmHistories[0];

  const filteredHistories = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return firearmHistories.filter((history) => {
      const statusMatches =
        statusFilter === "All" || history.status === statusFilter;

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
        history.statusLabel,
        history.status,
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

  const qualifiedCount = firearmHistories.filter(
    (history) => history.status === "Qualified",
  ).length;

  const attentionCount = firearmHistories.filter((history) =>
    ["Attention", "Missing Night", "Out of Service"].includes(history.status),
  ).length;

  const malfunctionCount = firearmHistories.reduce(
    (total, history) => total + history.malfunctions.length,
    0,
  );

  const noQualCount = firearmHistories.filter(
    (history) => history.status === "No Qual",
  ).length;

  return (
    <TracePointShell activePage="Firearms">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-white">
                Firearm History
              </h1>
              <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
                Review each firearm's assignment references, day/night qualification
                history, range usage, malfunctions, and inspection concerns from
                saved TracePoint range records.
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
            label="Inventory"
            value={firearmHistories.length}
            sub="Firearms tracked"
          />
          <StatCard
            label="Qualified"
            value={qualifiedCount}
            sub="Day/night records linked"
          />
          <StatCard
            label="Needs Review"
            value={attentionCount}
            sub="Attention/missing/OOS"
          />
          <StatCard
            label="Malfunctions"
            value={malfunctionCount}
            sub="Range-linked records"
          />
          <StatCard
            label="No Qual"
            value={noQualCount}
            sub="No linked qual result"
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
                placeholder="Search firearm, serial, officer, range day, malfunction, drill..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
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
                  setStatusFilter(event.target.value as FirearmStatusFilter)
                }
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
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
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
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
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
            >
              <X size={14} />
              Clear
            </button>
          </div>
        </section>

        {!hasStoredWorkspace && (
          <section className="rounded-3xl border border-blue-500/20 bg-blue-500/[0.06] p-4 text-[12px] text-blue-200">
            <div className="flex gap-3">
              <ClipboardList size={17} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-blue-100">
                  This page will become more useful after range data is saved.
                </p>
                <p className="mt-1 text-blue-200/80">
                  Create a range day, assign firearms, enter day/night scores,
                  log malfunctions, and click Save Range Day. This page will then
                  build firearm histories from that saved local workspace.
                </p>
              </div>
            </div>
          </section>
        )}

        <section className="grid gap-5 xl:grid-cols-[440px_1fr]">
          <div className="space-y-3">
            {filteredHistories.length > 0 ? (
              filteredHistories.map((history) => (
                <FirearmSummaryCard
                  key={history.firearmId}
                  history={history}
                  selected={selectedHistory?.firearmId === history.firearmId}
                  onClick={() => setSelectedFirearmId(history.firearmId)}
                />
              ))
            ) : (
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center">
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

          {selectedHistory && (
            <div className="space-y-5">
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="mb-2 flex flex-wrap gap-2">
                      <StatusPill
                        label={selectedHistory.status}
                        tone={getStatusTone(selectedHistory.status)}
                      />
                      <StatusPill
                        label={selectedHistory.typeLabel}
                        tone="slate"
                      />
                      <StatusPill
                        label={selectedHistory.statusLabel}
                        tone="slate"
                      />
                    </div>

                    <h2 className="text-[21px] font-bold text-white">
                      {selectedHistory.name}
                    </h2>
                    <p className="mt-1 text-[12px] text-slate-500">
                      {selectedHistory.statusReason}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-[12px] text-slate-400">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Serial Number
                    </p>
                    <p className="mt-1 font-semibold text-white">
                      {selectedHistory.serialNumber}
                    </p>
                  </div>
                </div>
              </section>

              <section className="grid gap-3 lg:grid-cols-4">
                <StatCard
                  label="Day Qual"
                  value={
                    selectedHistory.lastDayQualification
                      ? formatDate(selectedHistory.lastDayQualification.date)
                      : "Missing"
                  }
                  sub={
                    selectedHistory.lastDayQualification
                      ? getUserName(selectedHistory.lastDayQualification.officerId)
                      : "No linked record"
                  }
                />
                <StatCard
                  label="Night Qual"
                  value={
                    selectedHistory.lastNightQualification
                      ? formatDate(selectedHistory.lastNightQualification.date)
                      : "Missing"
                  }
                  sub={
                    selectedHistory.lastNightQualification
                      ? getUserName(selectedHistory.lastNightQualification.officerId)
                      : "No linked record"
                  }
                />
                <StatCard
                  label="Rifle"
                  value={
                    selectedHistory.lastRifleQualification
                      ? formatDate(selectedHistory.lastRifleQualification.date)
                      : "—"
                  }
                  sub={
                    selectedHistory.lastRifleQualification
                      ? selectedHistory.lastRifleQualification.drillName
                      : "No rifle record"
                  }
                />
                <StatCard
                  label="Malfunctions"
                  value={selectedHistory.malfunctions.length}
                  sub={`${selectedHistory.unresolvedMalfunctions.length} unresolved`}
                />
              </section>

              <section className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-white">
                    <User size={15} className="text-blue-400" />
                    Assignment References
                  </h3>

                  <div className="space-y-3 text-[12px] text-slate-400">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Last Rostered Officer
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {selectedHistory.lastRosteredOfficerIds.length > 0
                          ? selectedHistory.lastRosteredOfficerIds
                              .map(getUserName)
                              .join(", ")
                          : "No range roster reference"}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        All Officer References
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {selectedHistory.assignedOfficerIds.length > 0
                          ? selectedHistory.assignedOfficerIds
                              .map(getUserName)
                              .join(", ")
                          : "No officer references found"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                  <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-white">
                    <ShieldAlert size={15} className="text-blue-400" />
                    Reliability Flags
                  </h3>

                  <div className="grid grid-cols-2 gap-3 text-[12px] text-slate-400">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Failed Records
                      </p>
                      <p className="mt-1 text-xl font-bold text-white">
                        {selectedHistory.failedEvents.length}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Inspection Req.
                      </p>
                      <p className="mt-1 text-xl font-bold text-white">
                        {selectedHistory.inspectionRequiredCount}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        OOS Events
                      </p>
                      <p className="mt-1 text-xl font-bold text-white">
                        {selectedHistory.removedFromServiceCount}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Total Uses
                      </p>
                      <p className="mt-1 text-xl font-bold text-white">
                        {selectedHistory.useEvents.length}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-[16px] font-bold text-white">
                      <History size={16} className="text-blue-400" />
                      Range / Qualification Timeline
                    </h3>
                    <p className="mt-1 text-[12px] text-slate-500">
                      All saved scoring records linked to this firearm.
                    </p>
                  </div>
                  <StatusPill
                    label={`${selectedHistory.useEvents.length} records`}
                    tone="slate"
                  />
                </div>

                <div className="space-y-3">
                  {selectedHistory.useEvents.length > 0 ? (
                    selectedHistory.useEvents.map((event) => (
                      <UseEventRow key={event.id} event={event} />
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-[12px] text-slate-500">
                      No range scoring records are linked to this firearm yet.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-[16px] font-bold text-white">
                      <Wrench size={16} className="text-blue-400" />
                      Malfunctions / Inspection History
                    </h3>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Malfunctions captured from range-day scoring and linked to
                      this firearm record.
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
                    selectedHistory.malfunctions.map((malfunction) => (
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

              {selectedHistory.status !== "Qualified" && (
                <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.08] p-4 text-[12px] text-amber-200">
                  <div className="flex gap-3">
                    <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-amber-100">
                        Firearm review recommended
                      </p>
                      <p className="mt-1 text-amber-200/80">
                        {selectedHistory.statusReason} Review the timeline,
                        malfunction records, and assignment history before using
                        this firearm as a compliance-ready record.
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}
        </section>
      </div>
    </TracePointShell>
  );
}
