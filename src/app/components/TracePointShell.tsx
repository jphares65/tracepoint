"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  BarChart3,
  Boxes,
  BellRing,
  CalendarRange,
  ChevronDown,
  CircleHelp,
  Crosshair,
  House,
  LogOut,
  Menu,
  Settings,
  Shield,
  ShieldCheck,
  GraduationCap,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import IdleSessionGuard from "@/app/components/IdleSessionGuard";
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
  accessEnabled?: boolean;
};

type NavigationLeaf = {
  label: string;
  href: string;
  icon?: typeof House;
  requirement?: PermissionRequirement;
  featureCode?: string;
};

type NavigationGroup = {
  label: string;
  icon: typeof House;
  requirement?: PermissionRequirement;
  children: readonly NavigationLeaf[];
};

type NavigationEntry = NavigationLeaf | NavigationGroup;

type DepartmentAppearanceRow = {
  accent_color?: string | null;
  login_theme?: string | null;
};

const NAV_ITEMS: readonly NavigationEntry[] = [
  { label: "My Home", href: "/", icon: House },
  {
    label: "Command",
    icon: Activity,
    children: [
      {
        label: "Command Dashboard",
        href: "/command-dashboard",
        featureCode: "command_dashboard",
        icon: Activity,
        requirement: { anyOf: ["view_command_dashboard"] },
      },
      {
        label: "Analytics",
        href: "/analytics",
        featureCode: "analytics",
        icon: BarChart3,
        requirement: { anyOf: ["view_analytics"] },
      },
    ],
  },
  {
    label: "Armory",
    icon: Crosshair,
    requirement: {
      anyOf: [
        "manage_firearms",
        "manage_inspections",
        "view_command_dashboard",
      ],
    },
    children: [
      {
        label: "Department Firearms",
        href: "/firearms",
        featureCode: "firearms",
        icon: Crosshair,
      },
      {
        label: "Personally Owned Rifles",
        href: "/firearms/personal-rifles",
        featureCode: "firearms",
        icon: ShieldCheck,
      },
      {
        label: "Maintenance & Inspections",
        href: "/firearms/inspections",
        featureCode: "firearms",
        icon: ShieldCheck,
        requirement: {
          anyOf: [
            "manage_inspections",
            "manage_firearms",
            "view_command_dashboard",
          ],
        },
      },
      {
        label: "Ammunition",
        href: "/firearms/ammunition",
        featureCode: "ammunition",
        icon: Crosshair,
        requirement: {
          anyOf: ["manage_firearms", "view_command_dashboard"],
        },
      },
      {
        label: "Reconciliation",
        href: "/firearms/ammunition/reconciliation",
        featureCode: "ammunition",
        icon: ShieldCheck,
        requirement: {
          anyOf: ["manage_firearms", "view_command_dashboard"],
        },
      },
    ],
  },
  {
    label: "Training",
    icon: GraduationCap,
    children: [
      {
        label: "Range Days",
        href: "/range-days",
        featureCode: "range_training",
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
        label: "Agency Training",
        href: "/agency-training",
        featureCode: "range_training",
        icon: GraduationCap,
      },
      {
        label: "Training Alerts",
        href: "/training-alerts",
        featureCode: "range_training",
        icon: BellRing,
      },
    ],
  },
  {
    label: "Readiness",
    icon: ShieldCheck,
    children: [
      {
        label: "Qualifications",
        href: "/qualifications",
        featureCode: "qualifications",
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
        label: "Certifications",
        href: "/training/certifications",
        featureCode: "certifications",
        icon: ShieldCheck,
      },
    ],
  },
  {
    label: "Assets & Fleet",
    icon: Boxes,
    children: [
      {
        label: "Equipment",
        href: "/equipment",
        featureCode: "equipment_readiness",
        icon: Boxes,
      },
      {
        label: "Fleet Management",
        href: "/fleet-management",
        icon: Boxes,
      },
    ],
  },  {
    label: "Off-Duty Firearms",
    icon: Shield,
    requirement: {
      anyOf: ["submit_off_duty_requests", "review_off_duty_requests"],
    },
    children: [
      {
        label: "Requests & Approvals",
        href: "/off-duty-firearms",
        featureCode: "off_duty",
        icon: Shield,
      },
    ],
  },
  {
    label: "Super Admin",
    href: "/super-admin",
    icon: Shield,
  },
  {
    label: "Administration",
    icon: Settings,
    requirement: {
      anyOf: ["manage_users", "administer_department"],
    },
    children: [
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
      },
      {
        label: "Import / Export",
        href: "/settings/import-export",
        icon: BarChart3,
      },
    ],
  },
  { label: "Help Center", href: "/help", icon: CircleHelp },
];

function isNavigationGroup(item: NavigationEntry): item is NavigationGroup {
  return "children" in item;
}

function getVisibleChildren(
  group: NavigationGroup,
  permissions: TracePointPermission[],
  enabledFeatures: Set<string>,
  isSuperAdmin: boolean,
) {
  return group.children.filter((child) => {
    if (
      child.featureCode &&
      !isSuperAdmin &&
      !enabledFeatures.has(child.featureCode)
    ) {
      return false;
    }

    return meetsPermissionRequirement(
      permissions,
      child.requirement,
    );
  });
}

function getNavItems(
  permissions: TracePointPermission[],
  enabledFeatures: Set<string>,
  isSuperAdmin: boolean,
) {
  return NAV_ITEMS.filter((item) => {
    if (
      !isNavigationGroup(item) &&
      item.label === "Super Admin"
    ) {
      return isSuperAdmin;
    }

    if (
      !isNavigationGroup(item) &&
      item.featureCode &&
      !isSuperAdmin &&
      !enabledFeatures.has(item.featureCode)
    ) {
      return false;
    }

    if (
      !meetsPermissionRequirement(
        permissions,
        item.requirement,
      )
    ) {
      return false;
    }

    if (!isNavigationGroup(item)) {
      return true;
    }

    return (
      getVisibleChildren(
        item,
        permissions,
        enabledFeatures,
        isSuperAdmin,
      ).length > 0
    );
  });
}
function isActiveRoute(pathname: string, href: string) {
  const normalizedPath = pathname.toLowerCase();
  const normalizedHref = href.toLowerCase();

  if (normalizedHref === "/") return normalizedPath === "/";

  if (normalizedHref === "/firearms") {
    if (normalizedPath === "/firearms") return true;

    const armoryWorkspacePrefixes = [
      "/firearms/personal-rifles",
      "/firearms/inspections",
      "/firearms/ammunition",
    ];

    if (armoryWorkspacePrefixes.some((prefix) => normalizedPath.startsWith(prefix))) {
      return false;
    }

    return /^\/firearms\/[^/]+$/.test(normalizedPath);
  }

  if (
    normalizedHref === "/training" ||
    normalizedHref === "/settings" ||
    normalizedHref === "/firearms/ammunition"
  ) {
    return normalizedPath === normalizedHref;
  }

  return (
    normalizedPath === normalizedHref ||
    normalizedPath.startsWith(`${normalizedHref}/`)
  );
}

function groupContainsPath(
  pathname: string,
  group: NavigationGroup,
  permissions: TracePointPermission[],
  enabledFeatures: Set<string>,
  isSuperAdmin: boolean,
) {
  return getVisibleChildren(
    group,
    permissions,
    enabledFeatures,
    isSuperAdmin,
  ).some((child) =>
    isActiveRoute(pathname, child.href),
  );
}
function NavigationLinks({
  activePage: _activePage,
  pathname,
  permissions,
  enabledFeatures,
  isSuperAdmin,
  onNavigate,
}: {
  activePage: string;
  pathname: string;
  permissions: TracePointPermission[];
  enabledFeatures: string[];
  isSuperAdmin: boolean;
  onNavigate?: () => void;
}) {
  const enabledFeatureSet = new Set(enabledFeatures);

  const navItems = getNavItems(
    permissions,
    enabledFeatureSet,
    isSuperAdmin,
  );
  const activeGroupLabel = navItems.find(
    (item): item is NavigationGroup =>
      isNavigationGroup(item) && groupContainsPath(
        pathname,
        item,
        permissions,
        enabledFeatureSet,
        isSuperAdmin,
      ),
  )?.label;
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(activeGroupLabel ? [activeGroupLabel] : []),
  );

  useEffect(() => {
    if (!activeGroupLabel) return;

    setOpenGroups((current) => {
      if (current.has(activeGroupLabel)) return current;
      const next = new Set(current);
      next.add(activeGroupLabel);
      return next;
    });
  }, [activeGroupLabel]);

  function toggleGroup(label: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-5">
      <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-600">
        Navigation
      </p>

      <div className="space-y-1.5">
        {navItems.map((item) => {
          if (!isNavigationGroup(item)) {
            const Icon = item.icon ?? House;
            const active = isActiveRoute(pathname, item.href);

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
                <span className="truncate font-medium">{item.label}</span>
              </Link>
            );
          }

          const Icon = item.icon;
          const visibleChildren = getVisibleChildren(
            item,
            permissions,
            enabledFeatureSet,
            isSuperAdmin,
          );
          const active = groupContainsPath(
        pathname,
        item,
        permissions,
        enabledFeatureSet,
        isSuperAdmin,
      );
          const open = openGroups.has(item.label);

          return (
            <div key={item.label} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleGroup(item.label)}
                aria-expanded={open}
                className={`group relative flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-[13px] transition-all duration-200 ${
                  active
                    ? "bg-blue-600/10 text-blue-100"
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
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {item.label}
                </span>
                <ChevronDown
                  size={15}
                  className={`shrink-0 text-slate-600 transition-transform duration-200 ${
                    open ? "rotate-180" : ""
                  }`}
                />
              </button>

              {open && (
                <div className="ml-4 space-y-1 border-l border-slate-800/90 pl-3">
                  {visibleChildren.map((child) => {
                    const ChildIcon = child.icon;
                    const childActive = isActiveRoute(pathname, child.href);

                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        aria-current={childActive ? "page" : undefined}
                        className={`group flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] transition ${
                          childActive
                            ? "bg-blue-500/15 font-semibold text-blue-200"
                            : "text-slate-500 hover:bg-slate-900 hover:text-slate-200"
                        }`}
                      >
                        {ChildIcon ? (
                          <ChildIcon
                            size={14}
                            className={
                              childActive
                                ? "text-blue-400"
                                : "text-slate-700 group-hover:text-slate-500"
                            }
                          />
                        ) : (
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              childActive ? "bg-blue-400" : "bg-slate-700"
                            }`}
                          />
                        )}
                        <span className="truncate">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  accessEnabled = true,
}: TracePointShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switchingDepartmentId, setSwitchingDepartmentId] =
    useState<string | null>(null);
  const [departmentSelectionError, setDepartmentSelectionError] =
    useState<string | null>(null);
  const [appearance, setAppearance] =
    useState<TracePointAppearancePreferences>(
      getStoredAppearancePreferences,
    );

  const {
    loading,
    error: accessError,
    requiresDepartmentSelection,
    availableDepartments,
    departmentId,
    departmentShortName,
    departmentPatchUrl,
    primaryRoleLabel,
    permissions,
    enabledFeatures,
    isSuperAdmin,
    refresh: refreshAccess,
  } = useTracePointAccess({ enabled: accessEnabled });

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

  async function selectDepartment(nextDepartmentId: string) {
    if (!nextDepartmentId || switchingDepartmentId) return;

    setSwitchingDepartmentId(nextDepartmentId);
    setDepartmentSelectionError(null);

    try {
      const response = await fetch("/api/active-department", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          departmentId: nextDepartmentId,
        }),
      });

      if (!response.ok) {
        let message = "Agency could not be selected.";

        try {
          const payload = (await response.json()) as {
            error?: string;
          };

          if (payload.error) {
            message = payload.error;
          }
        } catch {}

        throw new Error(message);
      }

      await refreshAccess();
    } catch (selectionError) {
      setDepartmentSelectionError(
        selectionError instanceof Error
          ? selectionError.message
          : "Agency could not be selected.",
      );
    } finally {
      setSwitchingDepartmentId(null);
    }
  }

  if (requiresDepartmentSelection) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-10 text-white">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 flex justify-center">
            <BrandHeader />
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-400">
              TracePoint
            </div>

            <h1 className="mt-2 text-2xl font-bold text-white">
              Choose Agency
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Your account belongs to more than one agency. Select the agency you want to work in.
            </p>

            {departmentSelectionError ? (
              <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {departmentSelectionError}
              </div>
            ) : null}

            <div className="mt-6 space-y-3">
              {availableDepartments.map((department) => {
                const selecting =
                  switchingDepartmentId === department.departmentId;

                return (
                  <button
                    key={department.departmentId}
                    type="button"
                    disabled={switchingDepartmentId !== null}
                    onClick={() =>
                      void selectDepartment(department.departmentId)
                    }
                    className="flex w-full items-center justify-between gap-4 rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-left transition hover:border-blue-500/60 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-white">
                        {department.departmentName}
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        {[
                          department.rankTitle,
                          department.unitName,
                          department.badgeNumber
                            ? `Badge ${department.badgeNumber}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ? ") || "Active membership"}
                      </div>
                    </div>

                    <div className="shrink-0 text-sm font-semibold text-blue-300">
                      {selecting ? "Opening..." : "Enter"}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!loading && accessError && !departmentId) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-10 text-white">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 flex justify-center">
            <BrandHeader />
          </div>

          <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-6">
            <h1 className="text-lg font-bold text-white">
              TracePoint Access Error
            </h1>

            <p className="mt-2 text-sm text-red-100">
              {accessError}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`tracepoint-app tracepoint-accent-${appearance.accentColor} tracepoint-brightness-${appearance.brightness} min-h-screen bg-slate-950 text-white`}
    >
      <AppearanceStyleOverrides />
      <IdleSessionGuard />
      <div className="flex min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-800 bg-slate-950 lg:flex lg:flex-col">
          <div className="border-b border-slate-800 px-5 py-3.5">
            <BrandHeader />
          </div>

          <NavigationLinks
            activePage={activePage}
            pathname={pathname}
            permissions={permissions}
            enabledFeatures={enabledFeatures}
            isSuperAdmin={isSuperAdmin}
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
                enabledFeatures={enabledFeatures}
                isSuperAdmin={isSuperAdmin}
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
















