"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Crosshair,
  FileText,
  Moon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sun,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";
import type { FirearmMalfunction } from "@/app/lib/tracepoint/types";
import {
  evaluateQualificationReadiness,
  type QualificationReadinessStatus,
} from "@/lib/tracepoint/qualification-readiness";
import type {
  DrillRunResult,
  DrillTemplate,
  RangeDay,
  RangeDayDrill,
  RangeRosterEntry,
} from "@/app/lib/tracepoint/range-day-types";

type PilotPersonnel = {
  id: string;
  displayName: string;
  fullName: string;
  rankTitle?: string | null;
  badgeNumber?: string | null;
  isActive?: boolean;
};

type LiveFirearm = {
  id: string;
  make: string;
  model: string;
  serial_number: string;
  firearm_type?: string | null;
  condition_status?: string | null;
  is_active?: boolean;
};

type StoredRangeDay = RangeDay & {
  rangeType?: string;
  startTime?: string;
  endTime?: string;
  packetStatus?: string;
};

type StoredRangeDayWorkspace = {
  rangeDays: StoredRangeDay[];
  drillLibrary: DrillTemplate[];
  rangeDayDrills: RangeDayDrill[];
  rangeRoster: RangeRosterEntry[];
  results: DrillRunResult[];
  malfunctions: FirearmMalfunction[];
};

type ReadinessStatus = QualificationReadinessStatus;

type Tone = "blue" | "green" | "amber" | "red" | "slate";

type OfficerSummary = {
  officerId: string;
  officerName: string;
  status: ReadinessStatus;
  statusReason: string;
  scoreTrend: "Improving" | "Declining" | "Stable" | "Insufficient Data";
  trendDelta?: number;
};

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: Tone;
  icon: typeof Shield;
};
type CertificationReadinessSummary = {
  totalRequiredChecks: number;
  current: number;
  dueSoon: number;
  expired: number;
  missing: number;
  ready: number;
  notReady: number;
  readinessPercent: number;
};

type CertificationReadinessRow = {
  userId: string;
  officerName: string;
  badgeNumber?: string | null;
  rankTitle?: string | null;
  certificationTypeId: string;
  certificationName: string;
  certificationCategory: string;
  status: "current" | "due_soon" | "expired" | "missing";
  credentialId: string | null;
  expirationDate: string | null;
  daysRemaining: number | null;
  statusReason: string;
};

type CertificationReadinessPayload = {
  summary: CertificationReadinessSummary;
  rows: CertificationReadinessRow[];
};
type EquipmentReadinessSummary = {
  totalRequiredChecks: number;
  current: number;
  dueSoon: number;
  expired: number;
  inspectionDueSoon: number;
  inspectionOverdue: number;
  missing: number;
  outOfService: number;
  ready: number;
  notReady: number;
  readinessPercent: number;
};

type EquipmentReadinessRow = {
  userId: string;
  officerName: string;
  badgeNumber?: string | null;
  rankTitle?: string | null;
  equipmentTypeId: string;
  equipmentName: string;
  equipmentCategory: string;
  requiredQuantity: number;
  assignedQuantity: number;
  readyQuantity: number;
  status:
    | "current"
    | "due_soon"
    | "expired"
    | "inspection_due_soon"
    | "inspection_overdue"
    | "missing"
    | "out_of_service";
  statusReason: string;
};

type EquipmentReadinessPayload = {
  scope: "department" | "self";
  summary: EquipmentReadinessSummary;
  rows: EquipmentReadinessRow[];
};

const DEFAULT_QUALIFICATION_VALID_DAYS = 365;

const EMPTY_WORKSPACE: StoredRangeDayWorkspace = {
  rangeDays: [],
  drillLibrary: [],
  rangeDayDrills: [],
  rangeRoster: [],
  results: [],
  malfunctions: [],
};

function normalizeWorkspace(
  workspace?: Partial<StoredRangeDayWorkspace> | null,
): StoredRangeDayWorkspace {
  return {
    rangeDays: Array.isArray(workspace?.rangeDays) ? workspace.rangeDays : [],
    drillLibrary: Array.isArray(workspace?.drillLibrary)
      ? workspace.drillLibrary
      : [],
    rangeDayDrills: Array.isArray(workspace?.rangeDayDrills)
      ? workspace.rangeDayDrills
      : [],
    rangeRoster: Array.isArray(workspace?.rangeRoster)
      ? workspace.rangeRoster
      : [],
    results: Array.isArray(workspace?.results) ? workspace.results : [],
    malfunctions: Array.isArray(workspace?.malfunctions)
      ? workspace.malfunctions
      : [],
  };
}

async function loadDashboardData() {
  const [
    personnelResponse,
    firearmsResponse,
    workspaceResponse,
    rulesResponse,
    certificationReadinessResponse,
    equipmentReadinessResponse,
  ] = await Promise.all([
    fetch("/api/pilot/personnel", { cache: "no-store" }),
    fetch("/api/armory/firearms", { cache: "no-store" }),
    fetch("/api/pilot/range-workspace", { cache: "no-store" }),
    fetch("/api/settings/current-rules", { cache: "no-store" }),
    fetch("/api/readiness/certifications", { cache: "no-store" }),
    fetch("/api/readiness/equipment", { cache: "no-store" }),
  ]);

  const personnelPayload = personnelResponse.ok
    ? ((await personnelResponse.json()) as { personnel?: PilotPersonnel[] })
    : {};

  const firearmsPayload = firearmsResponse.ok
    ? ((await firearmsResponse.json()) as { firearms?: LiveFirearm[] })
    : {};

  const workspacePayload = workspaceResponse.ok
    ? ((await workspaceResponse.json()) as {
        workspace?: Partial<StoredRangeDayWorkspace> | null;
      })
    : {};

  const rulesPayload = rulesResponse.ok
    ? ((await rulesResponse.json()) as {
        rules?: {
          qualification_valid_days?: number;
          qualification_due_soon_days?: number;
        };
      })
    : {};
  const certificationReadinessPayload =
    certificationReadinessResponse.ok
      ? ((await certificationReadinessResponse.json()) as CertificationReadinessPayload)
      : {
          summary: {
            totalRequiredChecks: 0,
            current: 0,
            dueSoon: 0,
            expired: 0,
            missing: 0,
            ready: 0,
            notReady: 0,
            readinessPercent: 100,
          },
          rows: [],
        };


  const equipmentReadinessPayload =
    equipmentReadinessResponse.ok
      ? ((await equipmentReadinessResponse.json()) as EquipmentReadinessPayload)
      : {
          scope: "department" as const,
          summary: {
            totalRequiredChecks: 0,
            current: 0,
            dueSoon: 0,
            expired: 0,
            inspectionDueSoon: 0,
            inspectionOverdue: 0,
            missing: 0,
            outOfService: 0,
            ready: 0,
            notReady: 0,
            readinessPercent: 100,
          },
          rows: [],
        };
  return {
    personnel: Array.isArray(personnelPayload.personnel)
      ? personnelPayload.personnel
      : [],
    firearms: Array.isArray(firearmsPayload.firearms)
      ? firearmsPayload.firearms
      : [],
    workspace: workspacePayload.workspace
      ? normalizeWorkspace(workspacePayload.workspace)
      : EMPTY_WORKSPACE,
    qualificationValidDays:
      Number(rulesPayload.rules?.qualification_valid_days) ||
      DEFAULT_QUALIFICATION_VALID_DAYS,
    qualificationDueSoonDays:
      Number(rulesPayload.rules?.qualification_due_soon_days) || 30,
    certificationReadiness: certificationReadinessPayload,
    equipmentReadiness: equipmentReadinessPayload,
  };
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

function formatDate(date?: string) {
  if (!date) return "No date";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isQualificationDrill(drill?: RangeDayDrill | null) {
  if (!drill) return false;

  const name = drill.name.toLowerCase();

  if (name.includes("rifle")) return false;

  return (
    drill.category === "Qualification" ||
    name.includes("qualification")
  );
}

function isPassed(result: DrillRunResult) {
  return typeof result.passed === "boolean" ? result.passed : result.completed;
}

function toneClasses(tone: Tone) {
  return {
    blue: "border-blue-500/25 bg-blue-500/[0.08] text-blue-300",
    green: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300",
    amber: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300",
    red: "border-red-500/25 bg-red-500/[0.08] text-red-300",
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
  }[tone];
}

function StatusPill({ label, tone = "blue" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${toneClasses(
        tone,
      )}`}
    >
      {label}
    </span>
  );
}

function PulseCard({
  title,
  value,
  label,
  detail,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  label: string;
  detail: string;
  icon: typeof Shield;
  tone: Tone;
}) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            {title}
          </p>
          <p className="mt-1 text-3xl font-bold text-white">{value}</p>
          <p className="mt-1 text-[12px] font-semibold text-slate-300">
            {label}
          </p>
        </div>

        <div className={`rounded-2xl border p-2.5 ${toneClasses(tone)}`}>
          <Icon size={18} />
        </div>
      </div>

      <p className="mt-3 border-t border-slate-800 pt-3 text-[11px] leading-5 text-slate-500">
        {detail}
      </p>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 text-center text-[12px] text-slate-500">
      {message}
    </div>
  );
}

export default function DashboardPage() {
  const { enabledFeatures } = useTracePointAccess();
  const featureSet = useMemo(
    () => new Set(enabledFeatures),
    [enabledFeatures],
  );

  const hasQualifications = featureSet.has("qualifications");
  const hasCertifications = featureSet.has("certifications");
  const hasEquipment = featureSet.has("equipment_readiness");
  const hasRangeTraining = featureSet.has("range_training");
  const hasFirearms = featureSet.has("firearms");
  const hasAnalytics = featureSet.has("analytics");

  const [personnel, setPersonnel] = useState<PilotPersonnel[]>([]);
  const [firearms, setFirearms] = useState<LiveFirearm[]>([]);
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [qualificationValidDays, setQualificationValidDays] = useState(
    DEFAULT_QUALIFICATION_VALID_DAYS,
  );
  const [qualificationDueSoonDays, setQualificationDueSoonDays] = useState(30);
    const [certificationReadiness, setCertificationReadiness] =
    useState<CertificationReadinessPayload>({
      summary: {
        totalRequiredChecks: 0,
        current: 0,
        dueSoon: 0,
        expired: 0,
        missing: 0,
        ready: 0,
        notReady: 0,
        readinessPercent: 100,
      },
      rows: [],
    });
  const [equipmentReadiness, setEquipmentReadiness] =
    useState<EquipmentReadinessPayload>({
      scope: "department",
      summary: {
        totalRequiredChecks: 0,
        current: 0,
        dueSoon: 0,
        expired: 0,
        inspectionDueSoon: 0,
        inspectionOverdue: 0,
        missing: 0,
        outOfService: 0,
        ready: 0,
        notReady: 0,
        readinessPercent: 100,
      },
      rows: [],
    });

const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const data = await loadDashboardData();
        if (!mounted) return;

        setPersonnel(data.personnel.filter((person) => person.isActive !== false));
        setFirearms(data.firearms.filter((firearm) => firearm.is_active !== false));
        setWorkspace(data.workspace);
        setQualificationValidDays(data.qualificationValidDays);
        setQualificationDueSoonDays(data.qualificationDueSoonDays);
        setCertificationReadiness(data.certificationReadiness);
        setEquipmentReadiness(data.equipmentReadiness);
      } catch (error) {
        console.error("Could not load command dashboard.", error);
        if (mounted) {
          setLoadError("Command dashboard data could not be loaded.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  const rangeDaysById = useMemo(
    () => new Map(workspace.rangeDays.map((day) => [day.id, day])),
    [workspace.rangeDays],
  );

  const drillsById = useMemo(
    () => new Map(workspace.rangeDayDrills.map((drill) => [drill.id, drill])),
    [workspace.rangeDayDrills],
  );

  const qualificationResults = useMemo(
    () =>
      workspace.results.filter((result) =>
        isQualificationDrill(drillsById.get(result.drillId)),
      ),
    [drillsById, workspace.results],
  );

  const officerSummaries = useMemo<OfficerSummary[]>(() => {
    return personnel.map((person) => {
      const results = qualificationResults
        .filter((result) => result.officerId === person.id)
        .sort(
          (a, b) =>
            getDateValue(rangeDaysById.get(b.rangeDayId)?.date) -
            getDateValue(rangeDaysById.get(a.rangeDayId)?.date),
        );

      const passed = results.filter(isPassed);
      const day = passed.find((result) => result.runNumber === 1);
      const night = passed.find((result) => result.runNumber === 2);
      const failedQualifications = results
        .filter((result) => result.passed === false)
        .map((result) => ({
          date: rangeDaysById.get(result.rangeDayId)?.date ?? "",
          runLabel:
            result.runNumber === 1
              ? "Day Qualification"
              : result.runNumber === 2
                ? "Night Qualification"
                : `Run ${result.runNumber ?? 1}`,
        }));

      const lastDayQualification = day
        ? {
            date: rangeDaysById.get(day.rangeDayId)?.date ?? "",
            runLabel: "Day Qualification",
          }
        : undefined;

      const lastNightQualification = night
        ? {
            date: rangeDaysById.get(night.rangeDayId)?.date ?? "",
            runLabel: "Night Qualification",
          }
        : undefined;

      const evaluatedStatus = evaluateQualificationReadiness({
        lastDayQualification,
        lastNightQualification,
        failedQualifications,
        qualificationValidDays,
        qualificationDueSoonDays,
      });

      const status = evaluatedStatus.status;
      const statusReason = evaluatedStatus.statusReason;

      const scored = [...results]
        .filter((result) => typeof result.score === "number")
        .reverse();

      let scoreTrend: OfficerSummary["scoreTrend"] = "Insufficient Data";
      let trendDelta: number | undefined;

      if (scored.length >= 3) {
        trendDelta =
          (scored[scored.length - 1].score ?? 0) - (scored[0].score ?? 0);

        scoreTrend =
          trendDelta <= -5
            ? "Declining"
            : trendDelta >= 5
              ? "Improving"
              : "Stable";
      }

      return {
        officerId: person.id,
        officerName: person.displayName || person.fullName,
        status,
        statusReason,
        scoreTrend,
        trendDelta,
      };
    });
  }, [personnel, qualificationResults, qualificationValidDays, qualificationDueSoonDays, rangeDaysById]);

  const activeRangeDays = workspace.rangeDays.filter(
    (day) => day.status !== "Archived",
  );

  const upcomingRangeDays = [...activeRangeDays]
    .filter((day) => getDateValue(day.date) >= getTodayValue())
    .sort((a, b) => getDateValue(a.date) - getDateValue(b.date))
    .slice(0, 4);

  const incompletePackets = activeRangeDays.filter(
    (day) =>
      day.status !== "Completed" &&
      day.status !== "Locked" &&
      day.packetStatus !== "Ready",
  );

  const firearmAlerts = firearms.filter((firearm) => {
    const status = (firearm.condition_status ?? "").toLowerCase();

    const unresolved = workspace.malfunctions.some(
      (malfunction) =>
        malfunction.firearmId === firearm.id &&
        (malfunction.inspectionRequired ||
          malfunction.removedFromService ||
          malfunction.resolvedOnRange === false),
    );

    return (
      status.includes("maintenance") ||
      status.includes("out of service") ||
      status.includes("oos") ||
      unresolved
    );
  });

  const currentCount = officerSummaries.filter(
    (officer) => officer.status === "Current",
  ).length;
  const missingDayCount = officerSummaries.filter(
    (officer) =>
      officer.status === "Missing Day" || officer.status === "No Record",
  ).length;
  const missingNightCount = officerSummaries.filter(
    (officer) => officer.status === "Missing Night",
  ).length;

  const dueSoonCount = officerSummaries.filter(
    (officer) => officer.status === "Due Soon",
  ).length;
  const failedOrOverdueCount = officerSummaries.filter(
    (officer) => officer.status === "Failed" || officer.status === "Overdue",
  ).length;
  const declining = officerSummaries.filter(
    (officer) => officer.scoreTrend === "Declining",
  );
  const improvingCount = officerSummaries.filter(
    (officer) => officer.scoreTrend === "Improving",
  ).length;

  const scoredResults = workspace.results.filter(
    (result) => typeof result.score === "number",
  );
  const averageScore = scoredResults.length
    ? Math.round(
        scoredResults.reduce((sum, result) => sum + (result.score ?? 0), 0) /
          scoredResults.length,
      )
    : undefined;

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    if (hasQualifications) {
      officerSummaries.forEach((officer) => {
        if (
          officer.status === "Failed" ||
          officer.status === "Overdue" ||
          officer.status === "Missing Day" ||
          officer.status === "Missing Night"
        ) {
          items.push({
            id: `qualification-${officer.officerId}`,
            title: `${officer.officerName} · ${officer.status}`,
            detail: officer.statusReason,
            href: "/qualifications",
            tone:
              officer.status === "Failed" || officer.status === "Overdue"
                ? "red"
                : "amber",
            icon: ShieldAlert,
          });
        }
      });
    }

    if (hasCertifications) {
      certificationReadiness.rows.forEach((row) => {
        if (row.status === "current") return;

        items.push({
          id: `certification-${row.userId}-${row.certificationTypeId}`,
          title: `${row.officerName} · ${row.certificationName}`,
          detail: row.statusReason,
          href: "/training/certifications",
          tone: row.status === "due_soon" ? "amber" : "red",
          icon: ShieldCheck,
        });
      });
    }

    if (hasEquipment) {
      const equipmentAttentionGroups = new Map<
        string,
        {
          equipmentName: string;
          status: EquipmentReadinessRow["status"];
          count: number;
        }
      >();

      equipmentReadiness.rows.forEach((row) => {
        if (row.status === "current") return;

        const key = `${row.equipmentTypeId}-${row.status}`;
        const existing = equipmentAttentionGroups.get(key);

        if (existing) {
          existing.count += 1;
        } else {
          equipmentAttentionGroups.set(key, {
            equipmentName: row.equipmentName,
            status: row.status,
            count: 1,
          });
        }
      });

      equipmentAttentionGroups.forEach((group, key) => {
        const labels: Record<EquipmentReadinessRow["status"], string> = {
          current: "Current",
          due_soon: "Expiration Due Soon",
          expired: "Expired",
          inspection_due_soon: "Inspection Due Soon",
          inspection_overdue: "Inspection Overdue",
          missing: "Missing",
          out_of_service: "Out of Service",
        };

        const warning =
          group.status === "due_soon" ||
          group.status === "inspection_due_soon";

        items.push({
          id: `equipment-${key}`,
          title: `${group.equipmentName} · ${labels[group.status]}`,
          detail: `${group.count} officer${
            group.count === 1 ? "" : "s"
          } affected. Review Equipment Readiness for details.`,
          href: "/equipment",
          tone: warning ? "amber" : "red",
          icon: Boxes,
        });
      });
    }

    if (hasFirearms) {
      firearmAlerts.forEach((firearm) => {
        items.push({
          id: `firearm-${firearm.id}`,
          title: `${firearm.make} ${firearm.model} · ${firearm.serial_number}`,
          detail: `Condition: ${firearm.condition_status ?? "Review required"}.`,
          href: "/firearms",
          tone: "red",
          icon: Wrench,
        });
      });
    }

    if (hasRangeTraining) {
      incompletePackets.forEach((day) => {
        items.push({
          id: `packet-${day.id}`,
          title: `Packet not ready · ${day.title}`,
          detail: `${formatDate(day.date)} · ${
            day.packetStatus ?? "Needs Setup"
          }`,
          href: "/range-days",
          tone: "amber",
          icon: ClipboardList,
        });
      });
    }

    if (hasAnalytics && hasRangeTraining) {
      declining.forEach((officer) => {
        items.push({
          id: `trend-${officer.officerId}`,
          title: `${officer.officerName} · Declining score trend`,
          detail:
            typeof officer.trendDelta === "number"
              ? `Scores declined by ${Math.abs(
                  officer.trendDelta,
                )} points.`
              : "Scores show a declining pattern.",
          href: "/analytics",
          tone: "amber",
          icon: TrendingDown,
        });
      });
    }

    return items.slice(0, 8);
  }, [
    certificationReadiness.rows,
    equipmentReadiness.rows,
    declining,
    firearmAlerts,
    incompletePackets,
    officerSummaries,
    hasQualifications,
    hasCertifications,
    hasEquipment,
    hasFirearms,
    hasRangeTraining,
    hasAnalytics,
  ]);
  const qualificationTone: Tone =
    failedOrOverdueCount > 0
      ? "red"
      : missingDayCount > 0 ||
          missingNightCount > 0 ||
          dueSoonCount > 0
        ? "amber"
        : "green";
  const certificationTone: Tone =
    certificationReadiness.summary.expired > 0 ||
    certificationReadiness.summary.missing > 0
      ? "red"
      : certificationReadiness.summary.dueSoon > 0
        ? "amber"
        : "green";

  const equipmentTone: Tone =
    equipmentReadiness.summary.expired > 0 ||
    equipmentReadiness.summary.missing > 0 ||
    equipmentReadiness.summary.inspectionOverdue > 0 ||
    equipmentReadiness.summary.outOfService > 0
      ? "red"
      : equipmentReadiness.summary.dueSoon > 0 ||
          equipmentReadiness.summary.inspectionDueSoon > 0
        ? "amber"
        : "green";


  return (
    <TracePointShell activePage="Command Dashboard">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-[24px] font-bold text-white">
                TracePoint Command Pulse
              </h1>
              <p className="mt-1 max-w-4xl text-[12px] leading-5 text-slate-500">
                Operational readiness across qualifications, certifications, equipment, firearms, range activity, and training.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {hasRangeTraining && (
                <Link
                  href="/range-days"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500"
                >
                  <CalendarDays size={14} />
                  Plan Range Day
                </Link>
              )}

              {hasAnalytics && hasRangeTraining && (
                <Link
                  href="/analytics"
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
                >
                  <BarChart3 size={14} />
                  View Analytics
                </Link>
              )}
            </div>
          </div>
        </header>

        {loadError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
            {loadError}
          </div>
        )}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          {hasQualifications && (
            <PulseCard
              title="Qualification Readiness"
              value={loading ? "—" : `${currentCount}/${personnel.length}`}
              label="Officers current"
              detail={`${missingDayCount} missing day/no record ? ${missingNightCount} missing night ? ${dueSoonCount} due soon ? ${failedOrOverdueCount} failed/overdue.`}
              icon={Shield}
              tone={qualificationTone}
            />
          )}

          {hasCertifications && (
            <PulseCard
              title="Certification Readiness"
              value={
                loading
                  ? "—"
                  : certificationReadiness.summary.totalRequiredChecks === 0
                    ? "—"
                    : `${certificationReadiness.summary.readinessPercent}%`
              }
              label={
                certificationReadiness.summary.totalRequiredChecks === 0
                  ? "No requirements configured"
                  : "Required checks ready"
              }
              detail={
                certificationReadiness.summary.totalRequiredChecks === 0
                  ? "Configure required certifications to begin agency readiness tracking."
                  : `${certificationReadiness.summary.dueSoon} due soon · ${certificationReadiness.summary.expired} expired · ${certificationReadiness.summary.missing} missing.`
              }
              icon={ShieldCheck}
              tone={certificationTone}
            />
          )}

          {hasEquipment && (
            <PulseCard
              title="Equipment Readiness"
              value={
                loading
                  ? "—"
                  : equipmentReadiness.summary.totalRequiredChecks === 0
                    ? "—"
                    : `${equipmentReadiness.summary.readinessPercent}%`
              }
              label={
                equipmentReadiness.summary.totalRequiredChecks === 0
                  ? "No requirements configured"
                  : "Required checks ready"
              }
              detail={
                equipmentReadiness.summary.totalRequiredChecks === 0
                  ? "Configure required equipment to begin agency readiness tracking."
                  : `${equipmentReadiness.summary.missing} missing · ${equipmentReadiness.summary.expired} expired · ${equipmentReadiness.summary.inspectionOverdue} inspection overdue · ${equipmentReadiness.summary.outOfService} out of service.`
              }
              icon={Boxes}
              tone={equipmentTone}
            />
          )}

          {hasRangeTraining && (
            <>
              <PulseCard
                title="Range Readiness"
                value={loading ? "—" : upcomingRangeDays.length}
                label="Upcoming range days"
                detail={`${incompletePackets.length} packet${incompletePackets.length === 1 ? "" : "s"} need setup or review.`}
                icon={CalendarDays}
                tone={incompletePackets.length > 0 ? "amber" : "green"}
              />

              <PulseCard
                title="Records Health"
                value={loading ? "—" : workspace.rangeDays.length}
                label="Range days saved"
                detail={`${workspace.rangeRoster.length} roster assignments · ${workspace.rangeDayDrills.length} planned drills.`}
                icon={FileText}
                tone={incompletePackets.length > 0 ? "amber" : "green"}
              />

              <PulseCard
                title="Performance Signal"
                value={loading ? "—" : averageScore ?? "—"}
                label="Average score"
                detail={`${declining.length} declining · ${improvingCount} improving.`}
                icon={TrendingUp}
                tone={declining.length > 0 ? "amber" : "blue"}
              />
            </>
          )}

          {hasFirearms && (
            <PulseCard
              title="Firearm Reliability"
              value={loading ? "—" : firearmAlerts.length}
              label="Weapons flagged"
              detail={`${firearms.length} active firearm record${firearms.length === 1 ? "" : "s"} loaded.`}
              icon={Crosshair}
              tone={firearmAlerts.length > 0 ? "red" : "green"}
            />
          )}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_430px]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[18px] font-bold text-white">
                  <Activity size={18} className="text-blue-400" />
                  Critical Attention
                </h2>
                <p className="mt-1 text-[12px] text-slate-500">
                  Live qualification, certification, equipment, firearm, range-packet, and performance items requiring review.
                </p>
              </div>
              <StatusPill
                label={`${attentionItems.length} active`}
                tone={attentionItems.length > 0 ? "amber" : "green"}
              />
            </div>

            {attentionItems.length === 0 ? (
              <EmptyPanel message="No command attention items are currently identified." />
            ) : (
              <div className="space-y-3">
                {attentionItems.map((item) => {
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={`group flex items-start justify-between gap-3 rounded-2xl border p-3 transition hover:border-blue-500/40 ${toneClasses(
                        item.tone,
                      )}`}
                    >
                      <div className="flex gap-3">
                        <div
                          className={`h-fit rounded-xl border p-2 ${toneClasses(
                            item.tone,
                          )}`}
                        >
                          <Icon size={15} />
                        </div>
                        <div>
                          <p className="text-[13px] font-bold text-white">
                            {item.title}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {item.detail}
                          </p>
                        </div>
                      </div>
                      <ChevronRight
                        size={15}
                        className="mt-1 text-slate-600 group-hover:text-blue-300"
                      />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <h2 className="text-[17px] font-bold text-white">
                Qualification Snapshot
              </h2>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  ["Current", currentCount, CheckCircle2, "green" as Tone],
                  ["Missing Day", missingDayCount, Sun, "blue" as Tone],
                  ["Missing Night", missingNightCount, Moon, "amber" as Tone],
                  ["Due Soon", dueSoonCount, CalendarDays, "amber" as Tone],
                  [
                    "Failed/Overdue",
                    failedOrOverdueCount,
                    AlertTriangle,
                    "red" as Tone,
                  ],
                ].map(([label, value, Icon, tone]) => {
                  const MetricIcon = Icon as typeof Shield;

                
  
  return (
                    <div
                      key={String(label)}
                      className={`rounded-2xl border p-3 ${toneClasses(
                        tone as Tone,
                      )}`}
                    >
                      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest">
                        <MetricIcon size={13} />
                        {String(label)}
                      </p>
                      <p className="mt-1 text-2xl font-bold text-white">
                        {Number(value)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <h2 className="text-[17px] font-bold text-white">
                Module Snapshot
              </h2>
              <div className="mt-4 space-y-2">
                {[
                  hasRangeTraining
                    ? [
                        "Range & Training",
                        "/range-days",
                        `${activeRangeDays.length} active range days`,
                      ]
                    : null,
                  hasQualifications
                    ? [
                        "Qualifications",
                        "/qualifications",
                        `${qualificationResults.length} qualification results`,
                      ]
                    : null,
                  hasFirearms
                    ? [
                        "Firearms",
                        "/firearms",
                        `${firearms.length} active firearms`,
                      ]
                    : null,
                  hasEquipment
                    ? [
                        "Equipment Readiness",
                        "/equipment",
                        equipmentReadiness.summary.totalRequiredChecks === 0
                          ? "No requirements configured"
                          : `${equipmentReadiness.summary.notReady} readiness exceptions`,
                      ]
                    : null,
                  hasAnalytics && hasRangeTraining
                    ? [
                        "Analytics",
                        "/analytics",
                        `${declining.length} declining trends`,
                      ]
                    : null,
                ]
                  .filter(
                    (
                      item,
                    ): item is [string, string, string] =>
                      item !== null,
                  )
                  .map(([title, href, detail]) => (
                    <Link
                      key={title}
                      href={href}
                      className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-3 transition hover:border-blue-500/40"
                    >
                      <div>
                        <p className="text-[13px] font-semibold text-white">
                          {title}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {detail}
                        </p>
                      </div>
                      <ChevronRight size={15} className="text-slate-600" />
                    </Link>
                  ))}
              </div>

            </div>
          </div>
        </section>
        {hasRangeTraining && (
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-bold text-white">
                Upcoming Range Days
              </h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Scheduled events and packet readiness.
              </p>
            </div>
            <StatusPill label={`${upcomingRangeDays.length} upcoming`} />
          </div>

          {upcomingRangeDays.length === 0 ? (
            <EmptyPanel message="No upcoming range days are currently saved." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {upcomingRangeDays.map((day) => (
                <Link
                  key={day.id}
                  href="/range-days"
                  className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-blue-500/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="mb-2 flex gap-2">
                        <StatusPill label={day.status} />
                        <StatusPill
                          label={day.packetStatus ?? "Needs Setup"}
                          tone={day.packetStatus === "Ready" ? "green" : "amber"}
                        />
                      </div>
                      <p className="text-[14px] font-bold text-white">
                        {day.title}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {formatDate(day.date)} · {day.location}
                      </p>
                    </div>
                    <ChevronRight size={15} className="text-slate-600" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        )}
      </div>
    </TracePointShell>
  );
}























