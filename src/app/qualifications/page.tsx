"use client";

import { useEffect, useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  Crosshair,
  FileText,
  Filter,
  History,
  Moon,
  Search,
  Shield,
  ShieldAlert,
  Sun,
  Target,
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
  DEMO_DEPARTMENT,
  MOCK_FIREARMS,
  MOCK_USERS,
} from "@/app/lib/tracepoint/mock-data";

type QualificationStatus =
  | "Current"
  | "Due Soon"
  | "Overdue"
  | "Missing Night"
  | "Failed"
  | "No Record";

type OfficerStatusFilter = "All" | QualificationStatus;

type PilotPersonnel = {
  id: string;
  userId: string;
  displayName: string;
  fullName: string;
  email?: string | null;
  badgeNumber?: string | null;
  rankTitle?: string | null;
  unitName?: string | null;
  employeeNumber?: string | null;
  assignment?: string;
  roles?: string[];
  isActive?: boolean;
};

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

type OfficerQualificationEvent = {
  id: string;
  rangeDayId: string;
  rangeDayTitle: string;
  rangeDayStatus: string;
  date: string;
  location: string;
  drillName: string;
  drillCategory: string;
  runNumber: number;
  runLabel: string;
  firearmId?: string;
  score?: number;
  passed?: boolean;
  completed: boolean;
  instructorId?: string;
  notes?: string;
  deficiencyObserved?: boolean;
  remedialTrainingRecommended?: boolean;
  malfunctionCount: number;
};

type OfficerHistory = {
  officerId: string;
  officerName: string;
  assignedFirearmIds: string[];
  rosterCount: number;
  missedRangeDays: number;
  qualificationEvents: OfficerQualificationEvent[];
  lastDayQualification?: OfficerQualificationEvent;
  lastNightQualification?: OfficerQualificationEvent;
  lastQualification?: OfficerQualificationEvent;
  lastRifleQualification?: OfficerQualificationEvent;
  failedQualifications: OfficerQualificationEvent[];
  malfunctionCount: number;
  status: QualificationStatus;
  statusReason: string;
  daysSinceLastQualification?: number;
};

const RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1";
const QUALIFICATION_VALID_DAYS = 365;
const DUE_SOON_DAYS = 335;

const EMPTY_WORKSPACE: StoredRangeDayWorkspace = {
  rangeDays: [],
  drillLibrary: [],
  rangeDayDrills: [],
  rangeRoster: [],
  results: [],
  malfunctions: [],
};

const FALLBACK_PERSONNEL: PilotPersonnel[] = MOCK_USERS.map((user: any) => ({
  id: user.id,
  userId: user.id,
  displayName: user.name ?? user.fullName ?? user.email ?? "Demo Officer",
  fullName: user.name ?? user.fullName ?? "Demo Officer",
  email: user.email ?? null,
  badgeNumber: user.badgeNumber ?? user.badge ?? user.employeeNumber ?? null,
  rankTitle: user.rankTitle ?? user.rank ?? null,
  unitName: user.unitName ?? user.unit ?? user.assignment ?? null,
  employeeNumber: user.employeeNumber ?? null,
  assignment: user.assignment ?? user.unitName ?? user.unit ?? "Patrol",
  roles: user.roles ?? [],
  isActive: true,
}));

let activePersonnelDirectory: PilotPersonnel[] = FALLBACK_PERSONNEL;

const STATUS_FILTERS: OfficerStatusFilter[] = [
  "All",
  "Current",
  "Due Soon",
  "Overdue",
  "Missing Night",
  "Failed",
  "No Record",
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


async function loadPilotPersonnel() {
  if (typeof window === "undefined") {
    return {
      personnel: FALLBACK_PERSONNEL,
      source: "fallback",
    };
  }

  try {
    const response = await fetch("/api/pilot/personnel", {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Unable to load pilot personnel.");
    }

    const payload = (await response.json()) as {
      personnel?: PilotPersonnel[];
      source?: string;
    };

    const personnel = Array.isArray(payload.personnel)
      ? payload.personnel
      : [];

    if (personnel.length === 0) {
      return {
        personnel: FALLBACK_PERSONNEL,
        source: "fallback",
      };
    }

    return {
      personnel,
      source: payload.source ?? "supabase_department_memberships",
    };
  } catch (error) {
    console.warn("Could not load pilot personnel.", error);

    return {
      personnel: FALLBACK_PERSONNEL,
      source: "fallback",
    };
  }
}

async function loadRemoteRangeDayWorkspace(): Promise<StoredRangeDayWorkspace | null> {
  if (typeof window === "undefined") return null;

  try {
    const response = await fetch("/api/pilot/range-workspace", {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      workspace?: Partial<StoredRangeDayWorkspace> | null;
    };

    if (!payload.workspace) return null;

    const workspace: StoredRangeDayWorkspace = {
      rangeDays: Array.isArray(payload.workspace.rangeDays)
        ? payload.workspace.rangeDays
        : [],
      drillLibrary: Array.isArray(payload.workspace.drillLibrary)
        ? payload.workspace.drillLibrary
        : [],
      rangeDayDrills: Array.isArray(payload.workspace.rangeDayDrills)
        ? payload.workspace.rangeDayDrills
        : [],
      rangeRoster: Array.isArray(payload.workspace.rangeRoster)
        ? payload.workspace.rangeRoster
        : [],
      results: Array.isArray(payload.workspace.results)
        ? payload.workspace.results
        : [],
      malfunctions: Array.isArray(payload.workspace.malfunctions)
        ? payload.workspace.malfunctions
        : [],
    };

    window.localStorage.setItem(
      RANGE_DAY_WORKSPACE_STORAGE_KEY,
      JSON.stringify(workspace),
    );

    return workspace;
  } catch (error) {
    console.warn("Could not load Supabase qualification workspace.", error);
    return null;
  }
}

function formatDate(date?: string) {
  if (!date) return "No date";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDateValue(date?: string) {
  if (!date) return 0;

  const value = new Date(`${date}T00:00:00`).getTime();

  return Number.isNaN(value) ? 0 : value;
}

function getDaysSince(date?: string) {
  const dateValue = getDateValue(date);

  if (!dateValue) return undefined;

  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();

  return Math.max(
    Math.floor((today - dateValue) / (1000 * 60 * 60 * 24)),
    0,
  );
}

function getUserName(userId?: string) {
  if (!userId) return "Unassigned";

  return (
    activePersonnelDirectory.find((person) => person.id === userId)?.displayName ??
    MOCK_USERS.find((user) => user.id === userId)?.name ??
    "Unknown User"
  );
}

function getFirearmName(firearmId?: string) {
  if (!firearmId) return "No firearm recorded";

  const firearm = MOCK_FIREARMS.find((item) => item.id === firearmId);

  if (!firearm) return "Unknown firearm";

  return `${firearm.make} ${firearm.model} (${firearm.serialNumber})`;
}

function getFirearmShortName(firearmId?: string) {
  if (!firearmId) return "No firearm";

  const firearm = MOCK_FIREARMS.find((item) => item.id === firearmId);

  if (!firearm) return "Unknown firearm";

  return `${firearm.model} · ${firearm.serialNumber}`;
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

function getStatusTone(status: QualificationStatus) {
  if (status === "Current") return "green";
  if (status === "Due Soon") return "amber";
  if (status === "Overdue" || status === "Failed") return "red";
  if (status === "Missing Night") return "blue";

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

function evaluateOfficerStatus(
  lastDayQualification: OfficerQualificationEvent | undefined,
  lastNightQualification: OfficerQualificationEvent | undefined,
  failedQualifications: OfficerQualificationEvent[],
): {
  status: QualificationStatus;
  statusReason: string;
  daysSinceLastQualification?: number;
} {
  const newestFailure = failedQualifications[0];
  const newestPassed = [lastDayQualification, lastNightQualification]
    .filter(Boolean)
    .sort((a, b) => getDateValue(b?.date) - getDateValue(a?.date))[0];

  if (newestFailure && getDateValue(newestFailure.date) >= getDateValue(newestPassed?.date)) {
    return {
      status: "Failed",
      statusReason: `Most recent qualification issue: ${newestFailure.runLabel} on ${formatDate(newestFailure.date)}.`,
      daysSinceLastQualification: getDaysSince(newestFailure.date),
    };
  }

  if (!lastDayQualification && !lastNightQualification) {
    return {
      status: "No Record",
      statusReason: "No recorded qualification result found in saved range days.",
    };
  }

  if (!lastNightQualification) {
    return {
      status: "Missing Night",
      statusReason: "Day qualification exists, but no night qualification is recorded.",
      daysSinceLastQualification: getDaysSince(lastDayQualification?.date),
    };
  }

  if (!lastDayQualification) {
    return {
      status: "Missing Night",
      statusReason: "Night qualification exists, but no day qualification is recorded.",
      daysSinceLastQualification: getDaysSince(lastNightQualification.date),
    };
  }

  const oldestRequiredDate =
    getDateValue(lastDayQualification.date) < getDateValue(lastNightQualification.date)
      ? lastDayQualification.date
      : lastNightQualification.date;

  const daysSinceOldestRequired = getDaysSince(oldestRequiredDate);

  if (daysSinceOldestRequired === undefined) {
    return {
      status: "No Record",
      statusReason: "Qualification dates could not be evaluated.",
    };
  }

  if (daysSinceOldestRequired > QUALIFICATION_VALID_DAYS) {
    return {
      status: "Overdue",
      statusReason: `Oldest required qualification is ${daysSinceOldestRequired} days old.`,
      daysSinceLastQualification: daysSinceOldestRequired,
    };
  }

  if (daysSinceOldestRequired >= DUE_SOON_DAYS) {
    return {
      status: "Due Soon",
      statusReason: `Qualification cycle is approaching ${QUALIFICATION_VALID_DAYS} days.`,
      daysSinceLastQualification: daysSinceOldestRequired,
    };
  }

  return {
    status: "Current",
    statusReason: "Day and night qualification records are present and within the current cycle.",
    daysSinceLastQualification: daysSinceOldestRequired,
  };
}

function buildOfficerHistories(workspace: StoredRangeDayWorkspace, personnel: PilotPersonnel[]) {
  const rangeDayById = new Map(
    workspace.rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]),
  );

  const drillById = new Map(
    workspace.rangeDayDrills.map((drill) => [drill.id, drill]),
  );

  const resultsByOfficerId = new Map<string, DrillRunResult[]>();
  const rosterByOfficerId = new Map<string, RangeRosterEntry[]>();
  const malfunctionsByOfficerId = new Map<string, FirearmMalfunction[]>();

  workspace.results.forEach((result) => {
    const current = resultsByOfficerId.get(result.officerId) ?? [];
    current.push(result);
    resultsByOfficerId.set(result.officerId, current);
  });

  workspace.rangeRoster.forEach((entry) => {
    const current = rosterByOfficerId.get(entry.officerId) ?? [];
    current.push(entry);
    rosterByOfficerId.set(entry.officerId, current);
  });

  workspace.malfunctions.forEach((malfunction) => {
    const officerId = malfunction.officerId;

    if (!officerId) return;

    const current = malfunctionsByOfficerId.get(officerId) ?? [];
    current.push(malfunction);
    malfunctionsByOfficerId.set(officerId, current);
  });

  const personnelById = new Map(personnel.map((officer) => [officer.id, officer]));
  const workspaceOfficerIds = Array.from(
    new Set([
      ...workspace.rangeRoster.map((entry) => entry.officerId),
      ...workspace.results.map((result) => result.officerId),
    ].filter(Boolean)),
  );

  const officers = [
    ...personnel,
    ...workspaceOfficerIds
      .filter((officerId) => !personnelById.has(officerId))
      .map<PilotPersonnel>((officerId) => ({
        id: officerId,
        userId: officerId,
        displayName: getUserName(officerId),
        fullName: getUserName(officerId),
        assignment: "Department Personnel",
        roles: [],
        isActive: true,
      })),
  ];

  return officers.map<OfficerHistory>((officer) => {
    const officerResults = resultsByOfficerId.get(officer.id) ?? [];
    const rosterEntries = rosterByOfficerId.get(officer.id) ?? [];
    const officerMalfunctions = malfunctionsByOfficerId.get(officer.id) ?? [];

    const assignedFirearmIds = Array.from(
      new Set(rosterEntries.flatMap((entry) => entry.assignedFirearmIds ?? [])),
    );

    const missedRangeDays = rosterEntries.filter(
      (entry) => entry.attended === false,
    ).length;

    const qualificationEvents = officerResults
      .map<OfficerQualificationEvent | null>((result) => {
        const drill = drillById.get(result.drillId);

        if (!isQualificationDrill(drill) && !isRifleDrill(drill)) return null;

        const rangeDay = rangeDayById.get(result.rangeDayId);
        const linkedMalfunctionCount = workspace.malfunctions.filter(
          (malfunction) =>
            malfunction.drillRunId === result.id ||
            result.malfunctionIds?.includes(malfunction.id),
        ).length;

        return {
          id: result.id,
          rangeDayId: result.rangeDayId,
          rangeDayTitle: rangeDay?.title ?? "Unknown Range Day",
          rangeDayStatus: rangeDay?.status ?? "Unknown",
          date: rangeDay?.date ?? "",
          location: rangeDay?.location ?? "No location recorded",
          drillName: drill?.name ?? "Unknown Drill",
          drillCategory: drill?.category ?? "Unknown",
          runNumber: result.runNumber,
          runLabel: getRunLabel(drill, result.runNumber),
          firearmId: result.firearmId,
          score: result.score,
          passed: result.passed,
          completed: result.completed,
          instructorId: result.instructorId,
          notes: result.notes,
          deficiencyObserved: result.deficiencyObserved,
          remedialTrainingRecommended: result.remedialTrainingRecommended,
          malfunctionCount: linkedMalfunctionCount,
        };
      })
      .filter((event): event is OfficerQualificationEvent => Boolean(event))
      .sort((a, b) => getDateValue(b.date) - getDateValue(a.date));

    const passedQualificationEvents = qualificationEvents.filter(
      (event) => event.passed === true || event.completed === true,
    );

    const lastDayQualification = passedQualificationEvents.find(
      (event) =>
        event.runNumber === 1 &&
        event.runLabel.toLowerCase().includes("day") &&
        !event.drillName.toLowerCase().includes("rifle"),
    );

    const lastNightQualification = passedQualificationEvents.find(
      (event) =>
        event.runNumber === 2 &&
        event.runLabel.toLowerCase().includes("night") &&
        !event.drillName.toLowerCase().includes("rifle"),
    );

    const lastQualification = passedQualificationEvents.find(
      (event) => !event.drillName.toLowerCase().includes("rifle"),
    );

    const lastRifleQualification = passedQualificationEvents.find((event) =>
      event.drillName.toLowerCase().includes("rifle"),
    );

    const failedQualifications = qualificationEvents.filter(
      (event) => event.passed === false,
    );

    const evaluatedStatus = evaluateOfficerStatus(
      lastDayQualification,
      lastNightQualification,
      failedQualifications,
    );

    return {
      officerId: officer.id,
      officerName: officer.displayName,
      assignedFirearmIds,
      rosterCount: rosterEntries.length,
      missedRangeDays,
      qualificationEvents,
      lastDayQualification,
      lastNightQualification,
      lastQualification,
      lastRifleQualification,
      failedQualifications,
      malfunctionCount: officerMalfunctions.length,
      ...evaluatedStatus,
    };
  }).sort((a, b) => a.officerName.localeCompare(b.officerName));
}

function OfficerSummaryCard({
  history,
  selected,
  onClick,
}: {
  history: OfficerHistory;
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
            {history.malfunctionCount > 0 && (
              <StatusPill label="Malfunction" tone="amber" />
            )}
          </div>

          <h3 className="text-[15px] font-bold text-white">
            {history.officerName}
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            {history.statusReason}
          </p>
        </div>

        <User size={17} className="mt-1 text-slate-600" />
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

      <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-widest text-slate-600">
        <span>{history.qualificationEvents.length} records</span>
        <span>·</span>
        <span>{history.assignedFirearmIds.length} firearm refs</span>
        {history.failedQualifications.length > 0 && (
          <>
            <span>·</span>
            <span className="text-red-300">
              {history.failedQualifications.length} fail
              {history.failedQualifications.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

function QualificationEventRow({ event }: { event: OfficerQualificationEvent }) {
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
          <p>Instructor: {getUserName(event.instructorId)}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
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
            Firearm
          </p>
          <p className="mt-1 font-semibold text-white">
            {getFirearmShortName(event.firearmId)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-slate-600">
            Deficiency
          </p>
          <p className="mt-1 font-semibold text-white">
            {event.deficiencyObserved ? "Yes" : "No"}
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

export default function QualificationsPage() {
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [personnel, setPersonnel] =
    useState<PilotPersonnel[]>(FALLBACK_PERSONNEL);
  const [personnelMessage, setPersonnelMessage] = useState(
    "Using demo personnel until live department personnel is loaded.",
  );
  const [hasStoredWorkspace, setHasStoredWorkspace] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<OfficerStatusFilter>("All");
  const [selectedOfficerId, setSelectedOfficerId] = useState<string>(
    FALLBACK_PERSONNEL[0]?.id ?? "",
  );

  useEffect(() => {
    let isMounted = true;

    async function loadPersonnelDirectory() {
      const payload = await loadPilotPersonnel();

      if (!isMounted) return;

      activePersonnelDirectory = payload.personnel;
      setPersonnel(payload.personnel);
      setPersonnelMessage(
        payload.source === "fallback"
          ? "Using demo personnel."
          : `Using ${payload.personnel.length} live department personnel record${
              payload.personnel.length === 1 ? "" : "s"
            } from Supabase.`,
      );
      setSelectedOfficerId((current) =>
        payload.personnel.some((person) => person.id === current)
          ? current
          : payload.personnel[0]?.id ?? current,
      );
    }

    void loadPersonnelDirectory();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    activePersonnelDirectory = personnel;
  }, [personnel]);

  useEffect(() => {
    let isMounted = true;

    async function loadWorkspace() {
      const remoteWorkspace = await loadRemoteRangeDayWorkspace();
      const storedWorkspace =
        remoteWorkspace ?? loadStoredRangeDayWorkspace();

      if (!isMounted || !storedWorkspace) return;

      setWorkspace(storedWorkspace);
      setHasStoredWorkspace(true);
    }

    void loadWorkspace();

    return () => {
      isMounted = false;
    };
  }, []);

  const officerHistories = useMemo(
    () => buildOfficerHistories(workspace, personnel),
    [personnel, workspace],
  );

  const selectedHistory =
    officerHistories.find((history) => history.officerId === selectedOfficerId) ??
    officerHistories[0];

  const filteredHistories = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return officerHistories.filter((history) => {
      const statusMatches =
        statusFilter === "All" || history.status === statusFilter;

      const searchableText = [
        history.officerName,
        history.status,
        history.statusReason,
        ...history.assignedFirearmIds.map(getFirearmName),
        ...history.qualificationEvents.flatMap((event) => [
          event.rangeDayTitle,
          event.drillName,
          event.runLabel,
          event.location,
          event.notes ?? "",
          getFirearmName(event.firearmId),
        ]),
      ]
        .join(" ")
        .toLowerCase();

      const searchMatches =
        !normalizedSearch || searchableText.includes(normalizedSearch);

      return statusMatches && searchMatches;
    });
  }, [officerHistories, searchText, statusFilter]);

  const currentCount = officerHistories.filter(
    (history) => history.status === "Current",
  ).length;

  const dueSoonCount = officerHistories.filter(
    (history) => history.status === "Due Soon",
  ).length;

  const attentionCount = officerHistories.filter((history) =>
    ["Overdue", "Missing Night", "Failed", "No Record"].includes(
      history.status,
    ),
  ).length;

  const failedCount = officerHistories.filter(
    (history) => history.failedQualifications.length > 0,
  ).length;

  const clearFilters = () => {
    setSearchText("");
    setStatusFilter("All");
  };

  return (
    <TracePointShell activePage="Qualification History">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-white">
                Officer Qualification History
              </h1>
              <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
                Review each officer&apos;s firearms qualification history, day/night
                status, assigned firearms, failures, missed range days, and
                linked malfunction records.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-400">
                <Shield size={14} className="text-blue-400" />
                {DEMO_DEPARTMENT.name}
              </div>

              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-400">
                <History size={14} className="text-blue-400" />
                {hasStoredWorkspace ? "Saved range data loaded" : "No saved range data"}
              </div>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <StatCard
            label="Officers"
            value={officerHistories.length}
            sub="Tracked users"
          />
          <StatCard
            label="Current"
            value={currentCount}
            sub="Day/night complete"
          />
          <StatCard
            label="Due Soon"
            value={dueSoonCount}
            sub="Approaching cycle"
          />
          <StatCard
            label="Needs Review"
            value={attentionCount}
            sub="Missing, overdue, or failed"
          />
          <StatCard
            label="Failures"
            value={failedCount}
            sub="Officers with fail history"
          />
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
              />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search officer, firearm, range day, drill, location, or notes..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-[13px] text-white outline-none focus:border-blue-500"
              />
            </div>

            <div className="relative">
              <Filter
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
              />
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as OfficerStatusFilter)
                }
                className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-[13px] text-white outline-none focus:border-blue-500"
              >
                {STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {status === "All" ? "All Statuses" : status}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
            >
              <X size={14} />
              Clear
            </button>
          </div>
        </section>

        {!hasStoredWorkspace && (
          <section className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.08] p-4 text-[12px] text-amber-200">
            <div className="flex gap-3">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              <p>
                No saved range-day workspace was found in this browser. Create and
                save a range day from the Range &amp; Training page first, then this
                page will populate from that data.
              </p>
            </div>
          </section>
        )}

        <section className="grid gap-5 xl:grid-cols-[420px_1fr]">
          <div className="space-y-3">
            {filteredHistories.map((history) => (
              <OfficerSummaryCard
                key={history.officerId}
                history={history}
                selected={selectedHistory?.officerId === history.officerId}
                onClick={() => setSelectedOfficerId(history.officerId)}
              />
            ))}

            {filteredHistories.length === 0 && (
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-center">
                <p className="text-[14px] font-semibold text-white">
                  No officers match those filters.
                </p>
                <p className="mt-1 text-[12px] text-slate-500">
                  Clear the search or choose a different status.
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
                      {selectedHistory.malfunctionCount > 0 && (
                        <StatusPill
                          label={`${selectedHistory.malfunctionCount} Malfunction${
                            selectedHistory.malfunctionCount !== 1 ? "s" : ""
                          }`}
                          tone="amber"
                        />
                      )}
                    </div>

                    <h2 className="text-[20px] font-bold text-white">
                      {selectedHistory.officerName}
                    </h2>
                    <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
                      {selectedHistory.statusReason}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 sm:min-w-[280px]">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Range Days
                      </p>
                      <p className="mt-1 text-lg font-bold text-white">
                        {selectedHistory.rosterCount}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Missed
                      </p>
                      <p className="mt-1 text-lg font-bold text-white">
                        {selectedHistory.missedRangeDays}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-slate-300">
                    <Sun size={15} className="text-amber-300" />
                    Day Qualification
                  </div>
                  <p className="text-[18px] font-bold text-white">
                    {selectedHistory.lastDayQualification
                      ? formatDate(selectedHistory.lastDayQualification.date)
                      : "Missing"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Score: {selectedHistory.lastDayQualification?.score ?? "—"}
                  </p>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-slate-300">
                    <Moon size={15} className="text-blue-300" />
                    Night Qualification
                  </div>
                  <p className="text-[18px] font-bold text-white">
                    {selectedHistory.lastNightQualification
                      ? formatDate(selectedHistory.lastNightQualification.date)
                      : "Missing"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Score: {selectedHistory.lastNightQualification?.score ?? "—"}
                  </p>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-slate-300">
                    <Crosshair size={15} className="text-emerald-300" />
                    Rifle
                  </div>
                  <p className="text-[18px] font-bold text-white">
                    {selectedHistory.lastRifleQualification
                      ? formatDate(selectedHistory.lastRifleQualification.date)
                      : "No Record"}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Last rifle-related record
                  </p>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-slate-300">
                    <ShieldAlert size={15} className="text-red-300" />
                    Failures
                  </div>
                  <p className="text-[18px] font-bold text-white">
                    {selectedHistory.failedQualifications.length}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Qualification failures recorded
                  </p>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-white">
                  <Target size={15} className="text-blue-400" />
                  Firearms Referenced
                </h3>

                {selectedHistory.assignedFirearmIds.length > 0 ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {selectedHistory.assignedFirearmIds.map((firearmId) => (
                      <div
                        key={firearmId}
                        className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-[12px] text-slate-300"
                      >
                        {getFirearmName(firearmId)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-[12px] text-slate-500">
                    No firearms have been linked to this officer through saved
                    range-day roster entries.
                  </p>
                )}
              </section>

              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="flex items-center gap-2 text-[15px] font-bold text-white">
                      <ClipboardList size={15} className="text-blue-400" />
                      Qualification Timeline
                    </h3>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Results pulled from saved Range &amp; Training entries.
                    </p>
                  </div>

                  <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-400">
                    <CalendarDays size={14} className="text-blue-400" />
                    {selectedHistory.qualificationEvents.length} record
                    {selectedHistory.qualificationEvents.length !== 1 ? "s" : ""}
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedHistory.qualificationEvents.map((event) => (
                    <QualificationEventRow key={event.id} event={event} />
                  ))}

                  {selectedHistory.qualificationEvents.length === 0 && (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-center">
                      <FileText
                        size={20}
                        className="mx-auto mb-2 text-slate-600"
                      />
                      <p className="text-[13px] font-semibold text-white">
                        No qualification records found for this officer.
                      </p>
                      <p className="mt-1 text-[12px] text-slate-500">
                        Enter day/night qualification results from a saved range
                        day to populate this timeline.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    </TracePointShell>
  );
}

