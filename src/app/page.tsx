"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Crosshair,
  FileText,
  Moon,
  Shield,
  ShieldAlert,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  UserCheck,
  Users,
  Wrench,
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

type OfficerReadinessStatus =
  | "Current"
  | "Needs Day"
  | "Needs Night"
  | "Failed"
  | "Overdue"
  | "No Record";

type Priority = "High" | "Medium" | "Low";

type OfficerSummary = {
  officerId: string;
  officerName: string;
  status: OfficerReadinessStatus;
  statusReason: string;
  lastDayQualification?: DrillRunResult;
  lastNightQualification?: DrillRunResult;
  lastQualificationDate?: string;
  failedQualificationCount: number;
  assignedFirearmIds: string[];
  upcomingRangeDays: StoredRangeDay[];
  instructorRangeDays: StoredRangeDay[];
  scoreTrend: "Improving" | "Declining" | "Stable" | "Insufficient Data";
  trendDelta?: number;
};

type InboxItem = {
  id: string;
  title: string;
  detail: string;
  module: "Qualifications" | "Range" | "Firearms" | "Analytics";
  href: string;
  priority: Priority;
  icon: typeof Shield;
  officerId?: string;
};

type DrillAnalyticsSummary = {
  drillId: string;
  drillName: string;
  resultCount: number;
  passRate: number;
  averageScore?: number;
  failedCount: number;
};

const RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1";
const QUALIFICATION_VALID_DAYS = 365;

const EMPTY_WORKSPACE: StoredRangeDayWorkspace = {
  rangeDays: [],
  drillLibrary: [],
  rangeDayDrills: [],
  rangeRoster: [],
  results: [],
  malfunctions: [],
};

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

function getDateValue(date?: string) {
  if (!date) return 0;

  const value = date.includes("T")
    ? new Date(date).getTime()
    : new Date(`${date}T00:00:00`).getTime();

  return Number.isNaN(value) ? 0 : value;
}

function getTodayValue() {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function getDaysSince(date?: string) {
  const value = getDateValue(date);

  if (!value) return undefined;

  return Math.max(
    Math.floor((getTodayValue() - value) / (1000 * 60 * 60 * 24)),
    0,
  );
}

function getUserName(userId?: string) {
  if (!userId) return "Unassigned";

  return MOCK_USERS.find((user) => user.id === userId)?.name ?? "Unknown User";
}

function getFirearmById(firearmId?: string) {
  if (!firearmId) return undefined;

  return MOCK_FIREARMS.find((firearm) => firearm.id === firearmId);
}

function getFirearmName(firearmId?: string) {
  const firearm = getFirearmById(firearmId);

  if (!firearm) return "No firearm recorded";

  return `${firearm.make} ${firearm.model} (${firearm.serialNumber})`;
}

function getFirearmTypeLabel(firearm: (typeof MOCK_FIREARMS)[number]) {
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

function getFirearmStatusLabel(firearm: (typeof MOCK_FIREARMS)[number]) {
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

function isQualificationDrill(drill?: RangeDayDrill | null) {
  if (!drill) return false;

  return (
    drill.category === "Qualification" ||
    drill.name.toLowerCase().includes("qualification")
  );
}

function isPassed(result: DrillRunResult) {
  if (typeof result.passed === "boolean") return result.passed;

  return result.completed;
}

function getResultDate(
  result: DrillRunResult | undefined,
  rangeDaysById: Map<string, StoredRangeDay>,
) {
  if (!result) return undefined;

  return rangeDaysById.get(result.rangeDayId)?.date;
}

function sortResultsNewestFirst(
  results: DrillRunResult[],
  rangeDaysById: Map<string, StoredRangeDay>,
) {
  return [...results].sort(
    (a, b) =>
      getDateValue(getResultDate(b, rangeDaysById)) -
      getDateValue(getResultDate(a, rangeDaysById)),
  );
}

function sortResultsOldestFirst(
  results: DrillRunResult[],
  rangeDaysById: Map<string, StoredRangeDay>,
) {
  return [...results].sort(
    (a, b) =>
      getDateValue(getResultDate(a, rangeDaysById)) -
      getDateValue(getResultDate(b, rangeDaysById)),
  );
}

function getScoreTrend(
  results: DrillRunResult[],
  rangeDaysById: Map<string, StoredRangeDay>,
): OfficerSummary["scoreTrend"] {
  const scoredResults = sortResultsOldestFirst(
    results.filter((result) => typeof result.score === "number"),
    rangeDaysById,
  );

  if (scoredResults.length < 3) return "Insufficient Data";

  const firstScore = scoredResults[0].score ?? 0;
  const lastScore = scoredResults[scoredResults.length - 1].score ?? 0;
  const delta = lastScore - firstScore;

  if (delta <= -5) return "Declining";
  if (delta >= 5) return "Improving";

  return "Stable";
}

function getTrendDelta(
  results: DrillRunResult[],
  rangeDaysById: Map<string, StoredRangeDay>,
) {
  const scoredResults = sortResultsOldestFirst(
    results.filter((result) => typeof result.score === "number"),
    rangeDaysById,
  );

  if (scoredResults.length < 3) return undefined;

  const firstScore = scoredResults[0].score ?? 0;
  const lastScore = scoredResults[scoredResults.length - 1].score ?? 0;

  return lastScore - firstScore;
}

function getPriorityTone(priority: Priority) {
  if (priority === "High") return "red";
  if (priority === "Medium") return "amber";

  return "blue";
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

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: typeof Shield;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const tones = {
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
    green: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    red: "border-red-500/20 bg-red-500/10 text-red-300",
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            {label}
          </p>
          <p className="mt-1 text-3xl font-bold text-white">{value}</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{sub}</p>
        </div>

        <div className={`rounded-2xl border p-2.5 ${tones[tone]}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-center text-[12px] text-slate-500">
      {message}
    </div>
  );
}

function ModuleSnapshotCard({
  title,
  href,
  icon: Icon,
  primary,
  secondary,
  tone = "blue",
}: {
  title: string;
  href: string;
  icon: typeof Shield;
  primary: string;
  secondary: string;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const tones = {
    blue: "text-blue-300 bg-blue-500/10 border-blue-500/20",
    green: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-300 bg-amber-500/10 border-amber-500/20",
    red: "text-red-300 bg-red-500/10 border-red-500/20",
    slate: "text-slate-300 bg-slate-800/60 border-slate-700",
  };

  return (
    <Link
      href={href}
      className="group block rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-blue-500/40 hover:bg-slate-800/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold text-white">{title}</p>
          <p className="mt-1 text-[11px] text-slate-500">{primary}</p>
          <p className="mt-1 text-[11px] text-slate-600">{secondary}</p>
        </div>

        <div className={`rounded-xl border p-2 ${tones[tone]}`}>
          <Icon size={15} />
        </div>
      </div>
    </Link>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const Icon = item.icon;
  const tone = getPriorityTone(item.priority);
  const tones = {
    blue: "border-blue-500/20 bg-blue-500/[0.06] text-blue-300",
    amber: "border-amber-500/20 bg-amber-500/[0.06] text-amber-300",
    red: "border-red-500/20 bg-red-500/[0.06] text-red-300",
  };

  return (
    <Link
      href={item.href}
      className={`group flex items-start justify-between gap-3 rounded-2xl border p-3 transition hover:border-blue-500/40 ${tones[tone]}`}
    >
      <div className="flex min-w-0 gap-3">
        <div className={`rounded-xl border p-2 ${tones[tone]}`}>
          <Icon size={15} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-bold text-white">{item.title}</p>
            <StatusPill label={item.module} tone="slate" />
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">
            {item.detail}
          </p>
        </div>
      </div>

      <ChevronRight
        size={15}
        className="mt-1 shrink-0 text-slate-600 group-hover:text-blue-300"
      />
    </Link>
  );
}

export default function DashboardPage() {
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [selectedOfficerId, setSelectedOfficerId] = useState("all");

  useEffect(() => {
    setWorkspace(loadStoredRangeDayWorkspace() ?? EMPTY_WORKSPACE);
    setWorkspaceLoaded(true);
  }, []);

  const rangeDaysById = useMemo(() => {
    return new Map(workspace.rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]));
  }, [workspace.rangeDays]);

  const drillsById = useMemo(() => {
    return new Map(workspace.rangeDayDrills.map((drill) => [drill.id, drill]));
  }, [workspace.rangeDayDrills]);

  const activeRangeDays = useMemo(
    () => workspace.rangeDays.filter((rangeDay) => rangeDay.status !== "Archived"),
    [workspace.rangeDays],
  );

  const upcomingRangeDays = useMemo(() => {
    return activeRangeDays
      .filter((rangeDay) => getDateValue(rangeDay.date) >= getTodayValue())
      .sort((a, b) => getDateValue(a.date) - getDateValue(b.date))
      .slice(0, 4);
  }, [activeRangeDays]);

  const incompletePackets = useMemo(() => {
    return activeRangeDays.filter(
      (rangeDay) =>
        rangeDay.status !== "Completed" &&
        rangeDay.status !== "Locked" &&
        rangeDay.packetStatus !== "Ready",
    );
  }, [activeRangeDays]);

  const qualificationResults = useMemo(() => {
    return workspace.results.filter((result) =>
      isQualificationDrill(drillsById.get(result.drillId)),
    );
  }, [workspace.results, drillsById]);

  const officerSummaries = useMemo<OfficerSummary[]>(() => {
    return MOCK_USERS.map((user) => {
      const officerResults = sortResultsNewestFirst(
        qualificationResults.filter((result) => result.officerId === user.id),
        rangeDaysById,
      );

      const passedResults = officerResults.filter(isPassed);
      const failedResults = officerResults.filter(
        (result) => result.passed === false,
      );

      const dayResults = passedResults.filter((result) => result.runNumber === 1);
      const nightResults = passedResults.filter((result) => result.runNumber === 2);

      const lastDayQualification = dayResults[0];
      const lastNightQualification = nightResults[0];
      const lastQualification = passedResults[0];
      const lastQualificationDate = getResultDate(lastQualification, rangeDaysById);
      const daysSinceLastQualification = getDaysSince(lastQualificationDate);

      const rosterEntries = workspace.rangeRoster.filter(
        (entry) => entry.officerId === user.id,
      );

      const assignedFirearmIds = Array.from(
        new Set(rosterEntries.flatMap((entry) => entry.assignedFirearmIds ?? [])),
      );

      const upcomingOfficerRangeDays = rosterEntries
        .map((entry) => rangeDaysById.get(entry.rangeDayId))
        .filter(
          (rangeDay): rangeDay is StoredRangeDay =>
            Boolean(rangeDay) &&
            rangeDay.status !== "Archived" &&
            getDateValue(rangeDay.date) >= getTodayValue(),
        )
        .sort((a, b) => getDateValue(a.date) - getDateValue(b.date));

      const instructorRangeDays = activeRangeDays
        .filter(
          (rangeDay) =>
            rangeDay.leadInstructorId === user.id ||
            (rangeDay.instructorIds ?? []).includes(user.id),
        )
        .filter((rangeDay) => getDateValue(rangeDay.date) >= getTodayValue())
        .sort((a, b) => getDateValue(a.date) - getDateValue(b.date));

      let status: OfficerReadinessStatus = "No Record";
      let statusReason = "No qualification record found.";

      const mostRecentResult = officerResults[0];

      if (mostRecentResult?.passed === false) {
        status = "Failed";
        statusReason = "Most recent qualification result is marked failed.";
      } else if (passedResults.length === 0) {
        status = "No Record";
        statusReason = "No passing qualification result is recorded.";
      } else if (!lastDayQualification) {
        status = "Needs Day";
        statusReason = "No passing day qualification is recorded.";
      } else if (!lastNightQualification) {
        status = "Needs Night";
        statusReason = "Passing day qualification exists, but night qualification is missing.";
      } else if (
        typeof daysSinceLastQualification === "number" &&
        daysSinceLastQualification > QUALIFICATION_VALID_DAYS
      ) {
        status = "Overdue";
        statusReason = `${daysSinceLastQualification} days since the last passing qualification.`;
      } else {
        status = "Current";
        statusReason = "Passing day and night qualification records are present.";
      }

      return {
        officerId: user.id,
        officerName: user.name,
        status,
        statusReason,
        lastDayQualification,
        lastNightQualification,
        lastQualificationDate,
        failedQualificationCount: failedResults.length,
        assignedFirearmIds,
        upcomingRangeDays: upcomingOfficerRangeDays,
        instructorRangeDays,
        scoreTrend: getScoreTrend(officerResults, rangeDaysById),
        trendDelta: getTrendDelta(officerResults, rangeDaysById),
      };
    });
  }, [activeRangeDays, qualificationResults, rangeDaysById, workspace.rangeRoster]);

  const firearmAlerts = useMemo(() => {
    return MOCK_FIREARMS.map((firearm) => {
      const statusLabel = getFirearmStatusLabel(firearm);
      const normalizedStatus = statusLabel.toLowerCase();
      const malfunctions = workspace.malfunctions.filter(
        (malfunction) => malfunction.firearmId === firearm.id,
      );
      const unresolvedMalfunctions = malfunctions.filter(
        (malfunction) =>
          malfunction.inspectionRequired ||
          malfunction.removedFromService ||
          malfunction.resolvedOnRange === false,
      );

      const outOfService =
        normalizedStatus.includes("out") ||
        normalizedStatus.includes("maintenance") ||
        unresolvedMalfunctions.some((malfunction) => malfunction.removedFromService);

      return {
        firearmId: firearm.id,
        name: `${firearm.make} ${firearm.model}`,
        serialNumber: firearm.serialNumber,
        typeLabel: getFirearmTypeLabel(firearm),
        statusLabel,
        malfunctionCount: malfunctions.length,
        unresolvedCount: unresolvedMalfunctions.length,
        outOfService,
        requiresAttention: outOfService || unresolvedMalfunctions.length > 0,
      };
    }).filter((firearm) => firearm.requiresAttention);
  }, [workspace.malfunctions]);

  const drillAnalytics = useMemo<DrillAnalyticsSummary[]>(() => {
    const summaries = workspace.rangeDayDrills.map((drill) => {
      const drillResults = workspace.results.filter(
        (result) => result.drillId === drill.id,
      );
      const scoredResults = drillResults.filter(
        (result) => typeof result.score === "number",
      );
      const passableResults = drillResults.filter(
        (result) => typeof result.passed === "boolean",
      );
      const failedCount = passableResults.filter(
        (result) => result.passed === false,
      ).length;
      const passRate = passableResults.length
        ? Math.round(
            ((passableResults.length - failedCount) / passableResults.length) * 100,
          )
        : drillResults.length
          ? 100
          : 0;
      const averageScore = scoredResults.length
        ? Math.round(
            scoredResults.reduce((total, result) => total + (result.score ?? 0), 0) /
              scoredResults.length,
          )
        : undefined;

      return {
        drillId: drill.id,
        drillName: drill.name,
        resultCount: drillResults.length,
        passRate,
        averageScore,
        failedCount,
      };
    });

    return summaries
      .filter((summary) => summary.resultCount > 0)
      .sort((a, b) => a.passRate - b.passRate || b.failedCount - a.failedCount)
      .slice(0, 5);
  }, [workspace.rangeDayDrills, workspace.results]);

  const selectedOfficer = useMemo(() => {
    if (selectedOfficerId === "all") return undefined;

    return officerSummaries.find(
      (officer) => officer.officerId === selectedOfficerId,
    );
  }, [officerSummaries, selectedOfficerId]);

  const officerInboxItems = useMemo<InboxItem[]>(() => {
    const items: InboxItem[] = [];

    for (const officer of officerSummaries) {
      if (officer.status !== "Current") {
        items.push({
          id: `qual-${officer.officerId}`,
          title: `${officer.officerName} · ${officer.status}`,
          detail: officer.statusReason,
          module: "Qualifications",
          href: "/qualifications",
          priority:
            officer.status === "Failed" ||
            officer.status === "Overdue" ||
            officer.status === "No Record"
              ? "High"
              : "Medium",
          icon:
            officer.status === "Needs Night"
              ? Moon
              : officer.status === "Needs Day"
                ? Sun
                : ShieldAlert,
          officerId: officer.officerId,
        });
      }

      for (const rangeDay of officer.upcomingRangeDays.slice(0, 2)) {
        items.push({
          id: `roster-${officer.officerId}-${rangeDay.id}`,
          title: `${officer.officerName} · Upcoming range day`,
          detail: `${rangeDay.title} on ${formatDate(rangeDay.date)} at ${rangeDay.location || "no location entered"}.`,
          module: "Range",
          href: "/range-days",
          priority: "Low",
          icon: CalendarDays,
          officerId: officer.officerId,
        });
      }

      for (const rangeDay of officer.instructorRangeDays.slice(0, 2)) {
        if (rangeDay.packetStatus === "Ready") continue;

        items.push({
          id: `instructor-${officer.officerId}-${rangeDay.id}`,
          title: `${officer.officerName} · Packet needs review`,
          detail: `${rangeDay.title} is assigned to this instructor and packet status is ${rangeDay.packetStatus ?? "Needs Setup"}.`,
          module: "Range",
          href: "/range-days",
          priority: "Medium",
          icon: FileText,
          officerId: officer.officerId,
        });
      }

      if (officer.scoreTrend === "Declining") {
        items.push({
          id: `trend-${officer.officerId}`,
          title: `${officer.officerName} · Declining score trend`,
          detail: `Recorded scores are trending down${typeof officer.trendDelta === "number" ? ` by ${Math.abs(officer.trendDelta)} points` : ""}.`,
          module: "Analytics",
          href: "/analytics",
          priority: "Medium",
          icon: TrendingDown,
          officerId: officer.officerId,
        });
      }
    }

    for (const firearm of firearmAlerts.slice(0, 8)) {
      const assignedRosterEntries = workspace.rangeRoster.filter((entry) =>
        (entry.assignedFirearmIds ?? []).includes(firearm.firearmId),
      );
      const assignedOfficerIds = Array.from(
        new Set(assignedRosterEntries.map((entry) => entry.officerId)),
      );

      for (const officerId of assignedOfficerIds.length ? assignedOfficerIds : [undefined]) {
        items.push({
          id: `firearm-${firearm.firearmId}-${officerId ?? "global"}`,
          title: `${firearm.name} · ${firearm.serialNumber}`,
          detail: firearm.outOfService
            ? "Firearm is marked or inferred as out of service."
            : `${firearm.unresolvedCount} malfunction/inspection item${firearm.unresolvedCount === 1 ? "" : "s"} require review.`,
          module: "Firearms",
          href: "/firearms",
          priority: firearm.outOfService ? "High" : "Medium",
          icon: Wrench,
          officerId,
        });
      }
    }

    for (const rangeDay of incompletePackets.slice(0, 8)) {
      const instructorIds = Array.from(
        new Set([rangeDay.leadInstructorId, ...(rangeDay.instructorIds ?? [])].filter(Boolean)),
      ) as string[];

      for (const instructorId of instructorIds.length ? instructorIds : [undefined]) {
        items.push({
          id: `packet-${rangeDay.id}-${instructorId ?? "global"}`,
          title: `Packet not ready · ${rangeDay.title}`,
          detail: `${formatDate(rangeDay.date)} · Packet status: ${rangeDay.packetStatus ?? "Needs Setup"}.`,
          module: "Range",
          href: "/range-days",
          priority: "Medium",
          icon: ClipboardList,
          officerId: instructorId,
        });
      }
    }

    const priorityOrder: Record<Priority, number> = {
      High: 0,
      Medium: 1,
      Low: 2,
    };

    return items.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );
  }, [firearmAlerts, incompletePackets, officerSummaries, workspace.rangeRoster]);

  const visibleInboxItems = useMemo(() => {
    if (selectedOfficerId === "all") return officerInboxItems.slice(0, 10);

    return officerInboxItems
      .filter((item) => item.officerId === selectedOfficerId)
      .slice(0, 10);
  }, [officerInboxItems, selectedOfficerId]);

  const currentOfficerCount = officerSummaries.filter(
    (officer) => officer.status === "Current",
  ).length;
  const needsDayCount = officerSummaries.filter(
    (officer) => officer.status === "Needs Day" || officer.status === "No Record",
  ).length;
  const needsNightCount = officerSummaries.filter(
    (officer) => officer.status === "Needs Night",
  ).length;
  const failedOrOverdueCount = officerSummaries.filter(
    (officer) => officer.status === "Failed" || officer.status === "Overdue",
  ).length;
  const decliningOfficerCount = officerSummaries.filter(
    (officer) => officer.scoreTrend === "Declining",
  ).length;
  const improvingOfficerCount = officerSummaries.filter(
    (officer) => officer.scoreTrend === "Improving",
  ).length;
  const scoredResults = workspace.results.filter(
    (result) => typeof result.score === "number",
  );
  const averageScore = scoredResults.length
    ? Math.round(
        scoredResults.reduce((total, result) => total + (result.score ?? 0), 0) /
          scoredResults.length,
      )
    : "—";

  return (
    <TracePointShell activePage="Dashboard">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusPill
                  label={workspaceLoaded ? "Live Local Workspace" : "Loading"}
                  tone={workspaceLoaded ? "green" : "slate"}
                />
                <StatusPill label={DEMO_DEPARTMENT.name} tone="slate" />
              </div>

              <h1 className="text-[24px] font-bold text-white">
                TracePoint Command Dashboard
              </h1>
              <p className="mt-1 max-w-4xl text-[12px] leading-5 text-slate-500">
                A cleaner command view: one snapshot, one officer-focused inbox,
                and quick links into the Range, Qualification, Firearm, and Analytics modules.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/range-days"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500"
              >
                <CalendarDays size={14} />
                Plan Range Day
              </Link>

              <Link
                href="/analytics"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                <BarChart3 size={14} />
                View Analytics
              </Link>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            label="Officer Readiness"
            value={`${currentOfficerCount}/${MOCK_USERS.length}`}
            sub="Officers with day and night qualification records."
            icon={UserCheck}
            tone={currentOfficerCount === MOCK_USERS.length ? "green" : "amber"}
          />
          <MetricCard
            label="Qualification Gaps"
            value={needsDayCount + needsNightCount + failedOrOverdueCount}
            sub={`${needsDayCount} need day/no record · ${needsNightCount} need night · ${failedOrOverdueCount} failed/overdue`}
            icon={ShieldAlert}
            tone={needsDayCount + needsNightCount + failedOrOverdueCount > 0 ? "red" : "green"}
          />
          <MetricCard
            label="Range Readiness"
            value={`${upcomingRangeDays.length}`}
            sub={`${incompletePackets.length} active packet${incompletePackets.length === 1 ? "" : "s"} need review.`}
            icon={CalendarDays}
            tone={incompletePackets.length > 0 ? "amber" : "green"}
          />
          <MetricCard
            label="Analytics Signal"
            value={averageScore}
            sub={`${decliningOfficerCount} declining · ${improvingOfficerCount} improving · average score`}
            icon={TrendingUp}
            tone={decliningOfficerCount > 0 ? "amber" : "blue"}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_420px]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-[18px] font-bold text-white">
                  <Bell size={18} className="text-blue-400" />
                  Officer Duty Inbox
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-slate-500">
                  Critical notifications and tasks filtered by officer. Use All Officers for command view.
                </p>
              </div>

              <select
                value={selectedOfficerId}
                onChange={(event) => setSelectedOfficerId(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500 lg:w-[280px]"
              >
                <option value="all">All Officers</option>
                {officerSummaries.map((officer) => (
                  <option key={officer.officerId} value={officer.officerId}>
                    {officer.officerName}
                  </option>
                ))}
              </select>
            </div>

            {selectedOfficer && (
              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Status
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-white">
                    {selectedOfficer.status}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Day Qual
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-white">
                    {formatDate(getResultDate(selectedOfficer.lastDayQualification, rangeDaysById))}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Night Qual
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-white">
                    {formatDate(getResultDate(selectedOfficer.lastNightQualification, rangeDaysById))}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Trend
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-white">
                    {selectedOfficer.scoreTrend}
                  </p>
                </div>
              </div>
            )}

            {visibleInboxItems.length === 0 ? (
              <EmptyPanel
                message={
                  selectedOfficer
                    ? "No active notifications for this officer."
                    : "No active command notifications found in the saved workspace."
                }
              />
            ) : (
              <div className="space-y-3">
                {visibleInboxItems.map((item) => (
                  <InboxRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <h2 className="text-[17px] font-bold text-white">Module Snapshot</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Critical data from each TracePoint area without flooding the dashboard.
              </p>

              <div className="mt-4 space-y-3">
                <ModuleSnapshotCard
                  title="Range & Training"
                  href="/range-days"
                  icon={CalendarDays}
                  primary={`${activeRangeDays.length} active range day${activeRangeDays.length === 1 ? "" : "s"}`}
                  secondary={`${workspace.rangeRoster.length} roster assignments · ${workspace.rangeDayDrills.length} planned drills`}
                  tone={incompletePackets.length > 0 ? "amber" : "green"}
                />
                <ModuleSnapshotCard
                  title="Qualifications"
                  href="/qualifications"
                  icon={Shield}
                  primary={`${currentOfficerCount} current · ${needsDayCount + needsNightCount} incomplete`}
                  secondary={`${workspace.results.length} saved score/result records`}
                  tone={needsDayCount + needsNightCount + failedOrOverdueCount > 0 ? "amber" : "green"}
                />
                <ModuleSnapshotCard
                  title="Firearms"
                  href="/firearms"
                  icon={Crosshair}
                  primary={`${firearmAlerts.length} firearm alert${firearmAlerts.length === 1 ? "" : "s"}`}
                  secondary={`${workspace.malfunctions.length} malfunction records · ${MOCK_FIREARMS.length} firearms loaded`}
                  tone={firearmAlerts.length > 0 ? "amber" : "green"}
                />
                <ModuleSnapshotCard
                  title="Analytics"
                  href="/analytics"
                  icon={BarChart3}
                  primary={`${decliningOfficerCount} declining · ${improvingOfficerCount} improving`}
                  secondary={`${drillAnalytics.length} drill trend signal${drillAnalytics.length === 1 ? "" : "s"} available`}
                  tone={decliningOfficerCount > 0 ? "amber" : "blue"}
                />
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <h2 className="text-[17px] font-bold text-white">Qualification Snapshot</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Day and night records shown together so the status is clear.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                    <CheckCircle2 size={13} /> Current
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">{currentOfficerCount}</p>
                </div>
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-blue-300">
                    <Sun size={13} /> Need Day
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">{needsDayCount}</p>
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                    <Moon size={13} /> Need Night
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">{needsNightCount}</p>
                </div>
                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-red-300">
                    <AlertTriangle size={13} /> Failed/Overdue
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">{failedOrOverdueCount}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold text-white">Upcoming Range Days</h2>
                <p className="mt-1 text-[12px] text-slate-500">
                  Only the next few events, not every saved range-day card.
                </p>
              </div>
              <StatusPill label={`${upcomingRangeDays.length} upcoming`} />
            </div>

            {upcomingRangeDays.length === 0 ? (
              <EmptyPanel message="No upcoming range days are currently saved." />
            ) : (
              <div className="space-y-3">
                {upcomingRangeDays.map((rangeDay) => {
                  const rosterCount = workspace.rangeRoster.filter(
                    (entry) => entry.rangeDayId === rangeDay.id,
                  ).length;
                  const drillCount = workspace.rangeDayDrills.filter(
                    (drill) => drill.rangeDayId === rangeDay.id,
                  ).length;

                  return (
                    <Link
                      key={rangeDay.id}
                      href="/range-days"
                      className="group block rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-blue-500/40 hover:bg-slate-800/70"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-2 flex flex-wrap gap-2">
                            <StatusPill label={rangeDay.status} />
                            <StatusPill
                              label={rangeDay.packetStatus ?? "Needs Setup"}
                              tone={rangeDay.packetStatus === "Ready" ? "green" : "amber"}
                            />
                          </div>
                          <p className="text-[14px] font-bold text-white">{rangeDay.title}</p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {formatDate(rangeDay.date)} · {rangeDay.startTime ?? ""}
                            {rangeDay.endTime ? `-${rangeDay.endTime}` : ""} · {rangeDay.location}
                          </p>
                        </div>
                        <ChevronRight
                          size={16}
                          className="mt-1 text-slate-600 group-hover:text-blue-300"
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-800 pt-3 text-[11px] text-slate-500">
                        <span>{rosterCount} officers</span>
                        <span>·</span>
                        <span>{drillCount} drills</span>
                        <span>·</span>
                        <span>Lead: {getUserName(rangeDay.leadInstructorId)}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold text-white">Analytics Watchlist</h2>
                <p className="mt-1 text-[12px] text-slate-500">
                  Score trends and weaker drill/course areas from saved results.
                </p>
              </div>
              <Link
                href="/analytics"
                className="rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                Open Analytics
              </Link>
            </div>

            {drillAnalytics.length === 0 && decliningOfficerCount === 0 ? (
              <EmptyPanel message="Enter more scored qualifications and drills to generate trend signals." />
            ) : (
              <div className="space-y-3">
                {officerSummaries
                  .filter((officer) => officer.scoreTrend === "Declining")
                  .slice(0, 3)
                  .map((officer) => (
                    <Link
                      key={`decline-${officer.officerId}`}
                      href="/analytics"
                      className="group flex items-start justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 transition hover:border-amber-500/40"
                    >
                      <div className="flex gap-3">
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-300">
                          <TrendingDown size={15} />
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-white">
                            {officer.officerName} · Declining Trend
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            Scores are trending down{typeof officer.trendDelta === "number" ? ` by ${Math.abs(officer.trendDelta)} points` : ""}.
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={15} className="mt-1 text-slate-600 group-hover:text-amber-200" />
                    </Link>
                  ))}

                {drillAnalytics.slice(0, 4).map((drill) => (
                  <Link
                    key={drill.drillId}
                    href="/analytics"
                    className="group flex items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-blue-500/40 hover:bg-slate-800/70"
                  >
                    <div className="flex gap-3">
                      <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-300">
                        <Target size={15} />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-white">{drill.drillName}</p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {drill.resultCount} result{drill.resultCount === 1 ? "" : "s"} · {drill.passRate}% pass rate
                          {typeof drill.averageScore === "number" ? ` · ${drill.averageScore} avg score` : ""}
                        </p>
                      </div>
                    </div>
                    <ChevronRight size={15} className="mt-1 text-slate-600 group-hover:text-blue-300" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}
