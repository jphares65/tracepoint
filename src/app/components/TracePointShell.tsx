"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  BellRing,
  CalendarRange,
  ClipboardList,
  Crosshair,
  House,
  LogOut,
  Menu,
  Settings,
  Shield,
  ShieldCheck,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import {
  applyAppearanceToDocument,
  buildAppearancePreferences,
  getStoredAppearancePreferences,
  TRACEPOINT_APPEARANCE_EVENT,
  type TracePointAppearancePreferences,
} from "@/lib/tracepoint/appearance";

import {
  meetsPermissionRequirement,
  type PermissionRequirement,
  type TracePointPermission,
} from "@/lib/tracepoint/permissions";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type TracePointShellProps = {
  activePage: string;
  children: ReactNode;
};

type NavigationItem = {
  label: string;
  href: string;
  icon: typeof House;
  requirement?: PermissionRequirement;
};

type DepartmentAppearanceRow = {
  accent_color?: string | null;
  login_theme?: string | null;
};

const NAV_ITEMS: NavigationItem[] = [
  { label: "My Home", href: "/", icon: House },
  {
    label: "Command Dashboard",
    href: "/command-dashboard",
    icon: Activity,
    requirement: { anyOf: ["view_command_dashboard"] },
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    requirement: { anyOf: ["view_analytics"] },
  },
  {
    label: "Training Alerts",
    href: "/training-alerts",
    icon: BellRing,
    requirement: {
      anyOf: [
        "view_analytics",
        "manage_qualifications",
        "score_range_days",
        "view_command_dashboard",
      ],
    },
  },
  {
    label: "Armory",
    href: "/firearms",
    icon: Crosshair,
    requirement: {
      anyOf: [
        "manage_firearms",
        "manage_inspections",
        "view_command_dashboard",
      ],
    },
  },
  {
    label: "Off-Duty Firearms",
    href: "/off-duty-firearms",
    icon: Shield,
    requirement: {
      anyOf: [
        "submit_off_duty_requests",
        "review_off_duty_requests",
      ],
    },
  },
  {
    label: "Qualification History",
    href: "/qualifications",
    icon: ShieldCheck,
    requirement: {
      anyOf: [
        "manage_qualifications",
        "score_range_days",
        "view_analytics",
      ],
    },
  },
  {
    label: "Range & Training",
    href: "/range-days",
    icon: CalendarRange,
    requirement: {
      anyOf: [
        "manage_range_days",
        "score_range_days",
        "view_command_dashboard",
      ],
    },
  },
  {
    label: "Inspections",
    href: "/inspections",
    icon: ClipboardList,
    requirement: {
      anyOf: [
        "manage_inspections",
        "manage_firearms",
        "view_command_dashboard",
      ],
    },
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    requirement: {
      anyOf: ["manage_users", "administer_department"],
    },
  },
];

function getNavItems(permissions: TracePointPermission[]) {
  return NAV_ITEMS.filter((item) =>
    meetsPermissionRequirement(permissions, item.requirement),
  );
}

function isActivePage(activePage: string, itemLabel: string) {
  return (
    activePage === itemLabel ||
    (activePage === "Dashboard" &&
      itemLabel === "Command Dashboard") ||
    ((activePage === "Firearms Repository" ||
      activePage === "Firearms" ||
      activePage === "Armory") &&
      itemLabel === "Armory") ||
    (activePage === "Off-Duty" &&
      itemLabel === "Off-Duty Firearms") ||
    (activePage === "Training Alerts" &&
      itemLabel === "Training Alerts") ||
    ((activePage === "Qualifications" ||
      activePage === "Qualification History") &&
      itemLabel === "Qualification History") ||
    (activePage === "Range Days" &&
      itemLabel === "Range & Training")
  );
}

function isActiveRoute(pathname: string, href: string) {
  const normalizedPath = pathname.toLowerCase();
  const normalizedHref = href.toLowerCase();

  if (normalizedHref === "/") return normalizedPath === "/";

  return (
    normalizedPath === normalizedHref ||
    normalizedPath.startsWith(`${normalizedHref}/`)
  );
}

function NavigationLinks({
  activePage,
  pathname,
  permissions,
  onNavigate,
}: {
  activePage: string;
  pathname: string;
  permissions: TracePointPermission[];
  onNavigate?: () => void;
}) {
  const navItems = getNavItems(permissions);

  return (
    <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-5">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-600">
        Navigation
      </p>

      {navItems.map((item) => {
        const Icon = item.icon;
        const active =
          isActivePage(activePage, item.label) ||
          isActiveRoute(pathname, item.href);

        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] transition-all duration-200 ${
              active
                ? "bg-blue-600/20 text-blue-200"
                : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-200"
            }`}
          >
            {active && (
              <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-blue-500" />
            )}

            <Icon
              size={17}
              className={
                active
                  ? "text-blue-400"
                  : "text-slate-600 group-hover:text-slate-400"
              }
            />

            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AgencyCard({
  departmentName,
  departmentPatchUrl,
  roleLabel,
  loading,
}: {
  departmentName: string;
  departmentPatchUrl: string;
  roleLabel: string;
  loading: boolean;
}) {
  return (
    <div className="border-t border-slate-800 p-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            title="Open department branding settings"
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 transition hover:border-blue-500/50"
          >
            {departmentPatchUrl ? (
              <img
                src={departmentPatchUrl}
                alt={`${departmentName} patch`}
                className="h-full w-full object-contain p-1"
              />
            ) : (
              <Shield
                size={20}
                className="text-slate-500"
                aria-hidden="true"
              />
            )}
          </Link>

          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-slate-100">
              {departmentName}
            </p>

            <p className="text-[11px] text-slate-500">
              {loading ? "Verifying access..." : roleLabel}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span
              className={`h-2 w-2 rounded-full ${
                loading ? "bg-amber-400" : "bg-emerald-500"
              }`}
            />
            {loading ? "Loading permissions" : "Access verified"}
          </div>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              title="Sign out of TracePoint"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-900 hover:text-red-300"
            >
              <LogOut size={13} />
              Logout
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AppearanceStyleOverrides() {
  return (
    <style>{`
      .tracepoint-accent-indigo [class*="text-blue-"] { color: rgb(129 140 248) !important; }
      .tracepoint-accent-indigo [class*="bg-blue-600"] { background-color: rgb(79 70 229) !important; }
      .tracepoint-accent-indigo [class*="bg-blue-500"] { background-color: rgb(99 102 241) !important; }
      .tracepoint-accent-indigo [class*="bg-blue-500/"] { background-color: rgb(99 102 241 / 0.14) !important; }
      .tracepoint-accent-indigo [class*="bg-blue-600/"] { background-color: rgb(79 70 229 / 0.20) !important; }
      .tracepoint-accent-indigo [class*="border-blue-"] { border-color: rgb(129 140 248 / 0.45) !important; }
      .tracepoint-accent-indigo [class*="ring-blue-"] { --tw-ring-color: rgb(129 140 248 / 0.16) !important; }

      .tracepoint-accent-emerald [class*="text-blue-"] { color: rgb(52 211 153) !important; }
      .tracepoint-accent-emerald [class*="bg-blue-600"] { background-color: rgb(5 150 105) !important; }
      .tracepoint-accent-emerald [class*="bg-blue-500"] { background-color: rgb(16 185 129) !important; }
      .tracepoint-accent-emerald [class*="bg-blue-500/"] { background-color: rgb(16 185 129 / 0.14) !important; }
      .tracepoint-accent-emerald [class*="bg-blue-600/"] { background-color: rgb(5 150 105 / 0.20) !important; }
      .tracepoint-accent-emerald [class*="border-blue-"] { border-color: rgb(52 211 153 / 0.45) !important; }
      .tracepoint-accent-emerald [class*="ring-blue-"] { --tw-ring-color: rgb(52 211 153 / 0.16) !important; }

      .tracepoint-accent-slate [class*="text-blue-"] { color: rgb(203 213 225) !important; }
      .tracepoint-accent-slate [class*="bg-blue-600"] { background-color: rgb(71 85 105) !important; }
      .tracepoint-accent-slate [class*="bg-blue-500"] { background-color: rgb(100 116 139) !important; }
      .tracepoint-accent-slate [class*="bg-blue-500/"] { background-color: rgb(100 116 139 / 0.14) !important; }
      .tracepoint-accent-slate [class*="bg-blue-600/"] { background-color: rgb(71 85 105 / 0.20) !important; }
      .tracepoint-accent-slate [class*="border-blue-"] { border-color: rgb(148 163 184 / 0.45) !important; }
      .tracepoint-accent-slate [class*="ring-blue-"] { --tw-ring-color: rgb(148 163 184 / 0.16) !important; }

      .tracepoint-brightness-balanced [class*="bg-slate-950"] { background-color: rgb(15 23 42 / var(--tw-bg-opacity, 1)) !important; }
      .tracepoint-brightness-balanced [class*="bg-slate-900"] { background-color: rgb(30 41 59 / var(--tw-bg-opacity, 1)) !important; }
      .tracepoint-brightness-balanced [class*="bg-slate-800"] { background-color: rgb(51 65 85 / var(--tw-bg-opacity, 1)) !important; }
      .tracepoint-brightness-balanced [class*="text-slate-600"] { color: rgb(148 163 184) !important; }
      .tracepoint-brightness-balanced [class*="text-slate-500"] { color: rgb(148 163 184) !important; }

      .tracepoint-brightness-high-contrast [class*="bg-slate-950"] { background-color: rgb(2 6 23 / var(--tw-bg-opacity, 1)) !important; }
      .tracepoint-brightness-high-contrast [class*="bg-slate-900"] { background-color: rgb(15 23 42 / var(--tw-bg-opacity, 1)) !important; }
      .tracepoint-brightness-high-contrast [class*="border-slate-800"] { border-color: rgb(71 85 105) !important; }
      .tracepoint-brightness-high-contrast [class*="text-slate-500"] { color: rgb(148 163 184) !important; }
      .tracepoint-brightness-high-contrast [class*="text-slate-400"] { color: rgb(203 213 225) !important; }
    `}</style>
  );
}

function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="block min-w-0">
      <Image
        src="/tracepoint-logo-dark.png"
        alt="TracePoint"
        width={compact ? 155 : 205}
        height={compact ? 38 : 50}
        priority
        className={`h-auto object-contain ${
          compact ? "w-[150px] sm:w-[160px]" : "w-[205px]"
        }`}
      />
    </Link>
  );
}

export default function TracePointShell({
  activePage,
  children,
}: TracePointShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [appearance, setAppearance] =
    useState<TracePointAppearancePreferences>(
      getStoredAppearancePreferences,
    );

  const {
    loading,
    departmentId,
    departmentShortName,
    departmentPatchUrl,
    primaryRoleLabel,
    permissions,
  } = useTracePointAccess();

  useEffect(() => {
    applyAppearanceToDocument(appearance);
  }, [appearance]);

  useEffect(() => {
    function handleAppearanceUpdated(event: Event) {
      const next =
        (event as CustomEvent<TracePointAppearancePreferences>).detail ??
        getStoredAppearancePreferences();

      setAppearance(next);
      applyAppearanceToDocument(next);
    }

    window.addEventListener(
      TRACEPOINT_APPEARANCE_EVENT,
      handleAppearanceUpdated,
    );

    return () => {
      window.removeEventListener(
        TRACEPOINT_APPEARANCE_EVENT,
        handleAppearanceUpdated,
      );
    };
  }, []);

  useEffect(() => {
    if (!departmentId) return;

    let active = true;

    async function loadDepartmentAppearance() {
      const supabase = createClient();

      const { data } = await supabase
        .from("departments")
        .select("accent_color,login_theme")
        .eq("id", departmentId)
        .maybeSingle();

      if (!active || !data) return;

      const departmentAppearance =
        data as DepartmentAppearanceRow | null;

      const next = buildAppearancePreferences(
        departmentAppearance?.accent_color,
        departmentAppearance?.login_theme,
      );

      setAppearance(next);
      applyAppearanceToDocument(next);
      window.localStorage.setItem(
        "tracepoint.appearance.v1",
        JSON.stringify(next),
      );
    }

    void loadDepartmentAppearance();

    return () => {
      active = false;
    };
  }, [departmentId]);

  return (
    <div
      className={`tracepoint-app tracepoint-accent-${appearance.accentColor} tracepoint-brightness-${appearance.brightness} min-h-screen bg-slate-950 text-white`}
    >
      <AppearanceStyleOverrides />
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-800 bg-slate-950 lg:flex lg:flex-col">
          <div className="border-b border-slate-800 px-5 py-3.5">
            <BrandHeader />
          </div>

          <NavigationLinks
            activePage={activePage}
            pathname={pathname}
            permissions={permissions}
          />

          <AgencyCard
            departmentName={departmentShortName || "TracePoint"}
            departmentPatchUrl={departmentPatchUrl}
            roleLabel={primaryRoleLabel}
            loading={loading}
          />
        </aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation backdrop"
              onClick={() => setMobileOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            <aside className="absolute inset-y-0 left-0 flex w-[86vw] max-w-[340px] flex-col border-r border-slate-800 bg-slate-950 shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3.5">
                <BrandHeader compact />

                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setMobileOpen(false)}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 transition hover:border-blue-500/40 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <NavigationLinks
                activePage={activePage}
                pathname={pathname}
                permissions={permissions}
                onNavigate={() => setMobileOpen(false)}
              />

              <AgencyCard
                departmentName={departmentShortName || "TracePoint"}
                departmentPatchUrl={departmentPatchUrl}
                roleLabel={primaryRoleLabel}
                loading={loading}
              />
            </aside>
          </div>
        )}

        <main className="min-h-screen min-w-0 flex-1 lg:pl-72">
          <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur lg:hidden">
            <BrandHeader compact />

            <button
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
              className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:border-blue-500/40 hover:text-white"
            >
              <Menu size={20} />
            </button>
          </header>

          <div className="w-full px-3 py-4 sm:px-5 sm:py-5 lg:px-6 xl:px-8 2xl:px-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
