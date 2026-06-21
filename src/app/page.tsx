"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  Archive,
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

type OfficerAlertStatus =
  | "Current"
  | "Due Soon"
  | "Overdue"
  | "Missing Night"
  | "Failed"
  | "No Record";

type FirearmAlertStatus =
  | "Clear"
  | "Attention"
  | "Out of Service"
  | "No Qual"
  | "Missing Night";

type OfficerQualificationSummary = {
  officerId: string;
  officerName: string;
  status: OfficerAlertStatus;
  statusReason: string;
  lastDayQualification?: DrillRunResult;
  lastNightQualification?: DrillRunResult;
  lastQualificationDate?: string;
  failedQualificationCount: number;
  missedRangeDayCount: number;
  assignedFirearmIds: string[];
};

type FirearmSummary = {
  firearmId: string;
  name: string;
  serialNumber: string;
  typeLabel: string;
  statusLabel: string;
  assignedOfficerIds: string[];
  qualificationCount: number;
  lastDayQualification?: DrillRunResult;
  lastNightQualification?: DrillRunResult;
  malfunctionCount: number;
  unresolvedMalfunctionCount: number;
  inspectionRequiredCount: number;
  status: FirearmAlertStatus;
  statusReason: string;
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

function isRifleDrill(drill?: RangeDayDrill | null) {
  if (!drill) return false;

  return (
    drill.category === "Rifle" ||
    drill.name.toLowerCase().includes("rifle") ||
    drill.firearmType === "Rifle"
  );
}

function isPassed(result: DrillRunResult) {
  if (typeof result.passed === "boolean") return result.passed;

  return result.completed;
}

function getResultDate(
  result: DrillRunResult,
  rangeDaysById: Map<string, StoredRangeDay>,
) {
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

function getRunLabel(runNumber: number) {
  if (runNumber === 1) return "Day";
  if (runNumber === 2) return "Night";

  return `Run ${runNumber}`;
}

function getStatusTone(
  status:
    | OfficerAlertStatus
    | FirearmAlertStatus
    | "Ready"
    | "In Progress"
    | "Needs Setup"
    | "Planned"
    | "Completed"
    | "Locked"
    | "Archived",
): "blue" | "green" | "amber" | "red" | "slate" {
  if (status === "Current" || status === "Clear" || status === "Ready") {
    return "green";
  }

  if (
    status === "Due Soon" ||
    status === "Missing Night" ||
    status === "Attention" ||
    status === "In Progress" ||
    status === "Planned"
  ) {
    return "amber";
  }

  if (
    status === "Overdue" ||
    status === "Failed" ||
    status === "No Record" ||
    status === "No Qual" ||
    status === "Out of Service" ||
    status === "Needs Setup"
  ) {
    return "red";
  }

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
          <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
        </div>

        <div className={`rounded-2xl border p-2.5 ${tones[tone]}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  title,
  value,
  description,
  href,
  icon: Icon,
  tone = "amber",
}: {
  title: string;
  value: string | number;
  description: string;
  href: string;
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
    <Link
      href={href}
      className="group rounded-3xl border border-slate-800 bg-slate-900 p-4 transition hover:-translate-y-[1px] hover:border-blue-500/40 hover:bg-slate-800/70"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-600">
            {title}
          </p>
          <p className="mt-1 text-3xl font-bold text-white">{value}</p>
        </div>

        <div className={`rounded-2xl border p-2.5 ${tones[tone]}`}>
          <Icon size={18} />
        </div>
      </div>

      <p className="mt-3 text-[12px] text-slate-500">{description}</p>

      <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-[11px] font-semibold text-slate-500 group-hover:text-blue-300">
        Review records
        <ChevronRight size={14} />
      </div>
    </Link>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5 text-center text-[12px] text-slate-500">
      {message}
    </div>
  );
}

export default function DashboardPage() {
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

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
      .slice(0, 5);
  }, [activeRangeDays]);

  const incompletePackets = useMemo(() => {
    return activeRangeDays.filter(
      (rangeDay) =>
        rangeDay.status !== "Completed" &&
        rangeDay.status !== "Locked" &&
        rangeDay.packetStatus !== "Ready",
    );
  }, [activeRangeDays]);

  const completedRangeDays = useMemo(
    () => workspace.rangeDays.filter((rangeDay) => rangeDay.status === "Completed"),
    [workspace.rangeDays],
  );

  const archivedRangeDays = useMemo(
    () => workspace.rangeDays.filter((rangeDay) => rangeDay.status === "Archived"),
    [workspace.rangeDays],
  );

  const qualificationResults = useMemo(() => {
    return workspace.results.filter((result) =>
      isQualificationDrill(drillsById.get(result.drillId)),
    );
  }, [workspace.results, drillsById]);

  const officerSummaries = useMemo<OfficerQualificationSummary[]>(() => {
    return MOCK_USERS.map((user) => {
      const officerResults = sortResultsNewestFirst(
        qualificationResults.filter((result) => result.officerId === user.id),
        rangeDaysById,
      );

      const passedResults = officerResults.filter(isPassed);
      const failedResults = officerResults.filter((result) => result.passed === false);

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

      const missedRangeDayCount = rosterEntries.filter(
        (entry) => entry.attended === false,
      ).length;

      const assignedFirearmIds = Array.from(
        new Set(rosterEntries.flatMap((entry) => entry.assignedFirearmIds ?? [])),
      );

      let status: OfficerAlertStatus = "No Record";
      let statusReason = "No qualification record found.";

      if (failedResults.length > 0 && !lastQualification) {
        status = "Failed";
        statusReason = "Failed qualification with no later passing record.";
      } else if (!lastQualification) {
        status = "No Record";
        statusReason = "No passing qualification record found.";
      } else if (!lastNightQualification) {
        status = "Missing Night";
        statusReason = "Day qualification exists, but no night qualification is recorded.";
      } else if (
        typeof daysSinceLastQualification === "number" &&
        daysSinceLastQualification > QUALIFICATION_VALID_DAYS
      ) {
        status = "Overdue";
        statusReason = `${daysSinceLastQualification} days since last passing qualification.`;
      } else if (
        typeof daysSinceLastQualification === "number" &&
        daysSinceLastQualification >= DUE_SOON_DAYS
      ) {
        status = "Due Soon";
        statusReason = `${daysSinceLastQualification} days since last passing qualification.`;
      } else if (failedResults.length > 0) {
        status = "Failed";
        statusReason = `${failedResults.length} failed qualification record${
          failedResults.length === 1 ? "" : "s"
        } requires review.`;
      } else {
        status = "Current";
        statusReason = "Day and night qualification records are present.";
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
        missedRangeDayCount,
        assignedFirearmIds,
      };
    });
  }, [qualificationResults, rangeDaysById, workspace.rangeRoster]);

  const firearmSummaries = useMemo<FirearmSummary[]>(() => {
    return MOCK_FIREARMS.map((firearm) => {
      const firearmResults = sortResultsNewestFirst(
        qualificationResults.filter((result) => result.firearmId === firearm.id),
        rangeDaysById,
      );

      const passedResults = firearmResults.filter(isPassed);
      const lastDayQualification = passedResults.find(
        (result) => result.runNumber === 1,
      );
      const lastNightQualification = passedResults.find(
        (result) => result.runNumber === 2,
      );

      const malfunctions = workspace.malfunctions.filter(
        (malfunction) => malfunction.firearmId === firearm.id,
      );

      const unresolvedMalfunctions = malfunctions.filter(
        (malfunction) =>
          malfunction.inspectionRequired ||
          malfunction.removedFromService ||
          malfunction.resolvedOnRange === false,
      );

      const inspectionRequiredCount = malfunctions.filter(
        (malfunction) => malfunction.inspectionRequired,
      ).length;

      const statusLabel = getFirearmStatusLabel(firearm);
      const normalizedStatus = statusLabel.toLowerCase();

      const rosterEntries = workspace.rangeRoster.filter((entry) =>
        (entry.assignedFirearmIds ?? []).includes(firearm.id),
      );

      const assignedOfficerIds = Array.from(
        new Set(rosterEntries.map((entry) => entry.officerId)),
      );

      let status: FirearmAlertStatus = "Clear";
      let statusReason = "No firearm concerns identified from saved range data.";

      if (
        normalizedStatus.includes("out") ||
        normalizedStatus.includes("maintenance") ||
        unresolvedMalfunctions.some((malfunction) => malfunction.removedFromService)
      ) {
        status = "Out of Service";
        statusReason = "Firearm status or malfunction record indicates out-of-service review.";
      } else if (unresolvedMalfunctions.length > 0 || inspectionRequiredCount > 0) {
        status = "Attention";
        statusReason = `${unresolvedMalfunctions.length || inspectionRequiredCount} malfunction/inspection item${
          (unresolvedMalfunctions.length || inspectionRequiredCount) === 1 ? "" : "s"
        } require review.`;
      } else if (passedResults.length === 0) {
        status = "No Qual";
        statusReason = "No qualification result is linked to this firearm.";
      } else if (!lastNightQualification && getFirearmTypeLabel(firearm) !== "Rifle") {
        status = "Missing Night";
        statusReason = "Day qualification exists, but no night qualification is linked to this firearm.";
      }

      return {
        firearmId: firearm.id,
        name: `${firearm.make} ${firearm.model}`,
        serialNumber: firearm.serialNumber,
        typeLabel: getFirearmTypeLabel(firearm),
        statusLabel,
        assignedOfficerIds,
        qualificationCount: firearmResults.length,
        lastDayQualification,
        lastNightQualification,
        malfunctionCount: malfunctions.length,
        unresolvedMalfunctionCount: unresolvedMalfunctions.length,
        inspectionRequiredCount,
        status,
        statusReason,
      };
    });
  }, [qualificationResults, rangeDaysById, workspace.malfunctions, workspace.rangeRoster]);

  const officerAlertCount = useMemo(
    () =>
      officerSummaries.filter((officer) => officer.status !== "Current").length,
    [officerSummaries],
  );

  const missingNightOfficers = useMemo(
    () => officerSummaries.filter((officer) => officer.status === "Missing Night"),
    [officerSummaries],
  );

  const failedQualificationOfficers = useMemo(
    () => officerSummaries.filter((officer) => officer.failedQualificationCount > 0),
    [officerSummaries],
  );

  const noRecordOrOverdueOfficers = useMemo(
    () =>
      officerSummaries.filter(
        (officer) => officer.status === "No Record" || officer.status === "Overdue",
      ),
    [officerSummaries],
  );

  const firearmAlertCount = useMemo(
    () => firearmSummaries.filter((firearm) => firearm.status !== "Clear").length,
    [firearmSummaries],
  );

  const malfunctionFirearms = useMemo(
    () =>
      firearmSummaries.filter(
        (firearm) =>
          firearm.unresolvedMalfunctionCount > 0 || firearm.inspectionRequiredCount > 0,
      ),
    [firearmSummaries],
  );

  const outOfServiceFirearms = useMemo(
    () => firearmSummaries.filter((firearm) => firearm.status === "Out of Service"),
    [firearmSummaries],
  );

  const criticalAlertCount =
    noRecordOrOverdueOfficers.length +
    failedQualificationOfficers.length +
    malfunctionFirearms.length +
    outOfServiceFirearms.length +
    incompletePackets.length;

  const totalRosterSlots = workspace.rangeRoster.length;
  const totalScores = workspace.results.length;
  const totalMalfunctions = workspace.malfunctions.length;
  const readyPackets = workspace.rangeDays.filter(
    (rangeDay) => rangeDay.packetStatus === "Ready",
  ).length;

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
              <p className="mt-1 max-w-4xl text-[12px] text-slate-500">
                Monitor qualification exposure, firearm reliability, range-day
                readiness, packet status, and compliance records from the saved
                Range &amp; Training workspace.
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
                href="/qualifications"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                <Shield size={14} />
                Review Quals
              </Link>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard
            label="Action Items"
            value={criticalAlertCount}
            sub="Records requiring review"
            icon={AlertTriangle}
            tone={criticalAlertCount > 0 ? "red" : "green"}
          />
          <StatCard
            label="Range Days"
            value={workspace.rangeDays.length}
            sub={`${activeRangeDays.length} active · ${archivedRangeDays.length} archived`}
            icon={CalendarDays}
            tone="blue"
          />
          <StatCard
            label="Qualification Records"
            value={totalScores}
            sub={`${totalRosterSlots} roster assignments saved`}
            icon={ClipboardList}
            tone="green"
          />
          <StatCard
            label="Firearm Alerts"
            value={firearmAlertCount}
            sub={`${totalMalfunctions} malfunction record${totalMalfunctions === 1 ? "" : "s"}`}
            icon={Crosshair}
            tone={firearmAlertCount > 0 ? "amber" : "green"}
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ActionCard
            title="Missing Night Qual"
            value={missingNightOfficers.length}
            description="Officers with day qualification data but no night qualification record."
            href="/qualifications"
            icon={Moon}
            tone={missingNightOfficers.length > 0 ? "amber" : "green"}
          />
          <ActionCard
            title="Failed Quals"
            value={failedQualificationOfficers.length}
            description="Officers with failed qualification events that should be reviewed."
            href="/qualifications"
            icon={ShieldAlert}
            tone={failedQualificationOfficers.length > 0 ? "red" : "green"}
          />
          <ActionCard
            title="Firearm Malfunctions"
            value={malfunctionFirearms.length}
            description="Firearms with malfunction or inspection-required records."
            href="/firearms"
            icon={Wrench}
            tone={malfunctionFirearms.length > 0 ? "red" : "green"}
          />
          <ActionCard
            title="Incomplete Packets"
            value={incompletePackets.length}
            description="Active range days that are not marked ready, completed, or locked."
            href="/range-days"
            icon={FileText}
            tone={incompletePackets.length > 0 ? "amber" : "green"}
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Command Attention Queue
                  </h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    The highest-liability items surfaced from qualification,
                    firearm, and range-day records.
                  </p>
                </div>

                <StatusPill
                  label={`${criticalAlertCount} item${criticalAlertCount === 1 ? "" : "s"}`}
                  tone={criticalAlertCount > 0 ? "red" : "green"}
                />
              </div>

              {criticalAlertCount === 0 ? (
                <EmptyPanel message="No command-level alerts found in the saved workspace." />
              ) : (
                <div className="space-y-3">
                  {noRecordOrOverdueOfficers.slice(0, 6).map((officer) => (
                    <Link
                      key={`officer-${officer.officerId}`}
                      href="/qualifications"
                      className="group flex items-start justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-3 transition hover:border-red-500/40"
                    >
                      <div className="flex gap-3">
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-300">
                          <ShieldAlert size={15} />
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-white">
                            {officer.officerName}
                          </p>
                          <p className="mt-1 text-[11px] text-red-200/80">
                            {officer.status}: {officer.statusReason}
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        size={15}
                        className="mt-1 text-red-300/50 group-hover:text-red-200"
                      />
                    </Link>
                  ))}

                  {failedQualificationOfficers.slice(0, 4).map((officer) => (
                    <Link
                      key={`failed-${officer.officerId}`}
                      href="/qualifications"
                      className="group flex items-start justify-between gap-3 rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-3 transition hover:border-red-500/40"
                    >
                      <div className="flex gap-3">
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-2 text-red-300">
                          <AlertTriangle size={15} />
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-white">
                            Failed Qualification · {officer.officerName}
                          </p>
                          <p className="mt-1 text-[11px] text-red-200/80">
                            {officer.failedQualificationCount} failed event
                            {officer.failedQualificationCount === 1 ? "" : "s"} found.
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        size={15}
                        className="mt-1 text-red-300/50 group-hover:text-red-200"
                      />
                    </Link>
                  ))}

                  {malfunctionFirearms.slice(0, 5).map((firearm) => (
                    <Link
                      key={`firearm-${firearm.firearmId}`}
                      href="/firearms"
                      className="group flex items-start justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 transition hover:border-amber-500/40"
                    >
                      <div className="flex gap-3">
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2 text-amber-300">
                          <Wrench size={15} />
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-white">
                            {firearm.name} · {firearm.serialNumber}
                          </p>
                          <p className="mt-1 text-[11px] text-amber-200/80">
                            {firearm.statusReason}
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        size={15}
                        className="mt-1 text-amber-300/50 group-hover:text-amber-200"
                      />
                    </Link>
                  ))}

                  {incompletePackets.slice(0, 5).map((rangeDay) => (
                    <Link
                      key={`packet-${rangeDay.id}`}
                      href="/range-days"
                      className="group flex items-start justify-between gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-3 transition hover:border-blue-500/40"
                    >
                      <div className="flex gap-3">
                        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-300">
                          <FileText size={15} />
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-white">
                            Packet Not Ready · {rangeDay.title}
                          </p>
                          <p className="mt-1 text-[11px] text-blue-200/80">
                            {formatDate(rangeDay.date)} · Packet status: {rangeDay.packetStatus ?? "Needs Setup"}
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        size={15}
                        className="mt-1 text-blue-300/50 group-hover:text-blue-200"
                      />
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Upcoming Range Days
                  </h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Active range days scheduled today or later.
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
                                tone={getStatusTone(
                                  (rangeDay.packetStatus ?? "Needs Setup") as
                                    | "Ready"
                                    | "In Progress"
                                    | "Needs Setup",
                                )}
                              />
                            </div>

                            <p className="text-[14px] font-bold text-white">
                              {rangeDay.title}
                            </p>
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

                        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-3 text-[11px]">
                          <div>
                            <p className="uppercase tracking-widest text-slate-600">
                              Roster
                            </p>
                            <p className="mt-1 font-bold text-white">{rosterCount}</p>
                          </div>
                          <div>
                            <p className="uppercase tracking-widest text-slate-600">
                              Drills
                            </p>
                            <p className="mt-1 font-bold text-white">{drillCount}</p>
                          </div>
                          <div>
                            <p className="uppercase tracking-widest text-slate-600">
                              Lead
                            </p>
                            <p className="mt-1 truncate font-bold text-white">
                              {getUserName(rangeDay.leadInstructorId)}
                            </p>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Qualification Snapshot
                  </h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Officer readiness based on saved qualification results.
                  </p>
                </div>

                <Users size={18} className="text-blue-400" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300/80">
                    Current
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {officerSummaries.filter((item) => item.status === "Current").length}
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-300/80">
                    Missing Night
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {missingNightOfficers.length}
                  </p>
                </div>

                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-red-300/80">
                    Failed
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {failedQualificationOfficers.length}
                  </p>
                </div>

                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-red-300/80">
                    No/Overdue
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {noRecordOrOverdueOfficers.length}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {officerSummaries
                  .filter((officer) => officer.status !== "Current")
                  .slice(0, 6)
                  .map((officer) => (
                    <div
                      key={officer.officerId}
                      className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[13px] font-semibold text-white">
                            {officer.officerName}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {officer.statusReason}
                          </p>
                        </div>
                        <StatusPill
                          label={officer.status}
                          tone={getStatusTone(officer.status)}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Firearm Reliability Snapshot
                  </h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Weapon-side concerns surfaced from qualification and
                    malfunction records.
                  </p>
                </div>

                <Crosshair size={18} className="text-blue-400" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-300/80">
                    Clear
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {firearmSummaries.filter((item) => item.status === "Clear").length}
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-300/80">
                    Attention
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {firearmSummaries.filter((item) => item.status === "Attention").length}
                  </p>
                </div>

                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-red-300/80">
                    Out of Service
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {outOfServiceFirearms.length}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Total Firearms
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {MOCK_FIREARMS.length}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {firearmSummaries
                  .filter((firearm) => firearm.status !== "Clear")
                  .slice(0, 6)
                  .map((firearm) => (
                    <div
                      key={firearm.firearmId}
                      className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[13px] font-semibold text-white">
                            {firearm.name}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            SN {firearm.serialNumber} · {firearm.statusReason}
                          </p>
                        </div>
                        <StatusPill
                          label={firearm.status}
                          tone={getStatusTone(firearm.status)}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Record Health
                  </h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Saved local workspace summary.
                  </p>
                </div>

                <TrendingUp size={18} className="text-blue-400" />
              </div>

              <div className="space-y-3 text-[12px] text-slate-400">
                <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    Ready packets
                  </span>
                  <span className="font-bold text-white">{readyPackets}</span>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Archive size={14} className="text-slate-500" />
                    Archived records
                  </span>
                  <span className="font-bold text-white">{archivedRangeDays.length}</span>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Sun size={14} className="text-amber-300" />
                    Completed range days
                  </span>
                  <span className="font-bold text-white">{completedRangeDays.length}</span>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <Target size={14} className="text-blue-400" />
                    Planned drills
                  </span>
                  <span className="font-bold text-white">
                    {workspace.rangeDayDrills.length}
                  </span>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <span className="flex items-center gap-2">
                    <UserCheck size={14} className="text-blue-400" />
                    Roster assignments
                  </span>
                  <span className="font-bold text-white">{totalRosterSlots}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}
