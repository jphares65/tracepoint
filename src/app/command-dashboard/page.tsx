"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
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
  GraduationCap,
  Moon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TrendingDown,
  TrendingUp,
  Truck,
  Wrench,
} from "lucide-react";

import CommandOperationsPanel, {
  useCommandOperationsData,
} from "@/app/components/CommandOperationsPanel";
import {
  AdvancedSettings,
  CustomizationBar,
  ReorderButtons,
  useVisualConfigurationEditor,
} from "@/app/components/VisualCustomization";
import TracePointShell from "@/app/components/TracePointShell";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";
import type { FirearmMalfunction } from "@/app/lib/tracepoint/types";
import type { QualificationReadinessStatus } from "@/lib/tracepoint/qualification-readiness";
import type {
  DrillRunResult,
  DrillTemplate,
  RangeDay,
  RangeDayDrill,
  RangeRosterEntry,
} from "@/app/lib/tracepoint/range-day-types";
import {
  DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
  normalizeAnalyticsDashboardConfiguration,
  type AnalyticsDashboardConfiguration,
  type CommandDashboardCardKey,
  type CommandDashboardSectionKey,
} from "@/lib/tracepoint/analytics-dashboard-config";
import {
  buildUpcomingOperationalEvents,
  type UpcomingOperationalEvent,
} from "@/lib/tracepoint/upcoming-operational-events";

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

const DASHBOARD_CARD_DETAILS: Record<
  CommandDashboardCardKey,
  { title: string; description: string }
> = {
  qualification_readiness: {
    title: "Qualification Readiness",
    description: "Current qualification coverage and exceptions.",
  },
  certification_readiness: {
    title: "Certification Readiness",
    description: "Required certification coverage across the agency.",
  },
  equipment_readiness: {
    title: "Equipment Readiness",
    description: "Assignment, expiration, and inspection readiness.",
  },
  range_readiness: {
    title: "Range Readiness",
    description: "Upcoming activity and packet readiness.",
  },
  records_health: {
    title: "Range Records",
    description: "Saved range days, rosters, and planned drills.",
  },
  performance_signal: {
    title: "Performance Signal",
    description: "Improving and declining personnel trends.",
  },
  firearm_reliability: {
    title: "Firearm Reliability",
    description: "Active weapons and current reliability flags.",
  },
  agency_training: {
    title: "Agency Training",
    description: "Scheduled training events and roster activity.",
  },
  fleet_readiness: {
    title: "Fleet Readiness",
    description: "Vehicle availability and attention items.",
  },
};

const DASHBOARD_SECTION_DETAILS: Array<{
  key: CommandDashboardSectionKey;
  title: string;
  description: string;
}> = [
  {
    key: "critical_attention",
    title: "Items Requiring Attention",
    description: "Current exceptions from enabled operational modules.",
  },
  {
    key: "qualification_snapshot",
    title: "Qualification Snapshot",
    description: "A focused breakdown of agency qualification readiness.",
  },
  {
    key: "module_snapshot",
    title: "Module Snapshot",
    description: "Quick status and links for enabled agency modules.",
  },
  {
    key: "upcoming_operational_events",
    title: "Upcoming Operational Events",
    description: "Scheduled activity and approaching operational deadlines.",
  },
];

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
type PerformanceSummaryPayload = {
  metrics: Record<string, string>;
  qualificationTrends: Array<{
    officerId: string;
    name: string;
    status: QualificationReadinessStatus | "Expired";
    detail?: string;
    trend: string;
  }>;
  drillTrends: unknown[];
  broadCategoryTrends: unknown[];
  rangeSummary?: {
    totalRangeDays: number;
    activeRangeDays: number;
    upcomingRangeDayCount: number;
    incompletePacketCount: number;
    rosterAssignmentCount: number;
    plannedDrillCount: number;
    upcomingRangeDays: unknown[];
  };
};

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
    performanceSummaryResponse,
  ] = await Promise.all([
    fetch("/api/pilot/personnel", { cache: "no-store" }),
    fetch("/api/armory/firearms", { cache: "no-store" }),
    fetch("/api/pilot/range-workspace", { cache: "no-store" }),
    fetch("/api/settings/current-rules", { cache: "no-store" }),
    fetch("/api/readiness/certifications", { cache: "no-store" }),
    fetch("/api/readiness/equipment", { cache: "no-store" }),
    fetch("/api/pilot/performance-summary", { cache: "no-store" }),
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
          analytics_dashboard?: unknown;
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


  const performanceSummaryPayload: PerformanceSummaryPayload = performanceSummaryResponse.ok
    ? ((await performanceSummaryResponse.json()) as PerformanceSummaryPayload)
    : {
        metrics: {},
        qualificationTrends: [],
        drillTrends: [],
        broadCategoryTrends: [],
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
    analyticsDashboard: normalizeAnalyticsDashboardConfiguration(
      rulesPayload.rules?.analytics_dashboard,
    ),
    certificationReadiness: certificationReadinessPayload,
    equipmentReadiness: equipmentReadinessPayload,
    performanceSummary: performanceSummaryPayload,
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
    <div className="h-full rounded-3xl border border-slate-800 bg-slate-900 p-4">
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

function formatOperationalEventDate(value: string) {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(value.includes("T")
      ? { hour: "numeric", minute: "2-digit" }
      : {}),
  }).format(date);
}

function UpcomingOperationalEventsPanel({
  events,
  loading,
}: {
  events: UpcomingOperationalEvent[];
  loading: boolean;
}) {
  const sourceClasses: Record<UpcomingOperationalEvent["source"], string> = {
    "Agency Training": "border-blue-500/30 bg-blue-500/10 text-blue-200",
    Certifications:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    Fleet: "border-violet-500/30 bg-violet-500/10 text-violet-200",
    "Range & Training": "border-amber-500/30 bg-amber-500/10 text-amber-200",
  };

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
            <CalendarDays size={17} className="text-blue-400" />
            Upcoming Operational Events
          </h2>
          <p className="mt-1 text-[12px] text-slate-500">
            Scheduled activity and approaching deadlines from available agency modules.
          </p>
        </div>
        <StatusPill label={`${events.length} upcoming`} />
      </div>

      {events.length === 0 ? (
        <EmptyPanel
          message={
            loading
              ? "Loading upcoming operational events..."
              : "No upcoming operational events were found in the available modules."
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {events.map((event) => (
            <Link
              key={`${event.source}-${event.id}`}
              href={event.href}
              className="group rounded-2xl border border-slate-800 bg-slate-950/40 p-3 transition hover:border-blue-500/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-wide ${sourceClasses[event.source]}`}
                    >
                      {event.source}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-500">
                      {event.type}
                    </span>
                  </div>
                  <p className="truncate text-[13px] font-bold text-white">
                    {event.title}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-slate-500">
                    {formatOperationalEventDate(event.date)} · {event.detail}
                  </p>
                </div>
                <ChevronRight
                  size={15}
                  className="mt-1 shrink-0 text-slate-600 group-hover:text-blue-300"
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const { departmentId, enabledFeatures, hasAnyPermission, hasPermission } =
    useTracePointAccess();
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
  const canConfigure = hasPermission("administer_department");
  const hasFleet = hasAnyPermission([
    "view_fleet",
    "manage_fleet",
    "perform_fleet_inspections",
    "manage_fleet_maintenance",
    "manage_fleet_rules",
  ]);

  const [personnel, setPersonnel] = useState<PilotPersonnel[]>([]);
  const [firearms, setFirearms] = useState<LiveFirearm[]>([]);
  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [analyticsDashboard, setAnalyticsDashboard] =
    useState<AnalyticsDashboardConfiguration>(
      DEFAULT_ANALYTICS_DASHBOARD_CONFIGURATION,
    );
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
  const [performanceSummary, setPerformanceSummary] = useState<PerformanceSummaryPayload>({
    metrics: {},
    qualificationTrends: [],
    drillTrends: [],
    broadCategoryTrends: [],
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
  const [addCardsOpen, setAddCardsOpen] = useState(false);
  const editor = useVisualConfigurationEditor({
    configuration: analyticsDashboard,
    departmentId,
    canAdminister: canConfigure,
    editorName: "dashboard",
    onSaved: setAnalyticsDashboard,
  });
  const displayConfiguration = editor.editing
    ? editor.draft
    : analyticsDashboard;
  const shouldLoadCommandOperations =
    (hasRangeTraining || hasFleet) &&
    (displayConfiguration.command_dashboard_cards.agency_training ||
      displayConfiguration.command_dashboard_cards.fleet_readiness ||
      displayConfiguration.command_dashboard_sections.critical_attention ||
      displayConfiguration.command_dashboard_sections
        .upcoming_operational_events);
  const {
    data: commandOperations,
    error: commandOperationsError,
    loading: commandOperationsLoading,
  } = useCommandOperationsData(shouldLoadCommandOperations);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const data = await loadDashboardData();
        if (!mounted) return;

        setPersonnel(data.personnel.filter((person) => person.isActive !== false));
        setFirearms(data.firearms.filter((firearm) => firearm.is_active !== false));
        setWorkspace(data.workspace);
        setAnalyticsDashboard(data.analyticsDashboard);
        setCertificationReadiness(data.certificationReadiness);
        setEquipmentReadiness(data.equipmentReadiness);
        setPerformanceSummary(data.performanceSummary);
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
    const rows = Array.isArray(performanceSummary?.qualificationTrends)
      ? performanceSummary.qualificationTrends
      : [];

    return rows.map((row) => ({
      officerId: row.officerId,
      officerName: row.name,
      status:
        row.status === "Expired"
          ? "Overdue"
          : row.status,
      statusReason: row.detail ?? "",
      scoreTrend:
        row.trend === "Improving"
          ? "Improving"
          : row.trend === "Declining" || row.trend === "Action Needed"
            ? "Declining"
            : row.trend === "Stable"
              ? "Stable"
              : "Insufficient Data",
      trendDelta: undefined,
    }));
  }, [performanceSummary]);

  const activeRangeDays = workspace.rangeDays.filter(
    (day) => day.status !== "Archived",
  );

  const upcomingRangeDays = [...activeRangeDays]
    .filter(
      (day) =>
        day.status !== "Completed" &&
        day.status !== "Locked" &&
        getDateValue(day.date) >= getTodayValue(),
    )
    .sort((a, b) => getDateValue(a.date) - getDateValue(b.date));

  const incompletePackets = activeRangeDays.filter(
    (day) =>
      day.status !== "Completed" &&
      day.status !== "Locked" &&
      day.packetStatus !== "Ready",
  );

  const authoritativeRange = performanceSummary?.rangeSummary ?? {
    totalRangeDays: 0,
    activeRangeDays: 0,
    upcomingRangeDayCount: 0,
    incompletePacketCount: 0,
    rosterAssignmentCount: 0,
    plannedDrillCount: 0,
    upcomingRangeDays: [],
  };
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

  const attentionItems: AttentionItem[] = (() => {
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

    const commandOperationAttention = [
      ...(hasRangeTraining && commandOperations?.agencyTraining.available
        ? commandOperations.agencyTraining.attention.map((item) => ({
            ...item,
            source: "training" as const,
          }))
        : []),
      ...(hasFleet && commandOperations?.fleet.available
        ? commandOperations.fleet.attentionItems.map((item) => ({
            ...item,
            source: "fleet" as const,
          }))
        : []),
    ].slice(0, displayConfiguration.command_operations_attention_item_limit);

    commandOperationAttention.forEach((item) => {
      items.push({
        id: `${item.source}-${item.id}`,
        title: item.title,
        detail: item.detail,
        href: item.href,
        tone: item.priority,
        icon: item.source === "training" ? GraduationCap : Truck,
      });
    });

    return items.slice(0, displayConfiguration.command_attention_item_limit);
  })();
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

  const availableCardKeys = displayConfiguration.command_dashboard_card_order.filter(
    (key) =>
      (key === "qualification_readiness" && hasQualifications) ||
      (key === "certification_readiness" && hasCertifications) ||
      (key === "equipment_readiness" && hasEquipment) ||
      ((key === "range_readiness" ||
        key === "records_health" ||
        key === "performance_signal" ||
        key === "agency_training") &&
        hasRangeTraining) ||
      (key === "firearm_reliability" && hasFirearms) ||
      (key === "fleet_readiness" && hasFleet),
  );

  const upcomingOperationalEvents = buildUpcomingOperationalEvents(
    [
      {
        enabled: hasRangeTraining,
        available: true,
        events: upcomingRangeDays.map((day) => ({
          id: day.id,
          title: day.title,
          date: day.date,
          source: "Range & Training" as const,
          type: "Range day",
          detail: `${day.location || "Location not set"} · ${day.packetStatus ?? "Needs setup"}`,
          href: "/range-days",
        })),
      },
      {
        enabled: hasRangeTraining,
        available: commandOperations?.agencyTraining.available ?? false,
        events: (commandOperations?.agencyTraining.upcoming ?? []).map(
          (event) => ({
            id: event.id,
            title: event.title,
            date: event.startsAt,
            source: "Agency Training" as const,
            type: event.trainingType || "Training",
            detail: `${event.location || "Location not set"} · ${event.attendeeCount} assigned`,
            href: "/agency-training",
          }),
        ),
      },
      {
        enabled: hasFleet,
        available: commandOperations?.fleet.available ?? false,
        events: (commandOperations?.fleet.upcoming ?? []).map((event) => ({
          id: event.id,
          title: `Unit ${event.unitNumber}`,
          date: event.dueDate,
          source: "Fleet" as const,
          type: event.label,
          detail: "Approaching fleet deadline",
          href: `/fleet-management/${event.vehicleId}`,
        })),
      },
      {
        enabled: hasCertifications,
        available: true,
        events: certificationReadiness.rows
          .filter(
            (row) => row.status === "due_soon" && Boolean(row.expirationDate),
          )
          .map((row) => ({
            id: `${row.userId}-${row.certificationTypeId}`,
            title: row.certificationName,
            date: row.expirationDate as string,
            source: "Certifications" as const,
            type: "Expiration",
            detail: `${row.officerName} · ${row.statusReason}`,
            href: "/training/certifications",
          })),
      },
    ],
    displayConfiguration.upcoming_range_days_item_limit,
  );

  const availableSectionKeys =
    displayConfiguration.command_dashboard_section_order.filter(
      (key) =>
        key !== "qualification_snapshot" || hasQualifications,
    ).filter(
      (key) =>
        key !== "upcoming_operational_events" ||
        hasRangeTraining ||
        hasFleet ||
        hasCertifications,
    );
  const visibleSectionKeys = availableSectionKeys.filter(
    (key) => displayConfiguration.command_dashboard_sections[key],
  );

  function patchDraft(
    patch: Partial<AnalyticsDashboardConfiguration>,
  ) {
    editor.setDraft((current) => ({ ...current, ...patch }));
  }

  function moveDashboardCard(
    key: CommandDashboardCardKey,
    direction: -1 | 1,
  ) {
    const visible = displayConfiguration.command_dashboard_card_order.filter(
      (candidate) =>
        availableCardKeys.includes(candidate) &&
        displayConfiguration.command_dashboard_cards[candidate],
    );
    const visibleIndex = visible.indexOf(key);
    const neighbor = visible[visibleIndex + direction];
    if (!neighbor) return;

    const next = [...displayConfiguration.command_dashboard_card_order];
    const index = next.indexOf(key);
    const neighborIndex = next.indexOf(neighbor);
    [next[index], next[neighborIndex]] = [next[neighborIndex], next[index]];
    patchDraft({ command_dashboard_card_order: next });
  }

  function moveDashboardSection(
    key: CommandDashboardSectionKey,
    direction: -1 | 1,
  ) {
    const visibleIndex = visibleSectionKeys.indexOf(key);
    const neighbor = visibleSectionKeys[visibleIndex + direction];
    if (!neighbor) return;

    const next = [...displayConfiguration.command_dashboard_section_order];
    const index = next.indexOf(key);
    const neighborIndex = next.indexOf(neighbor);
    [next[index], next[neighborIndex]] = [next[neighborIndex], next[index]];
    patchDraft({ command_dashboard_section_order: next });
  }

  const dashboardCards: Partial<
    Record<CommandDashboardCardKey, ReactNode>
  > = {
    ...(hasQualifications
      ? {
          qualification_readiness: (
            <PulseCard
              title="Qualification Readiness"
              value={loading ? "—" : `${currentCount}/${personnel.length}`}
              label="Officers current"
              detail={`${missingDayCount} missing day/no record · ${missingNightCount} missing night · ${dueSoonCount} due soon · ${failedOrOverdueCount} failed/overdue.`}
              icon={Shield}
              tone={qualificationTone}
            />
          ),
        }
      : {}),
    ...(hasCertifications
      ? {
          certification_readiness: (
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
          ),
        }
      : {}),
    ...(hasEquipment
      ? {
          equipment_readiness: (
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
          ),
        }
      : {}),
    ...(hasRangeTraining
      ? {
          range_readiness: (
            <PulseCard
              title="Range Readiness"
              value={loading ? "—" : authoritativeRange.upcomingRangeDayCount}
              label="Upcoming range days"
              detail={`${authoritativeRange.incompletePacketCount} packet${authoritativeRange.incompletePacketCount === 1 ? "" : "s"} need setup or review.`}
              icon={CalendarDays}
              tone={incompletePackets.length > 0 ? "amber" : "green"}
            />
          ),
          records_health: (
            <PulseCard
              title="Range Records"
              value={loading ? "—" : authoritativeRange.totalRangeDays}
              label="Range days saved"
              detail={`${authoritativeRange.rosterAssignmentCount} roster assignments · ${authoritativeRange.plannedDrillCount} planned drills.`}
              icon={FileText}
              tone={incompletePackets.length > 0 ? "amber" : "green"}
            />
          ),
          performance_signal: (
            <PulseCard
              title="Performance Signal"
              value={loading ? "—" : improvingCount}
              label="Personnel improving"
              detail={`${declining.length} declining · ${improvingCount} improving.`}
              icon={TrendingUp}
              tone={declining.length > 0 ? "amber" : "blue"}
            />
          ),
        }
      : {}),
    ...(hasFirearms
      ? {
          firearm_reliability: (
            <PulseCard
              title="Firearm Reliability"
              value={loading ? "—" : firearmAlerts.length}
              label="Weapons flagged"
              detail={`${firearms.length} active firearm record${firearms.length === 1 ? "" : "s"} loaded.`}
              icon={Crosshair}
              tone={firearmAlerts.length > 0 ? "red" : "green"}
            />
          ),
        }
      : {}),
  };

  const dashboardSections: Record<CommandDashboardSectionKey, ReactNode> = {
    critical_attention: (
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[18px] font-bold text-white">
              <Activity size={18} className="text-blue-400" />
              Items Requiring Attention
            </h2>
            <p className="mt-1 text-[12px] text-slate-500">
              Live readiness, training, fleet, range-packet, firearm, and performance exceptions from enabled modules.
            </p>
          </div>
          <StatusPill
            label={`${attentionItems.length} active`}
            tone={attentionItems.length > 0 ? "amber" : "green"}
          />
        </div>

        {attentionItems.length === 0 ? (
          <EmptyPanel message="No current readiness or performance exceptions were identified in the enabled modules." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
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
                    className="mt-1 shrink-0 text-slate-600 group-hover:text-blue-300"
                  />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    ),
    qualification_snapshot: (
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <h2 className="text-[17px] font-bold text-white">
          Qualification Snapshot
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
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
                className={`rounded-2xl border p-3 ${toneClasses(tone as Tone)}`}
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
      </section>
    ),
    module_snapshot: (
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <h2 className="text-[17px] font-bold text-white">Module Snapshot</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {[
            hasRangeTraining
              ? [
                  "Range & Training",
                  "/range-days",
                  `${authoritativeRange.activeRangeDays} active range days`,
                ]
              : null,
            hasRangeTraining && commandOperations?.agencyTraining.available
              ? [
                  "Agency Training",
                  "/agency-training",
                  `${commandOperations.agencyTraining.scheduled + commandOperations.agencyTraining.inProgress} scheduled or active events`,
                ]
              : null,
            hasQualifications
              ? [
                  "Qualifications",
                  "/qualifications",
                  `${qualificationResults.length} qualification results`,
                ]
              : null,
            hasCertifications
              ? [
                  "Certifications",
                  "/training/certifications",
                  certificationReadiness.summary.totalRequiredChecks === 0
                    ? "No requirements configured"
                    : `${certificationReadiness.summary.notReady} readiness exceptions`,
                ]
              : null,
            hasFirearms
              ? [
                  "Firearms",
                  "/firearms",
                  `${firearms.length} active firearms`,
                ]
              : null,
            hasFleet && commandOperations?.fleet.available
              ? [
                  "Fleet",
                  "/fleet-management",
                  `${commandOperations.fleet.availableVehicles}/${commandOperations.fleet.total} vehicles available`,
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
              (item): item is [string, string, string] => item !== null,
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
                  <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
                </div>
                <ChevronRight size={15} className="text-slate-600" />
              </Link>
            ))}
        </div>
      </section>
    ),
    upcoming_operational_events: (
      <UpcomingOperationalEventsPanel
        events={upcomingOperationalEvents}
        loading={loading || commandOperationsLoading}
      />
    ),
  };


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
              {canConfigure && !editor.editing ? (
                <button
                  type="button"
                  onClick={editor.begin}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
                >
                  <SlidersHorizontal size={14} />
                  Customize Dashboard
                </button>
              ) : null}

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

        {editor.editing ? (
          <CustomizationBar
            title="Build your Command Dashboard"
            description="Arrange cards and command-level sections into the operational view your agency needs. Changes preview here until you save."
            addLabel="Add Card / Section"
            addOpen={addCardsOpen}
            dirty={editor.dirty}
            saving={editor.saving}
            notice={editor.notice}
            onToggleAdd={() => setAddCardsOpen((open) => !open)}
            onReset={editor.reset}
            onCancel={editor.cancel}
            onSave={() => void editor.save()}
          >
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Available cards
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {availableCardKeys.map((key) => {
                  const visible = editor.draft.command_dashboard_cards[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        patchDraft({
                          command_dashboard_cards: {
                            ...editor.draft.command_dashboard_cards,
                            [key]: !visible,
                          },
                        })
                      }
                      className={`rounded-2xl border p-3 text-left transition ${
                        visible
                          ? "border-blue-500/35 bg-blue-500/10"
                          : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-100">
                          {DASHBOARD_CARD_DETAILS[key].title}
                        </span>
                        <span className={`text-[10px] font-semibold ${visible ? "text-blue-300" : "text-slate-500"}`}>
                          {visible ? "Added" : "Add"}
                        </span>
                      </span>
                      <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                        {DASHBOARD_CARD_DETAILS[key].description}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 border-t border-slate-800 pt-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-400">
                      Dashboard sections
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Full-width command components shown below the cards.
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {availableSectionKeys.map((key) => {
                    const section = DASHBOARD_SECTION_DETAILS.find(
                      (candidate) => candidate.key === key,
                    );
                    if (!section) return null;
                    const visible = editor.draft.command_dashboard_sections[section.key];
                    return (
                      <button
                        key={section.key}
                        type="button"
                        role="switch"
                        aria-checked={visible}
                        onClick={() =>
                          patchDraft({
                            command_dashboard_sections: {
                              ...editor.draft.command_dashboard_sections,
                              [section.key]: !visible,
                            },
                          })
                        }
                        className={`rounded-2xl border p-3 text-left transition ${
                          visible
                            ? "border-violet-500/35 bg-violet-500/10"
                            : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-100">
                            {section.title}
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${visible ? "text-violet-300" : "text-slate-500"}`}
                          >
                            {visible ? "Added" : "Add section"}
                          </span>
                        </span>
                        <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                          {section.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <AdvancedSettings>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["command_attention_item_limit", "Attention items", 1, 25],
                      ["upcoming_range_days_item_limit", "Upcoming operational events", 1, 20],
                    ].map(([key, label, min, max]) => (
                      <label key={String(key)} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                        <span className="block text-xs font-semibold text-slate-300">{String(label)}</span>
                        <input
                          type="number"
                          min={Number(min)}
                          max={Number(max)}
                          value={Number(editor.draft[key as "command_attention_item_limit" | "upcoming_range_days_item_limit"])}
                          onChange={(event) =>
                            patchDraft({
                              [key]: Math.max(Number(min), Math.min(Number(max), Number(event.target.value))),
                            })
                          }
                          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-blue-500"
                        />
                      </label>
                    ))}
                  </div>
                </AdvancedSettings>
              </div>
            </div>
          </CustomizationBar>
        ) : null}

        {loadError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[12px] text-red-200">
            {loadError}
          </div>
        )}

        <CommandOperationsPanel
          configuration={displayConfiguration}
          agencyTrainingEnabled={hasRangeTraining}
          fleetEnabled={hasFleet}
          cards={dashboardCards}
          data={commandOperations}
          error={commandOperationsError}
          customizing={editor.editing}
          onHideCard={(key) =>
            patchDraft({
              command_dashboard_cards: {
                ...editor.draft.command_dashboard_cards,
                [key]: false,
              },
            })
          }
          onMoveCard={moveDashboardCard}
          onSizeCard={(key, size) =>
            patchDraft({
              command_dashboard_card_sizes: {
                ...editor.draft.command_dashboard_card_sizes,
                [key]: size,
              },
            })
          }
        />

        {visibleSectionKeys.map((key, index) => {
          const section = DASHBOARD_SECTION_DETAILS.find(
            (candidate) => candidate.key === key,
          );
          if (!section) return null;

          return (
            <div
              key={key}
              className={
                editor.editing
                  ? "rounded-[1.75rem] border border-dashed border-violet-400/45 bg-violet-500/[0.035] p-1.5"
                  : ""
              }
            >
              {editor.editing ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-violet-300">
                    Section · {section.title}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ReorderButtons
                      label={section.title}
                      first={index === 0}
                      last={index === visibleSectionKeys.length - 1}
                      onPrevious={() => moveDashboardSection(key, -1)}
                      onNext={() => moveDashboardSection(key, 1)}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        patchDraft({
                          command_dashboard_sections: {
                            ...editor.draft.command_dashboard_sections,
                            [key]: false,
                          },
                        })
                      }
                      className="rounded-lg border border-slate-700 bg-slate-950/80 px-2 py-1.5 text-[9px] font-semibold text-slate-400 transition hover:border-red-500/40 hover:text-red-200"
                    >
                      Remove Section
                    </button>
                  </span>
                </div>
              ) : null}
              {dashboardSections[key]}
            </div>
          );
        })}
        {editor.editing && visibleSectionKeys.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center rounded-3xl border border-dashed border-violet-500/35 bg-violet-500/[0.035] px-6 text-center text-xs text-slate-500">
            No dashboard sections are shown. Use Add Card / Section above to add one.
          </div>
        ) : null}
      </div>
    </TracePointShell>
  );
}























