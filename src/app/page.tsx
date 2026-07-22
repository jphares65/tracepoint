"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileCheck2,
  Inbox,
  Loader2,
  RefreshCw,
  Shield,
  ShieldAlert,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import { createClient } from "@/lib/supabase/client";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type Priority = "Critical" | "High" | "Normal";

type NotificationItem = {
  id: string;
  notificationKey: string;
  title: string;
  detail: string;
  href: string;
  priority: Priority;
  source: string;
  kind: string;
  createdAt?: string | null;
  acknowledgedAt?: string | null;
  snoozedUntil?: string | null;
};

type NotificationPayload = {
  items: NotificationItem[];
  allOpenItems: NotificationItem[];
  sourceErrors?: Array<{ source: string; error: string }>;
  counts: {
    open: number;
    critical: number;
    high: number;
    normal: number;
    acknowledged: number;
    snoozed: number;
  };
  generatedAt?: string;
};

type HomeProfile = {
  name: string;
  rankTitle: string;
  role: string;
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

const SOURCE_ORDER = [
  "Personal Rifle",
  "Ammunition",
  "Inspection",
  "Range",
  "Off-Duty",
  "Qualifications",
  "System",
];

function getRoleLabel(rows: MembershipRoleRow[]) {
  const roleCode = ROLE_PRIORITY.find((code) =>
    rows.some((row) => row.role_code === code),
  );

  return roleCode ? ROLE_LABELS[roleCode] : "Member";
}

function professionalGreeting(profile: HomeProfile) {
  const parts = profile.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];

  const rank = profile.rankTitle.trim();
  const rankLabel = RANK_ABBREVIATIONS[rank] || rank;
  return rankLabel ? `${rankLabel} ${parts[parts.length - 1]}` : parts[0];
}

function formatDate(value?: string | null) {
  if (!value) return "Current";

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

function priorityCard(priority: Priority) {
  if (priority === "Critical") {
    return "border-red-500/40 bg-red-500/[0.08]";
  }
  if (priority === "High") {
    return "border-amber-500/35 bg-amber-500/[0.07]";
  }
  return "border-slate-800 bg-slate-950/45";
}

function PriorityIcon({ priority }: { priority: Priority }) {
  if (priority === "Critical") {
    return <ShieldAlert size={17} className="text-red-300" />;
  }
  if (priority === "High") {
    return <AlertTriangle size={17} className="text-amber-300" />;
  }
  return <Bell size={17} className="text-blue-300" />;
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
      className="group rounded-2xl border border-slate-800 bg-slate-900/75 p-3 transition hover:border-blue-500/40 hover:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          {label}
        </p>
        {icon}
      </div>
      <p className="mt-1.5 text-xl font-bold text-white">{value}</p>
      <p className="mt-1 min-h-7 text-[10px] leading-4 text-slate-500">
        {detail}
      </p>
      <div className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-blue-300">
        Open
        <ChevronRight
          size={13}
          className="transition group-hover:translate-x-0.5"
        />
      </div>
    </Link>
  );
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload?.error || "The request could not be completed.";
}

export default function OfficerHomePage() {
  const { hasPermission } = useTracePointAccess();
  const [profile, setProfile] = useState<HomeProfile>({
    name: "",
    rankTitle: "",
    role: "Member",
    unit: "Department",
    badge: "",
  });
  const [notifications, setNotifications] =
    useState<NotificationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadNotifications() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
      });

      if (!response.ok) throw new Error(await responseError(response));
      setNotifications((await response.json()) as NotificationPayload);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Officer Home could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNotifications();
  }, []);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || !active) return;

      const [{ data: profileData }, { data: membershipData }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("full_name")
            .eq("id", user.id)
            .maybeSingle(),
          supabase
            .from("department_memberships")
            .select("department_id,badge_number,rank_title,unit_name")
            .eq("user_id", user.id)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle(),
        ]);

      const profileRow = profileData as ProfileRow | null;
      const membership = membershipData as MembershipRow | null;
      let roleRows: MembershipRoleRow[] = [];

      if (membership?.department_id) {
        const { data } = await supabase
          .from("department_membership_roles")
          .select("role_code")
          .eq("department_id", membership.department_id)
          .eq("user_id", user.id);

        roleRows = (data ?? []) as MembershipRoleRow[];
      }

      if (!active) return;

      const metadataName =
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name.trim()
          : "";
      const storedName = profileRow?.full_name?.trim() || "";
      const emailHandle = user.email?.split("@")[0]?.toLowerCase() || "";
      const resolvedName =
        storedName.toLowerCase() === emailHandle
          ? metadataName
          : storedName || metadataName;

      setProfile({
        name: resolvedName,
        rankTitle: membership?.rank_title?.trim() || "",
        role: getRoleLabel(roleRows),
        unit: membership?.unit_name?.trim() || "Department",
        badge: membership?.badge_number?.trim() || "",
      });
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, []);

  async function updateNotification(
    action: "acknowledge" | "snooze",
    item: NotificationItem,
  ) {
    setSavingId(item.id);
    setError(null);

    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          notificationId: item.id,
          snoozedUntil:
            action === "snooze"
              ? new Date(Date.now() + 86_400_000).toISOString()
              : undefined,
        }),
      });

      if (!response.ok) throw new Error(await responseError(response));
      await loadNotifications();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "The notification could not be updated.",
      );
    } finally {
      setSavingId(null);
    }
  }

  const items = notifications?.items ?? [];

  const approvalItems = useMemo(
    () =>
      items.filter((item) =>
        /(review|approval|certif|decision)/i.test(
          `${item.kind} ${item.title}`,
        ),
      ),
    [items],
  );

  const rangeItems = useMemo(
    () => items.filter((item) => item.source === "Range"),
    [items],
  );

  const expiringItems = useMemo(
    () =>
      items.filter((item) =>
        /(expir|due|reorder|required|missing)/i.test(
          `${item.kind} ${item.title}`,
        ),
      ),
    [items],
  );

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const queue = items.slice(0, 8);
  const greeting = professionalGreeting(profile);
  const profileLine = [
    profile.role,
    profile.rankTitle,
    profile.unit,
    profile.badge ? `Badge ${profile.badge}` : "",
  ]
    .filter(Boolean)
    .join(" · ");


  return (
    <TracePointShell activePage="My Home">
      <div className="mx-auto w-full max-w-[1600px] space-y-4">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blue-400">
                My TracePoint
              </p>
              <h1 className="mt-1 text-xl font-bold text-white">
                {greeting ? `Welcome, ${greeting}` : "Officer Home"}
              </h1>
              <p className="mt-0.5 text-[10px] text-slate-500">
                {profileLine || "Authenticated department member"}
              </p>
              <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-400">
                Your assignments, approvals, expiring items, and operational exceptions are consolidated here.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {hasPermission("view_command_dashboard") ? (
                <Link
                  href="/command-dashboard"
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-200"
                >
                  <Shield size={15} />
                  Command Dashboard
                </Link>
              ) : null}

              <button
                type="button"
                onClick={() => void loadNotifications()}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <RefreshCw
                  size={15}
                  className={loading ? "animate-spin" : ""}
                />
                Refresh
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-red-700 bg-red-950/30 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {notifications?.sourceErrors?.length ? (
          <div className="rounded-2xl border border-amber-700 bg-amber-950/25 p-4 text-sm text-amber-200">
            Some sources were unavailable: {notifications.sourceErrors
              .map((item) => item.source)
              .join(", ")}.
          </div>
        ) : null}

        <section className="grid grid-cols-2 gap-2.5 xl:grid-cols-5">
          <SnapshotCard
            label="Open Actions"
            value={notifications?.counts.open ?? 0}
            detail="Current items requiring attention"
            href="/notifications"
            icon={<Inbox size={17} className="text-blue-300" />}
          />
          <SnapshotCard
            label="Critical / High"
            value={
              (notifications?.counts.critical ?? 0) +
              (notifications?.counts.high ?? 0)
            }
            detail={`${notifications?.counts.critical ?? 0} critical · ${notifications?.counts.high ?? 0} high`}
            href="/notifications"
            icon={<ShieldAlert size={17} className="text-red-300" />}
          />
          <SnapshotCard
            label="Approvals"
            value={approvalItems.length}
            detail="Reviews, decisions, and certifications"
            href="/notifications"
            icon={<FileCheck2 size={17} className="text-violet-300" />}
          />
          <SnapshotCard
            label="Upcoming Range"
            value={rangeItems.length}
            detail={rangeItems[0]?.detail || "No current range assignment"}
            href="/range-days"
            icon={<CalendarDays size={17} className="text-blue-300" />}
          />
          <SnapshotCard
            label="Due / Expiring"
            value={expiringItems.length}
            detail="Deadlines, shortages, and renewals"
            href="/notifications"
            icon={<Clock3 size={17} className="text-amber-300" />}
          />
        </section>


        <section>
          <div id="my-inbox" className="rounded-2xl border border-slate-800 bg-slate-900/70">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3.5">
              <div>
                <h2 className="text-[15px] font-bold text-white">Priority Action Queue</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Highest-priority work across every TracePoint module
                </p>
              </div>
              <Link
                href="/notifications"
                className="inline-flex items-center gap-2 text-xs font-semibold text-blue-300"
              >
                View all
                <ExternalLink size={13} />
              </Link>
            </div>

            {loading ? (
              <div className="flex min-h-[280px] items-center justify-center">
                <Loader2 size={28} className="animate-spin text-blue-300" />
              </div>
            ) : queue.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center p-6 text-center">
                <CheckCircle2 size={32} className="text-emerald-400" />
                <h3 className="mt-3 font-bold text-white">You are current</h3>
                <p className="mt-1 max-w-md text-xs text-slate-500">
                  No open operational notifications are assigned to you.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 p-3">
                {queue.map((item) => (
                  <article
                    key={item.id}
                    className={`rounded-xl border p-3 ${priorityCard(item.priority)}`}
                  >
                    <div className="flex items-start gap-3">
                      <PriorityIcon priority={item.priority} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[13px] font-semibold text-white">
                            {item.title}
                          </h3>
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                            {item.source}
                          </span>
                          <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                            {item.priority}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-5 text-slate-400">
                          {item.detail}
                        </p>
                        <p className="mt-1.5 text-[9px] text-slate-600">
                          {formatDate(item.createdAt)}
                        </p>

                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Link
                            href={item.href}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                          >
                            Open
                            <ChevronRight size={13} />
                          </Link>
                          <button
                            type="button"
                            onClick={() =>
                              void updateNotification("acknowledge", item)
                            }
                            disabled={savingId === item.id}
                            className="inline-flex items-center gap-2 rounded-lg border border-emerald-700 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 disabled:opacity-50"
                          >
                            <Check size={13} />
                            Acknowledge
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateNotification("snooze", item)}
                            disabled={savingId === item.id}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 disabled:opacity-50"
                          >
                            <Clock3 size={13} />
                            Snooze 1 Day
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

        </section>
      </div>
    </TracePointShell>
  );
}
