"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import { createClient } from "@/lib/supabase/client";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Crosshair,
  Inbox,
  Moon,
  Shield,
  ShieldAlert,
  Sun,
  Target,
  UserCheck,
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
  CURRENT_USER_PROFILE,
} from "@/app/lib/tracepoint/current-user";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";
import { MOCK_FIREARMS } from "@/app/lib/tracepoint/mock-data";

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

type InboxItem = {
  id: string;
  audience: "Chief" | "Officer";
  officerId?: string;
  title: string;
  message: string;
  createdAt: string;
  relatedRequestId: string;
  status: "Open" | "Resolved";
};

type OffDutyRecord = {
  id: string;
  officerId: string;
  make: string;
  model: string;
  serial: string;
  requestStatus: string;
  authorizationStatus: string;
  decisionNotes?: string;
};

type HomeItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  priority: "Critical" | "High" | "Normal";
  source:
    | "Off-Duty"
    | "Range"
    | "Qualifications"
    | "Firearms"
    | "System";
  createdAt?: string;
};

type AuthenticatedHomeProfile = {
  id: string;
  name: string;
  role: string;
  rankTitle: string;
  unit: string;
  badge: string;
};

type ProfileRow = {
  full_name?: string | null;
};

type MembershipRow = {
  department_id?: string | null;
  badge_number?: string | null;
  rank_title?: string | null;
  unit_name?: string | null;
};

type MembershipRoleRow = {
  role_code?: string | null;
};

const ROLE_PRIORITY = [
  "administrator",
  "chief",
  "command_staff",
  "supervisor",
  "range_master",
  "armorer",
  "instructor",
  "officer",
] as const;

const ROLE_LABELS: Record<string, string> = {
  administrator: "Administrator",
  chief: "Chief",
  command_staff: "Command Staff",
  supervisor: "Supervisor",
  range_master: "Range Master",
  armorer: "Armorer",
  instructor: "Instructor",
  officer: "Officer",
};

function getRoleLabel(rows: MembershipRoleRow[]) {
  const roleCode = ROLE_PRIORITY.find((code) =>
    rows.some((row) => row.role_code === code),
  );

  return roleCode ? ROLE_LABELS[roleCode] : "Member";
}

const RANK_ABBREVIATIONS: Record<string, string> = {
  "Chief of Police": "Chief",
  Chief: "Chief",
  "Deputy Chief": "D/C",
  Captain: "Capt.",
  Lieutenant: "Lt.",
  Sergeant: "Sgt.",
  Corporal: "Cpl.",
  Detective: "Det.",
  Officer: "Ofc.",
  "Patrol Officer": "Ofc.",
};

function getProfessionalGreeting(profile: AuthenticatedHomeProfile) {
  const nameParts = profile.name.trim().split(/\s+/).filter(Boolean);

  if (nameParts.length === 0) {
    return "";
  }

  if (nameParts.length === 1) {
    return nameParts[0];
  }

  const lastName = nameParts[nameParts.length - 1];
  const rankTitle = profile.rankTitle.trim();
  const rankLabel =
    RANK_ABBREVIATIONS[rankTitle] || rankTitle;

  return rankLabel ? `${rankLabel} ${lastName}` : nameParts[0];
}

const RANGE_WORKSPACE_KEY = "tracepoint.rangeDays.workspace.v1";
const INBOX_KEY = "tracepoint-inbox-v1";
const OFF_DUTY_KEY = "tracepoint-off-duty-workflow-v1";

const EMPTY_WORKSPACE: StoredRangeDayWorkspace = {
  rangeDays: [],
  drillLibrary: [],
  rangeDayDrills: [],
  rangeRoster: [],
  results: [],
  malfunctions: [],
};

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;

  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;

    return JSON.parse(stored) as T;
  } catch (error) {
    console.warn(`Could not load ${key}.`, error);
    return fallback;
  }
}

function normalizeWorkspace(
  workspace: Partial<StoredRangeDayWorkspace> | null,
): StoredRangeDayWorkspace {
  return {
    rangeDays: Array.isArray(workspace?.rangeDays)
      ? workspace.rangeDays
      : [],
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

function getDateValue(value?: string) {
  if (!value) return 0;

  const parsed = value.includes("T")
    ? new Date(value).getTime()
    : new Date(`${value}T00:00:00`).getTime();

  return Number.isNaN(parsed) ? 0 : parsed;
}

function getTodayValue() {
  const today = new Date();

  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
}

function formatDate(value?: string) {
  if (!value) return "Date not set";

  const parsed = value.includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getFirearmLabel(firearmId?: string) {
  if (!firearmId) return "No firearm assigned";

  const firearm = MOCK_FIREARMS.find((item) => item.id === firearmId);

  if (!firearm) return "Unknown firearm";

  return `${firearm.make} ${firearm.model} · ${firearm.serialNumber}`;
}

function isQualificationDrill(drill?: RangeDayDrill) {
  if (!drill) return false;

  return (
    drill.category === "Qualification" ||
    drill.name.toLowerCase().includes("qualification")
  );
}

function getPriorityClass(priority: HomeItem["priority"]) {
  if (priority === "Critical") {
    return "border-red-500/30 bg-red-500/[0.07]";
  }

  if (priority === "High") {
    return "border-amber-500/30 bg-amber-500/[0.06]";
  }

  return "border-slate-800 bg-slate-950/40";
}

function getPriorityIcon(priority: HomeItem["priority"]) {
  if (priority === "Critical") {
    return <ShieldAlert size={16} className="text-red-300" />;
  }

  if (priority === "High") {
    return <AlertTriangle size={16} className="text-amber-300" />;
  }

  return <Bell size={16} className="text-blue-300" />;
}

function SnapshotCard({
  label,
  value,
  detail,
  href,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  href: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group rounded-3xl border border-slate-800 bg-slate-900 p-4 transition hover:border-blue-500/40 hover:bg-slate-800/80"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
          {label}
        </p>
        {icon}
      </div>

      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>

      <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-blue-300">
        Open
        <ChevronRight
          size={13}
          className="transition group-hover:translate-x-0.5"
        />
      </div>
    </Link>
  );
}

export default function MyTracePointHomePage() {
  const {
    hasPermission: userHasPermission,
  } = useTracePointAccess();

  const [workspace, setWorkspace] =
    useState<StoredRangeDayWorkspace>(EMPTY_WORKSPACE);
  const [storedInbox, setStoredInbox] = useState<InboxItem[]>([]);
  const [offDutyRecords, setOffDutyRecords] = useState<OffDutyRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [homeProfile, setHomeProfile] =
    useState<AuthenticatedHomeProfile>({
      id: "",
      name: "",
      role: "Member",
      rankTitle: "",
      unit: "Department",
      badge: "",
    });

  useEffect(() => {
    const parsedWorkspace = loadJson<Partial<StoredRangeDayWorkspace> | null>(
      RANGE_WORKSPACE_KEY,
      null,
    );

    setWorkspace(normalizeWorkspace(parsedWorkspace));
    setStoredInbox(loadJson<InboxItem[]>(INBOX_KEY, []));
    setOffDutyRecords(loadJson<OffDutyRecord[]>(OFF_DUTY_KEY, []));
    setHydrated(true);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadAuthenticatedProfile() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !active) return;

      const { data: profileData } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      const { data: membershipData } = await supabase
        .from("department_memberships")
        .select(
          "department_id,badge_number,rank_title,unit_name",
        )
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      const profile = profileData as ProfileRow | null;
      const membership = membershipData as MembershipRow | null;

      let roleRows: MembershipRoleRow[] = [];

      if (membership?.department_id) {
        const { data: roleData } = await supabase
          .from("department_membership_roles")
          .select("role_code")
          .eq("department_id", membership.department_id)
          .eq("user_id", user.id);

        roleRows = (roleData ?? []) as MembershipRoleRow[];
      }

      if (!active) return;

      const metadataName =
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name.trim()
          : "";

      const emailHandle =
        user.email?.split("@")[0]?.trim().toLowerCase() || "";
      const storedProfileName = profile?.full_name?.trim() || "";
      const resolvedName =
        storedProfileName.toLowerCase() === emailHandle
          ? metadataName
          : storedProfileName || metadataName;

      setHomeProfile({
        id: user.id,
        name: resolvedName,
        role: getRoleLabel(roleRows),
        rankTitle: membership?.rank_title?.trim() || "",
        unit: membership?.unit_name?.trim() || "Department",
        badge: membership?.badge_number?.trim() || "",
      });
    }

    void loadAuthenticatedProfile();

    return () => {
      active = false;
    };
  }, []);

  // Prototype localStorage records still use the mock officer IDs.
  // This will change to the authenticated UUID when Range & Training
  // is migrated to Supabase.
  const currentUserId = CURRENT_USER_PROFILE.id;

  const myRosterEntries = useMemo(
    () =>
      workspace.rangeRoster.filter(
        (entry) => entry.officerId === currentUserId,
      ),
    [workspace.rangeRoster, currentUserId],
  );

  const assignedFirearmIds = useMemo(
    () =>
      Array.from(
        new Set(
          myRosterEntries.flatMap(
            (entry) => entry.assignedFirearmIds ?? [],
          ),
        ),
      ),
    [myRosterEntries],
  );

  const upcomingRangeDays = useMemo(() => {
    const assignedRangeIds = new Set(
      myRosterEntries.map((entry) => entry.rangeDayId),
    );

    return workspace.rangeDays
      .filter((rangeDay) => {
        const assignedAsOfficer = assignedRangeIds.has(rangeDay.id);
        const assignedAsInstructor =
          rangeDay.leadInstructorId === currentUserId ||
          rangeDay.instructorIds?.includes(currentUserId);

        return (
          rangeDay.status !== "Archived" &&
          getDateValue(rangeDay.date) >= getTodayValue() &&
          (assignedAsOfficer || assignedAsInstructor)
        );
      })
      .sort((a, b) => getDateValue(a.date) - getDateValue(b.date));
  }, [workspace.rangeDays, myRosterEntries, currentUserId]);

  const myResults = useMemo(
    () =>
      workspace.results.filter(
        (result) => result.officerId === currentUserId,
      ),
    [workspace.results, currentUserId],
  );

  const qualificationResults = useMemo(
    () =>
      myResults
        .filter((result) => {
          const drill = workspace.rangeDayDrills.find(
            (item) => item.id === result.drillId,
          );

          return isQualificationDrill(drill);
        })
        .sort((a, b) => {
          const rangeDayA = workspace.rangeDays.find(
            (item) => item.id === a.rangeDayId,
          );
          const rangeDayB = workspace.rangeDays.find(
            (item) => item.id === b.rangeDayId,
          );

          return (
            getDateValue(rangeDayB?.date) -
            getDateValue(rangeDayA?.date)
          );
        }),
    [
      myResults,
      workspace.rangeDayDrills,
      workspace.rangeDays,
    ],
  );

  const latestDayQualification = qualificationResults.find(
    (result) => result.runNumber === 1,
  );
  const latestNightQualification = qualificationResults.find(
    (result) => result.runNumber === 2,
  );

  const failedOrRemedialResults = myResults.filter(
    (result) =>
      result.passed === false ||
      result.deficiencyObserved ||
      result.remedialTrainingRecommended,
  );

  const myMalfunctions = workspace.malfunctions.filter(
    (malfunction) =>
      malfunction.officerId === currentUserId ||
      assignedFirearmIds.includes(malfunction.firearmId),
  );

  const myOffDutyRecords = offDutyRecords.filter(
    (record) => record.officerId === currentUserId,
  );

  const relevantStoredInbox = storedInbox.filter((item) => {
    if (item.status !== "Open") return false;

    if (
      item.audience === "Chief" &&
      userHasPermission("review_off_duty_requests")
    ) {
      return true;
    }

    return (
      item.audience === "Officer" &&
      item.officerId === currentUserId
    );
  });

  const homeItems = useMemo(() => {
    const items: HomeItem[] = [];

    for (const item of relevantStoredInbox) {
      items.push({
        id: `stored-${item.id}`,
        title: item.title,
        detail: item.message,
        href: "/off-duty-firearms",
        priority:
          item.audience === "Chief" ? "High" : "Normal",
        source: "Off-Duty",
        createdAt: item.createdAt,
      });
    }

    for (const rangeDay of upcomingRangeDays.slice(0, 5)) {
      const rosterEntry = workspace.rangeRoster.find(
        (entry) =>
          entry.rangeDayId === rangeDay.id &&
          entry.officerId === currentUserId,
      );

      const isInstructor =
        rangeDay.leadInstructorId === currentUserId ||
        rangeDay.instructorIds?.includes(currentUserId);

      items.push({
        id: `range-${rangeDay.id}`,
        title: isInstructor
          ? "Instructor Range Assignment"
          : "Upcoming Range Assignment",
        detail: `${rangeDay.title} · ${formatDate(
          rangeDay.date,
        )} · ${
          rosterEntry?.attended
            ? "Attendance recorded"
            : rangeDay.location
        }`,
        href: "/range-days",
        priority: "Normal",
        source: "Range",
        createdAt: rangeDay.date,
      });
    }

    if (!latestDayQualification) {
      items.push({
        id: "qual-day-missing",
        title: "Day Qualification Record Missing",
        detail:
          "No day qualification result is recorded for your account.",
        href: "/qualifications",
        priority: "High",
        source: "Qualifications",
      });
    }

    if (!latestNightQualification) {
      items.push({
        id: "qual-night-missing",
        title: "Night Qualification Record Missing",
        detail:
          "No night qualification result is recorded for your account.",
        href: "/qualifications",
        priority: "High",
        source: "Qualifications",
      });
    }

    if (failedOrRemedialResults.length > 0) {
      items.push({
        id: "qual-remedial",
        title: "Training Follow-Up Required",
        detail: `${failedOrRemedialResults.length} failed, deficient, or remedial result${
          failedOrRemedialResults.length === 1 ? "" : "s"
        } require review.`,
        href: "/qualifications",
        priority: "Critical",
        source: "Qualifications",
      });
    }

    if (myMalfunctions.length > 0) {
      items.push({
        id: "firearm-malfunction",
        title: "Firearm Review Required",
        detail: `${myMalfunctions.length} malfunction record${
          myMalfunctions.length === 1 ? "" : "s"
        } are linked to you or an assigned firearm.`,
        href: "/firearms",
        priority: "Critical",
        source: "Firearms",
      });
    }

    for (const record of myOffDutyRecords) {
      if (
        record.requestStatus === "Returned for Correction" ||
        record.requestStatus === "Denied"
      ) {
        items.push({
          id: `off-duty-action-${record.id}`,
          title:
            record.requestStatus === "Returned for Correction"
              ? "Off-Duty Request Needs Correction"
              : "Off-Duty Request Denied",
          detail: `${record.make} ${record.model} · ${
            record.decisionNotes ?? record.requestStatus
          }`,
          href: "/off-duty-firearms",
          priority:
            record.requestStatus === "Denied"
              ? "Critical"
              : "High",
          source: "Off-Duty",
        });
      }
    }

    const priorityWeight = {
      Critical: 0,
      High: 1,
      Normal: 2,
    };

    return items.sort((a, b) => {
      const priorityDifference =
        priorityWeight[a.priority] -
        priorityWeight[b.priority];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return (
        getDateValue(b.createdAt) -
        getDateValue(a.createdAt)
      );
    });
  }, [
    relevantStoredInbox,
    upcomingRangeDays,
    workspace.rangeRoster,
    currentUserId,
    latestDayQualification,
    latestNightQualification,
    failedOrRemedialResults.length,
    myMalfunctions.length,
    myOffDutyRecords,
  ]);

  const qualificationLabel =
    latestDayQualification && latestNightQualification
      ? "Day + Night"
      : latestDayQualification
        ? "Day only"
        : latestNightQualification
          ? "Night only"
          : "No record";

  const primaryFirearmId = assignedFirearmIds[0];
  const greetingName = getProfessionalGreeting(homeProfile);

  const profileDetails = [
    homeProfile.role,
    homeProfile.rankTitle,
    homeProfile.unit,
    homeProfile.badge ? `Badge ${homeProfile.badge}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <TracePointShell activePage="My Home">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                My TracePoint
              </p>
              <h1 className="mt-1 text-[22px] font-bold text-white">
                {greetingName
                  ? `Welcome, ${greetingName}`
                  : "Welcome to TracePoint"}
              </h1>
              <p className="mt-1 text-[12px] text-slate-500">
                {profileDetails || "Authenticated department member"}
              </p>
            </div>

            {userHasPermission("view_command_dashboard") && (
              <Link
                href="/command-dashboard"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-[12px] font-semibold text-blue-200 hover:bg-blue-500/20"
              >
                <Shield size={14} />
                Open Command Dashboard
              </Link>
            )}
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <SnapshotCard
            label="My Inbox"
            value={homeItems.length}
            detail="Open notifications and duties"
            href="#my-inbox"
            icon={<Inbox size={16} className="text-blue-400" />}
          />

          <SnapshotCard
            label="Upcoming Range"
            value={upcomingRangeDays.length}
            detail={
              upcomingRangeDays[0]
                ? `${formatDate(upcomingRangeDays[0].date)} · ${
                    upcomingRangeDays[0].title
                  }`
                : "No upcoming assignment"
            }
            href="/range-days"
            icon={
              <CalendarDays
                size={16}
                className="text-blue-400"
              />
            }
          />

          <SnapshotCard
            label="Qualification"
            value={qualificationLabel}
            detail={
              latestDayQualification || latestNightQualification
                ? "Current recorded coverage"
                : "Qualification action needed"
            }
            href="/qualifications"
            icon={
              latestDayQualification &&
              latestNightQualification ? (
                <CheckCircle2
                  size={16}
                  className="text-emerald-400"
                />
              ) : (
                <Target
                  size={16}
                  className="text-amber-300"
                />
              )
            }
          />

          <SnapshotCard
            label="Assigned Firearm"
            value={
              primaryFirearmId
                ? getFirearmLabel(primaryFirearmId).split(" · ")[0]
                : "None"
            }
            detail={
              primaryFirearmId
                ? getFirearmLabel(primaryFirearmId).split(" · ")[1] ??
                  "Assigned"
                : "No firearm found in saved roster"
            }
            href="/firearms"
            icon={
              <Crosshair
                size={16}
                className="text-blue-400"
              />
            }
          />
        </section>

        <section
          id="my-inbox"
          className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5"
        >
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[17px] font-bold text-white">
                <Inbox size={18} className="text-blue-400" />
                My Inbox
              </h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Pending items assigned to the logged-in user across
                TracePoint.
              </p>
            </div>

            <span className="rounded-full border border-slate-700 bg-slate-950/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {homeItems.length} open
            </span>
          </div>

          {!hydrated ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-10 text-center text-[12px] text-slate-600">
              Loading your TracePoint workspace...
            </div>
          ) : homeItems.length === 0 ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-10 text-center">
              <CheckCircle2
                size={24}
                className="mx-auto text-emerald-400"
              />
              <p className="mt-3 text-[13px] font-semibold text-emerald-200">
                You are all caught up.
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                No open notifications or assigned duties were found.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {homeItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 transition hover:border-blue-500/40 ${getPriorityClass(
                    item.priority,
                  )}`}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex-shrink-0">
                      {getPriorityIcon(item.priority)}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-white">
                          {item.title}
                        </p>
                        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                          {item.source}
                        </span>
                      </div>

                      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                        {item.detail}
                      </p>
                    </div>
                  </div>

                  <ChevronRight
                    size={16}
                    className="mt-1 flex-shrink-0 text-slate-600"
                  />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <Link
            href="/range-days"
            className="rounded-3xl border border-slate-800 bg-slate-900 p-4 transition hover:border-blue-500/40"
          >
            <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
              <CalendarDays
                size={15}
                className="text-blue-400"
              />
              My Range Assignments
            </h3>

            <div className="mt-3 space-y-2">
              {upcomingRangeDays.slice(0, 3).map((rangeDay) => (
                <div
                  key={rangeDay.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2"
                >
                  <p className="text-[12px] font-semibold text-slate-200">
                    {rangeDay.title}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {formatDate(rangeDay.date)} ·{" "}
                    {rangeDay.location}
                  </p>
                </div>
              ))}

              {upcomingRangeDays.length === 0 && (
                <p className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-5 text-center text-[11px] text-slate-600">
                  No upcoming range assignments.
                </p>
              )}
            </div>
          </Link>

          <Link
            href="/qualifications"
            className="rounded-3xl border border-slate-800 bg-slate-900 p-4 transition hover:border-blue-500/40"
          >
            <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
              <ClipboardCheck
                size={15}
                className="text-blue-400"
              />
              My Qualification Status
            </h3>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3">
                <Sun
                  size={14}
                  className={
                    latestDayQualification
                      ? "text-emerald-400"
                      : "text-amber-300"
                  }
                />
                <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-600">
                  Day
                </p>
                <p className="mt-1 text-[12px] font-semibold text-white">
                  {latestDayQualification
                    ? latestDayQualification.passed === false
                      ? "Failed"
                      : "Recorded"
                    : "Missing"}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3">
                <Moon
                  size={14}
                  className={
                    latestNightQualification
                      ? "text-emerald-400"
                      : "text-amber-300"
                  }
                />
                <p className="mt-2 text-[10px] uppercase tracking-widest text-slate-600">
                  Night
                </p>
                <p className="mt-1 text-[12px] font-semibold text-white">
                  {latestNightQualification
                    ? latestNightQualification.passed === false
                      ? "Failed"
                      : "Recorded"
                    : "Missing"}
                </p>
              </div>
            </div>
          </Link>

          <Link
            href="/firearms"
            className="rounded-3xl border border-slate-800 bg-slate-900 p-4 transition hover:border-blue-500/40"
          >
            <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
              <Crosshair
                size={15}
                className="text-blue-400"
              />
              My Firearm Status
            </h3>

            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-3">
              <p className="text-[12px] font-semibold text-white">
                {getFirearmLabel(primaryFirearmId)}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                {myMalfunctions.length > 0
                  ? `${myMalfunctions.length} linked malfunction record${
                      myMalfunctions.length === 1 ? "" : "s"
                    }`
                  : "No linked malfunction alerts"}
              </p>

              <div className="mt-3 flex items-center gap-2 text-[11px]">
                {myMalfunctions.length > 0 ? (
                  <>
                    <Wrench
                      size={13}
                      className="text-red-300"
                    />
                    <span className="text-red-300">
                      Review required
                    </span>
                  </>
                ) : (
                  <>
                    <UserCheck
                      size={13}
                      className="text-emerald-400"
                    />
                    <span className="text-emerald-300">
                      No immediate action
                    </span>
                  </>
                )}
              </div>
            </div>
          </Link>
        </section>
      </div>
    </TracePointShell>
  );
}
