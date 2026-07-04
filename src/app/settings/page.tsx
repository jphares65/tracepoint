"use client";

import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  ImagePlus,
  LoaderCircle,
  Lock,
  Mail,
  Palette,
  Pencil,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import TracePointShell from "@/app/components/TracePointShell";
import { createClient } from "@/lib/supabase/client";
import {
  buildAppearancePreferences,
  normalizeAccentColor,
  normalizeBrightness,
  persistAndApplyAppearance,
} from "@/lib/tracepoint/appearance";
import type { TracePointPermission } from "@/lib/tracepoint/permissions";
import { useTracePointAccess } from "@/lib/tracepoint/useTracePointAccess";

type TabId = "agency" | "users" | "rules" | "branding" | "importExport" | "audit";
type NoticeTone = "success" | "error" | "info";

type RoleRow = {
  code: string;
  display_name: string;
  description: string | null;
  sort_order: number;
};

type PermissionRow = {
  code: TracePointPermission;
  display_name: string;
  description: string | null;
};

type RolePermissionRow = {
  role_code: string;
  permission_code: TracePointPermission;
};

type DepartmentForm = {
  id: string;
  name: string;
  short_name: string;
  state: string;
  county: string;
  agency_type: string;
  sworn_officers: number;
  civilian_staff: number;
  timezone: string;
  primary_contact_user_id: string;
  patch_url: string;
  accent_color: string;
  login_theme: string;
};

type RulesForm = {
  spring_cycle_start: string;
  spring_cycle_end: string;
  fall_cycle_start: string;
  fall_cycle_end: string;
  require_rifle_familiarization: boolean;
  inspection_interval_days: number;
  battery_check_interval_days: number;
  off_duty_renewal_days: number;
};

type SecurityForm = {
  require_mfa_policy: boolean;
  session_timeout_minutes: number;
  export_logging_enabled: boolean;
  data_retention_days: number;
};

type MemberRow = {
  user_id: string;
  full_name: string;
  email: string | null;
  badge_number: string | null;
  rank_title: string | null;
  unit_name: string | null;
  employee_number: string | null;
  is_active: boolean;
  joined_at: string;
  role_codes: string[];
  effective_permissions: TracePointPermission[];
};

type MemberDraft = {
  badge_number: string;
  rank_title: string;
  unit_name: string;
  employee_number: string;
  is_active: boolean;
  role_codes: string[];
};

type InviteDraft = {
  email: string;
  fullName: string;
  badgeNumber: string;
  rankTitle: string;
  unitName: string;
  employeeNumber: string;
  roleCodes: string[];
};

type AuditEvent = {
  id: number;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  created_at: string;
};

const EMPTY_DEPARTMENT: DepartmentForm = {
  id: "",
  name: "",
  short_name: "",
  state: "",
  county: "",
  agency_type: "Municipal Police Department",
  sworn_officers: 0,
  civilian_staff: 0,
  timezone: "America/New_York",
  primary_contact_user_id: "",
  patch_url: "",
  accent_color: "blue",
  login_theme: "dark",
};

const EMPTY_RULES: RulesForm = {
  spring_cycle_start: "04-01",
  spring_cycle_end: "06-30",
  fall_cycle_start: "09-01",
  fall_cycle_end: "11-30",
  require_rifle_familiarization: true,
  inspection_interval_days: 180,
  battery_check_interval_days: 180,
  off_duty_renewal_days: 365,
};

const EMPTY_SECURITY: SecurityForm = {
  require_mfa_policy: false,
  session_timeout_minutes: 30,
  export_logging_enabled: true,
  data_retention_days: 2555,
};

const EMPTY_INVITE: InviteDraft = {
  email: "",
  fullName: "",
  badgeNumber: "",
  rankTitle: "",
  unitName: "",
  employeeNumber: "",
  roleCodes: ["officer"],
};

const ACCENT_OPTIONS = [
  { value: "blue", label: "Blue" },
  { value: "indigo", label: "Indigo" },
  { value: "emerald", label: "Emerald" },
  { value: "slate", label: "Slate" },
];

const BRIGHTNESS_OPTIONS = [
  { value: "dark", label: "Standard Dark" },
  { value: "balanced", label: "Brighter Interface" },
  { value: "high-contrast", label: "High Contrast" },
];

const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
];

function normalizeArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function Notice({
  tone,
  children,
  onClose,
}: {
  tone: NoticeTone;
  children: ReactNode;
  onClose: () => void;
}) {
  const styles = {
    success:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    error: "border-red-500/30 bg-red-500/10 text-red-200",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  };

  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${styles[tone]}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        {tone === "success" ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        ) : tone === "error" ? (
          <X size={16} className="mt-0.5 shrink-0" />
        ) : (
          <Activity size={16} className="mt-0.5 shrink-0" />
        )}
        <p className="leading-5">{children}</p>
      </div>

      <button
        type="button"
        aria-label="Dismiss message"
        onClick={onClose}
        className="shrink-0 opacity-60 transition hover:opacity-100"
      >
        <X size={15} />
      </button>
    </div>
  );
}

function StatusPill({
  label,
  tone = "green",
}: {
  label: string;
  tone?: "green" | "blue" | "amber" | "red" | "slate";
}) {
  const styles = {
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    slate: "border-slate-700 bg-slate-800 text-slate-300",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function SettingsCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
              {description}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) {
  return (
    <div className="mb-1.5">
      <label className="text-xs font-semibold text-slate-300">{label}</label>
      {hint ? (
        <p className="mt-0.5 text-[11px] leading-4 text-slate-600">{hint}</p>
      ) : null}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "email";
  hint?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} hint={hint} />
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-700 focus:border-blue-500/70 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  max,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} hint={hint} />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(numberValue(event.target.value))}
        className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-500/70 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <FieldLabel label={label} hint={hint} />
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-2xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 pr-10 text-sm text-slate-100 outline-none transition focus:border-blue-500/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-600"
        />
      </div>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">{description}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${
          checked ? "bg-blue-600" : "bg-slate-700"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${
            checked ? "left-6" : "left-1"
          }`}
        />
      </button>
    </div>
  );
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      <section className="relative z-10 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded-xl border border-slate-800 p-2 text-slate-500 transition hover:text-white"
          >
            <X size={17} />
          </button>
        </header>

        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}

function RoleSelector({
  roles,
  selected,
  onChange,
  rolePermissionMap,
  permissionMap,
  disabled,
}: {
  roles: RoleRow[];
  selected: string[];
  onChange: (roles: string[]) => void;
  rolePermissionMap: Map<string, TracePointPermission[]>;
  permissionMap: Map<TracePointPermission, PermissionRow>;
  disabled?: boolean;
}) {
  const effectivePermissions = Array.from(
    new Set(
      selected.flatMap((roleCode) => rolePermissionMap.get(roleCode) ?? []),
    ),
  ).sort((left, right) =>
    (permissionMap.get(left)?.display_name ?? left).localeCompare(
      permissionMap.get(right)?.display_name ?? right,
    ),
  );

  function toggleRole(roleCode: string) {
    if (disabled) return;

    onChange(
      selected.includes(roleCode)
        ? selected.filter((code) => code !== roleCode)
        : [...selected, roleCode],
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel
          label="Assigned roles"
          hint="A user receives the combined permissions of every selected role."
        />

        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((role) => {
            const checked = selected.includes(role.code);

            return (
              <button
                key={role.code}
                type="button"
                disabled={disabled}
                onClick={() => toggleRole(role.code)}
                className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${
                  checked
                    ? "border-blue-500/50 bg-blue-500/10"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                    checked
                      ? "border-blue-500 bg-blue-600 text-white"
                      : "border-slate-700 text-transparent"
                  }`}
                >
                  <Check size={13} />
                </span>

                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-200">
                    {role.display_name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-4 text-slate-600">
                    {role.description || "TracePoint operational role."}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
          Effective permissions
        </p>

        {effectivePermissions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {effectivePermissions.map((permissionCode) => (
              <span
                key={permissionCode}
                className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300"
              >
                {permissionMap.get(permissionCode)?.display_name ??
                  humanize(permissionCode)}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-amber-300">
            Select at least one role for an active member.
          </p>
        )}
      </div>
    </div>
  );
}

export default function AdminSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const {
    loading: accessLoading,
    userId,
    departmentId,
    permissions: currentPermissions,
    hasPermission,
    refresh: refreshAccess,
  } = useTracePointAccess();

  const canManageUsers =
    hasPermission("manage_users") ||
    hasPermission("administer_department");
  const canAdminister = hasPermission("administer_department");
  const canViewAudit =
    hasPermission("view_audit_log") ||
    hasPermission("administer_department");

  const [activeTab, setActiveTab] = useState<TabId>("agency");
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    message: string;
  } | null>(null);

  const [department, setDepartment] =
    useState<DepartmentForm>(EMPTY_DEPARTMENT);
  const [rules, setRules] = useState<RulesForm>(EMPTY_RULES);
  const [security, setSecurity] =
    useState<SecurityForm>(EMPTY_SECURITY);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [rolePermissions, setRolePermissions] = useState<
    RolePermissionRow[]
  >([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  const [editingMember, setEditingMember] =
    useState<MemberRow | null>(null);
  const [memberDraft, setMemberDraft] =
    useState<MemberDraft | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteDraft, setInviteDraft] =
    useState<InviteDraft>(EMPTY_INVITE);
  const [editingRoleCode, setEditingRoleCode] =
    useState<string | null>(null);
  const [rolePermissionDraft, setRolePermissionDraft] = useState<
    TracePointPermission[]
  >([]);
  const [uploadingPatch, setUploadingPatch] = useState(false);
  const [passwordResetEmail, setPasswordResetEmail] = useState<string | null>(
    null,
  );
  const availableTabs = useMemo(() => {
    const items: Array<{
      id: TabId;
      label: string;
      icon: typeof Building2;
    }> = [];

    if (canAdminister) {
      items.push({
        id: "agency",
        label: "Agency Profile",
        icon: Building2,
      });
    }

    if (canManageUsers) {
      items.push({
        id: "users",
        label: "Users & Roles",
        icon: Users,
      });
    }

    if (canAdminister) {
      items.push({
        id: "rules",
        label: "Rules Engine",
        icon: Settings,
      });
            items.push({
        id: "branding",
        label: "Branding",
        icon: Palette,
      });
      items.push({
        id: "importExport",
        label: "Import / Export",
        icon: Upload,
      });
    }

    if (canViewAudit) {
      items.push({
        id: "audit",
        label: "Audit & Security",
        icon: Lock,
      });
    }

    return items;
  }, [canAdminister, canManageUsers, canViewAudit]);

  const rolePermissionMap = useMemo(() => {
    const map = new Map<string, TracePointPermission[]>();

    for (const rolePermission of rolePermissions) {
      const existing = map.get(rolePermission.role_code) ?? [];
      existing.push(rolePermission.permission_code);
      map.set(rolePermission.role_code, existing);
    }

    return map;
  }, [rolePermissions]);

  const permissionMap = useMemo(
    () =>
      new Map(
        permissions.map((permission) => [
          permission.code,
          permission,
        ]),
      ),
    [permissions],
  );

  const roleMap = useMemo(
    () => new Map(roles.map((role) => [role.code, role])),
    [roles],
  );

  const assignableRoles = useMemo(
    () =>
      canAdminister
        ? roles
        : roles.filter((role) => role.code !== "administrator"),
    [canAdminister, roles],
  );

  const showNotice = useCallback(
    (tone: NoticeTone, message: string) => {
      setNotice({ tone, message });
    },
    [],
  );

  const loadSettings = useCallback(async () => {
    if (!departmentId) return;

    setLoading(true);
    setNotice(null);

    try {
      const [
        departmentResult,
        rulesResult,
        securityResult,
        rolesResult,
        permissionsResult,
        rolePermissionsResult,
        membersResult,
      ] = await Promise.all([
        supabase
          .from("departments")
          .select(
            "id,name,short_name,state,county,agency_type,sworn_officers,civilian_staff,timezone,primary_contact_user_id,patch_url,accent_color,login_theme",
          )
          .eq("id", departmentId)
          .single(),
        supabase
          .from("department_rules")
          .select("*")
          .eq("department_id", departmentId)
          .maybeSingle(),
        canViewAudit
          ? supabase
              .from("department_security_settings")
              .select("*")
              .eq("department_id", departmentId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("roles")
          .select("code,display_name,description,sort_order")
          .order("sort_order"),
        supabase
          .from("permissions")
          .select("code,display_name,description"),
        supabase
          .from("department_role_permissions")
          .select("role_code,permission_code")
          .eq("department_id", departmentId),
        canManageUsers
          ? supabase.rpc("get_department_members", {
              p_department_id: departmentId,
            })
          : Promise.resolve({ data: [], error: null }),
      ]);

      const firstError = [
        departmentResult.error,
        rulesResult.error,
        securityResult.error,
        rolesResult.error,
        permissionsResult.error,
        rolePermissionsResult.error,
        membersResult.error,
      ].find(Boolean);

      if (firstError) throw firstError;

      const departmentData = departmentResult.data as unknown as Record<
        string,
        unknown
      >;

      setDepartment({
        id: String(departmentData.id ?? departmentId),
        name: String(departmentData.name ?? ""),
        short_name: String(departmentData.short_name ?? ""),
        state: String(departmentData.state ?? ""),
        county: String(departmentData.county ?? ""),
        agency_type: String(
          departmentData.agency_type ?? "Municipal Police Department",
        ),
        sworn_officers: numberValue(departmentData.sworn_officers),
        civilian_staff: numberValue(departmentData.civilian_staff),
        timezone: String(
          departmentData.timezone ?? "America/New_York",
        ),
        primary_contact_user_id: String(
          departmentData.primary_contact_user_id ?? "",
        ),
        patch_url: String(departmentData.patch_url ?? ""),
        accent_color: normalizeAccentColor(
          departmentData.accent_color,
        ),
        login_theme: normalizeBrightness(
          departmentData.login_theme,
        ),
      });

      const rulesData = rulesResult.data as unknown as
        | Record<string, unknown>
        | null;

      setRules(
        rulesData
          ? {
              spring_cycle_start: String(
                rulesData.spring_cycle_start ??
                  EMPTY_RULES.spring_cycle_start,
              ),
              spring_cycle_end: String(
                rulesData.spring_cycle_end ??
                  EMPTY_RULES.spring_cycle_end,
              ),
              fall_cycle_start: String(
                rulesData.fall_cycle_start ??
                  EMPTY_RULES.fall_cycle_start,
              ),
              fall_cycle_end: String(
                rulesData.fall_cycle_end ??
                  EMPTY_RULES.fall_cycle_end,
              ),
              require_rifle_familiarization: Boolean(
                rulesData.require_rifle_familiarization,
              ),
              inspection_interval_days: numberValue(
                rulesData.inspection_interval_days,
                180,
              ),
              battery_check_interval_days: numberValue(
                rulesData.battery_check_interval_days,
                180,
              ),
              off_duty_renewal_days: numberValue(
                rulesData.off_duty_renewal_days,
                365,
              ),
            }
          : EMPTY_RULES,
      );

      const securityData = securityResult.data as unknown as
        | Record<string, unknown>
        | null;

      if (securityData) {
        setSecurity({
          require_mfa_policy: Boolean(
            securityData.require_mfa_policy,
          ),
          session_timeout_minutes: numberValue(
            securityData.session_timeout_minutes,
            30,
          ),
          export_logging_enabled: Boolean(
            securityData.export_logging_enabled,
          ),
          data_retention_days: numberValue(
            securityData.data_retention_days,
            2555,
          ),
        });
      }

      setRoles(
        (rolesResult.data ?? []).map((row) => ({
          code: String(row.code ?? ""),
          display_name: String(row.display_name ?? row.code ?? ""),
          description:
            typeof row.description === "string"
              ? row.description
              : null,
          sort_order: numberValue(row.sort_order),
        })),
      );

      setPermissions(
        (permissionsResult.data ?? []).map((row) => ({
          code: String(row.code) as TracePointPermission,
          display_name: String(row.display_name ?? row.code ?? ""),
          description:
            typeof row.description === "string"
              ? row.description
              : null,
        })),
      );

      setRolePermissions(
        (rolePermissionsResult.data ?? []).map((row) => ({
          role_code: String(row.role_code ?? ""),
          permission_code: String(
            row.permission_code ?? "",
          ) as TracePointPermission,
        })),
      );

      setMembers(
        ((membersResult.data ?? []) as unknown as Array<
          Record<string, unknown>
        >).map((row) => ({
          user_id: String(row.user_id ?? ""),
          full_name: String(row.full_name ?? "TracePoint User"),
          email:
            typeof row.email === "string" ? row.email : null,
          badge_number:
            typeof row.badge_number === "string"
              ? row.badge_number
              : null,
          rank_title:
            typeof row.rank_title === "string"
              ? row.rank_title
              : null,
          unit_name:
            typeof row.unit_name === "string"
              ? row.unit_name
              : null,
          employee_number:
            typeof row.employee_number === "string"
              ? row.employee_number
              : null,
          is_active: Boolean(row.is_active),
          joined_at: String(row.joined_at ?? ""),
          role_codes: normalizeArray(row.role_codes),
          effective_permissions: normalizeArray(
            row.effective_permissions,
          ) as TracePointPermission[],
        })),
      );

      if (canViewAudit) {
        const { data: auditData, error: auditError } = await supabase
          .from("audit_events")
          .select(
            "id,actor_user_id,action,entity_type,entity_id,summary,created_at",
          )
          .eq("department_id", departmentId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (auditError) throw auditError;

        setAuditEvents(
          (auditData ?? []).map((row) => ({
            id: numberValue(row.id),
            actor_user_id:
              typeof row.actor_user_id === "string"
                ? row.actor_user_id
                : null,
            action: String(row.action ?? ""),
            entity_type: String(row.entity_type ?? ""),
            entity_id:
              typeof row.entity_id === "string"
                ? row.entity_id
                : null,
            summary:
              typeof row.summary === "string" ? row.summary : null,
            created_at: String(row.created_at ?? ""),
          })),
        );
      }
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Settings could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [
    canManageUsers,
    canViewAudit,
    departmentId,
    showNotice,
    supabase,
  ]);

  useEffect(() => {
    if (!accessLoading && departmentId) {
      void loadSettings();
    }
  }, [accessLoading, departmentId, loadSettings]);

  useEffect(() => {
    const nextAppearance = buildAppearancePreferences(
      department.accent_color,
      department.login_theme,
    );

    persistAndApplyAppearance(nextAppearance);
  }, [department.accent_color, department.login_theme]);

  async function saveAgency() {
    if (!canAdminister || !departmentId) return;

    setSavingSection("agency");
    setNotice(null);

    try {
      const { error } = await supabase
        .from("departments")
        .update({
          name: department.name.trim(),
          short_name: department.short_name.trim() || null,
          state: department.state.trim() || null,
          county: department.county.trim() || null,
          agency_type:
            department.agency_type.trim() ||
            "Municipal Police Department",
          sworn_officers: department.sworn_officers,
          civilian_staff: department.civilian_staff,
          timezone: department.timezone,
          primary_contact_user_id:
            department.primary_contact_user_id || null,
        })
        .eq("id", departmentId);

      if (error) throw error;

      await refreshAccess();
      window.dispatchEvent(
        new CustomEvent("tracepoint:department-updated"),
      );
      showNotice("success", "Agency profile saved to Supabase.");
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Agency profile could not be saved.",
      );
    } finally {
      setSavingSection(null);
    }
  }

  async function saveRules() {
    if (!canAdminister || !departmentId) return;

    setSavingSection("rules");
    setNotice(null);

    try {
      const { error } = await supabase.from("department_rules").upsert(
        {
          department_id: departmentId,
          ...rules,
          updated_by: userId,
        },
        { onConflict: "department_id" },
      );

      if (error) throw error;

      showNotice("success", "Operational rules saved to Supabase.");
      await loadSettings();
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Operational rules could not be saved.",
      );
    } finally {
      setSavingSection(null);
    }
  }

  async function saveBranding() {
    if (!canAdminister || !departmentId) return;

    setSavingSection("branding");
    setNotice(null);

    try {
      const { error } = await supabase
        .from("departments")
        .update({
          short_name: department.short_name.trim() || null,
          accent_color: department.accent_color,
          login_theme: department.login_theme,
          patch_url: department.patch_url || null,
        })
        .eq("id", departmentId);

      if (error) throw error;

      persistAndApplyAppearance(
        buildAppearancePreferences(
          department.accent_color,
          department.login_theme,
        ),
      );

      await refreshAccess();
      window.dispatchEvent(
        new CustomEvent("tracepoint:department-updated"),
      );
      showNotice("success", "Department branding saved to Supabase.");
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Branding could not be saved.",
      );
    } finally {
      setSavingSection(null);
    }
  }

  async function saveSecurity() {
    if (!canAdminister || !departmentId) return;

    setSavingSection("security");
    setNotice(null);

    try {
      const { error } = await supabase
        .from("department_security_settings")
        .upsert(
          {
            department_id: departmentId,
            ...security,
            updated_by: userId,
          },
          { onConflict: "department_id" },
        );

      if (error) throw error;

      showNotice("success", "Security policy settings saved.");
      await loadSettings();
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Security settings could not be saved.",
      );
    } finally {
      setSavingSection(null);
    }
  }

  function beginEditMember(member: MemberRow) {
    setEditingMember(member);
    setMemberDraft({
      badge_number: member.badge_number ?? "",
      rank_title: member.rank_title ?? "",
      unit_name: member.unit_name ?? "",
      employee_number: member.employee_number ?? "",
      is_active: member.is_active,
      role_codes: [...member.role_codes],
    });
  }

  async function saveMember() {
    if (
      !editingMember ||
      !memberDraft ||
      !departmentId ||
      !canManageUsers
    ) {
      return;
    }

    if (memberDraft.is_active && memberDraft.role_codes.length === 0) {
      showNotice(
        "error",
        "An active member must have at least one role.",
      );
      return;
    }

    setSavingSection("member");
    setNotice(null);

    try {
      const { error: memberError } = await supabase.rpc(
        "update_department_member",
        {
          p_department_id: departmentId,
          p_user_id: editingMember.user_id,
          p_badge_number: memberDraft.badge_number,
          p_rank_title: memberDraft.rank_title,
          p_unit_name: memberDraft.unit_name,
          p_employee_number: memberDraft.employee_number,
          p_is_active: memberDraft.is_active,
        },
      );

      if (memberError) throw memberError;

      const { error: roleError } = await supabase.rpc(
        "set_department_member_roles",
        {
          p_department_id: departmentId,
          p_user_id: editingMember.user_id,
          p_role_codes: memberDraft.role_codes,
        },
      );

      if (roleError) throw roleError;

      setEditingMember(null);
      setMemberDraft(null);
      showNotice(
        "success",
        `${editingMember.full_name}'s access was updated.`,
      );
      await loadSettings();

      if (editingMember.user_id === userId) {
        await refreshAccess();
      }
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "The membership could not be updated.",
      );
    } finally {
      setSavingSection(null);
    }
  }

  function beginEditRolePermissions(roleCode: string) {
    if (!canAdminister) return;

    setEditingRoleCode(roleCode);
    setRolePermissionDraft([
      ...(rolePermissionMap.get(roleCode) ?? []),
    ]);
  }

  async function saveRolePermissions() {
    if (!departmentId || !editingRoleCode || !canAdminister) return;

    if (editingRoleCode === "administrator") {
      showNotice(
        "error",
        "The Administrator permission matrix is locked to prevent department lockout.",
      );
      return;
    }

    if (rolePermissionDraft.includes("administer_department")) {
      showNotice(
        "error",
        "The Administer Department permission is reserved for the Administrator role.",
      );
      return;
    }

    setSavingSection("role-permissions");
    setNotice(null);

    try {
      const { error } = await supabase.rpc(
        "set_department_role_permissions",
        {
          p_department_id: departmentId,
          p_role_code: editingRoleCode,
          p_permission_codes: rolePermissionDraft,
        },
      );

      if (error) throw error;

      const roleLabel =
        roleMap.get(editingRoleCode)?.display_name ??
        humanize(editingRoleCode);

      setEditingRoleCode(null);
      setRolePermissionDraft([]);
      showNotice(
        "success",
        `${roleLabel} permissions were updated.`,
      );

      await Promise.all([loadSettings(), refreshAccess()]);
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "The role permission matrix could not be updated.",
      );
    } finally {
      setSavingSection(null);
    }
  }

  async function inviteUser() {
    if (!departmentId || !canManageUsers) return;

    if (
      !inviteDraft.email.trim() ||
      !inviteDraft.fullName.trim() ||
      inviteDraft.roleCodes.length === 0
    ) {
      showNotice(
        "error",
        "Email, full name, and at least one role are required.",
      );
      return;
    }

    setSavingSection("invite");
    setNotice(null);

    try {
      const response = await fetch("/api/settings/users/invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          departmentId,
          email: inviteDraft.email,
          fullName: inviteDraft.fullName,
          badgeNumber: inviteDraft.badgeNumber,
          rankTitle: inviteDraft.rankTitle,
          unitName: inviteDraft.unitName,
          employeeNumber: inviteDraft.employeeNumber,
          roleCodes: inviteDraft.roleCodes,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "The user could not be added.");
      }

      setInviteOpen(false);
      setInviteDraft(EMPTY_INVITE);
      showNotice(
        "success",
        result.message || "The user was added successfully.",
      );
      await loadSettings();
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "The user could not be added.",
      );
    } finally {
      setSavingSection(null);
    }
  }

  async function handleSendPasswordReset(userEmail: string) {
    if (!departmentId || !canManageUsers || !userEmail) return;

    const confirmed = window.confirm(
      `Send a password reset email to ${userEmail}?`,
    );

    if (!confirmed) return;

    setPasswordResetEmail(userEmail);

    try {
      const response = await fetch("/api/settings/users/password-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          departmentId,
          email: userEmail,
        }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Password reset could not be sent.");
      }

      showNotice(
        "success",
        result.message ?? `Password reset sent to ${userEmail}.`,
      );
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "Password reset could not be sent.",
      );
    } finally {
      setPasswordResetEmail(null);
    }
  }

  async function uploadPatch(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file || !departmentId || !canAdminister) return;

    if (file.size > 2 * 1024 * 1024) {
      showNotice("error", "Department patch files must be 2 MB or smaller.");
      return;
    }

    const extensionByType: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };

    const extension = extensionByType[file.type];

    if (!extension) {
      showNotice(
        "error",
        "Use a PNG, JPG, or WEBP image for the department patch.",
      );
      return;
    }

    setUploadingPatch(true);
    setNotice(null);

    try {
      const path = `${departmentId}/patch-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("department-assets")
        .upload(path, file, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("department-assets")
        .getPublicUrl(path);

      const patchUrl = data.publicUrl;

      const { error: updateError } = await supabase
        .from("departments")
        .update({ patch_url: patchUrl })
        .eq("id", departmentId);

      if (updateError) throw updateError;

      setDepartment((current) => ({
        ...current,
        patch_url: patchUrl,
      }));
      window.dispatchEvent(
        new CustomEvent("tracepoint:department-updated"),
      );
      showNotice("success", "Department patch uploaded and saved.");
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "The department patch could not be uploaded.",
      );
    } finally {
      setUploadingPatch(false);
    }
  }

  async function exportAuditLog() {
    if (!departmentId || !canViewAudit) return;

    setSavingSection("audit-export");

    try {
      const { data, error } = await supabase
        .from("audit_events")
        .select(
          "id,actor_user_id,action,entity_type,entity_id,summary,created_at",
        )
        .eq("department_id", departmentId)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) throw error;

      const rows = data ?? [];
      const escape = (value: unknown) =>
        `"${String(value ?? "").replaceAll('"', '""')}"`;

      const csv = [
        [
          "Created At",
          "Action",
          "Entity Type",
          "Entity ID",
          "Actor User ID",
          "Summary",
        ]
          .map(escape)
          .join(","),
        ...rows.map((row) =>
          [
            row.created_at,
            row.action,
            row.entity_type,
            row.entity_id,
            row.actor_user_id,
            row.summary,
          ]
            .map(escape)
            .join(","),
        ),
      ].join("\n");

      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tracepoint-audit-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      showNotice("success", "Audit log exported.");
    } catch (error) {
      showNotice(
        "error",
        error instanceof Error
          ? error.message
          : "The audit log could not be exported.",
      );
    } finally {
      setSavingSection(null);
    }
  }

  function saveCurrentTab() {
    if (activeTab === "agency") void saveAgency();
    if (activeTab === "rules") void saveRules();
    if (activeTab === "branding") void saveBranding();
    if (activeTab === "audit") void saveSecurity();
  }

  const primaryContactOptions = [
    { value: "", label: "Not assigned" },
    ...members
      .filter((member) => member.is_active)
      .map((member) => ({
        value: member.user_id,
        label: member.rank_title
          ? `${member.rank_title} ${member.full_name}`
          : member.full_name,
      })),
  ];

  const userRoleCounts = roles.map((role) => ({
    ...role,
    count: members.filter((member) =>
      member.role_codes.includes(role.code),
    ).length,
  }));

  const currentTabCanSave =
    activeTab === "agency" ||
    activeTab === "rules" ||
    activeTab === "branding" ||
    activeTab === "audit";

  return (
    <TracePointShell activePage="Settings">
      <div className="w-full min-w-0 space-y-6">
        <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold leading-tight text-white">
              Admin Settings
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              Manage department configuration, user access, operational
              rules, branding, and audit controls.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
              <span>
                {members.length} department member
                {members.length === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>{roles.length} available roles</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Supabase connected
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void loadSettings()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
            >
              <RefreshCw
                size={15}
                className={loading ? "animate-spin" : ""}
              />
              Refresh
            </button>

            {currentTabCanSave && canAdminister ? (
              <button
                type="button"
                onClick={saveCurrentTab}
                disabled={Boolean(savingSection)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingSection ? (
                  <LoaderCircle size={15} className="animate-spin" />
                ) : (
                  <Save size={15} />
                )}
                Save {availableTabs.find((tab) => tab.id === activeTab)?.label}
              </button>
            ) : null}
          </div>
        </header>

        {notice ? (
          <Notice
            tone={notice.tone}
            onClose={() => setNotice(null)}
          >
            {notice.message}
          </Notice>
        ) : null}

        <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-900 p-1.5">
          <div className="flex min-w-max gap-1">
            {availableTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-w-[150px] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition ${
                    active
                      ? "bg-blue-600/20 text-blue-300"
                      : "text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  }`}
                >
                  <Icon size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading || accessLoading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/50">
            <div className="text-center">
              <LoaderCircle
                size={28}
                className="mx-auto animate-spin text-blue-400"
              />
              <p className="mt-3 text-sm text-slate-500">
                Loading department settings...
              </p>
            </div>
          </div>
        ) : null}

        {!loading && !accessLoading && activeTab === "importExport" ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
            <SettingsCard
              title="Import / Export"
              description="Administrative onboarding tools for importing agency data and preparing export workflows."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <a
                  href="/settings/import-export"
                  className="group rounded-3xl border border-slate-800 bg-slate-950/70 p-5 transition hover:border-blue-500 hover:bg-slate-900"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-300">
                      <Upload size={20} />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Import Wizard
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Upload CSV files, map fields, validate records, preview
                        rows, and import supported pilot data.
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-xs font-semibold text-blue-300 transition group-hover:text-blue-200">
                    Open Import Wizard ?
                  </p>
                </a>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-800 text-slate-300">
                      <Download size={20} />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        Export Center
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Planned area for agency exports, templates, import
                        history, rollback reports, and saved mappings.
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-xs font-semibold text-slate-600">
                    Coming soon
                  </p>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard
              title="Pilot Import Support"
              description="Current import scope for the Readington pilot build."
            >
              <div className="space-y-3 text-sm text-slate-400">
                <div className="rounded-2xl border border-emerald-800 bg-emerald-950/30 p-4">
                  <p className="font-semibold text-emerald-200">
                    Firearms import is live.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-emerald-200/80">
                    CSV firearm rows can be imported into the live Armory pilot
                    records.
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-800 bg-amber-950/30 p-4">
                  <p className="font-semibold text-amber-200">
                    Personnel and qualification history are preview-only.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-200/80">
                    Those workflows validate and preview data until the final
                    normalized import targets are completed.
                  </p>
                </div>
              </div>
            </SettingsCard>
          </div>
        ) : null}
        {!loading && !accessLoading && activeTab === "agency" ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <SettingsCard
              title="Agency Profile"
              description="These values identify the department throughout TracePoint and generated records."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label="Legal agency name"
                  value={department.name}
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      name: value,
                    }))
                  }
                />
                <TextInput
                  label="Short display name"
                  value={department.short_name}
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      short_name: value,
                    }))
                  }
                  placeholder="Readington PD"
                />
                <TextInput
                  label="State"
                  value={department.state}
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      state: value,
                    }))
                  }
                />
                <TextInput
                  label="County"
                  value={department.county}
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      county: value,
                    }))
                  }
                />
                <TextInput
                  label="Agency type"
                  value={department.agency_type}
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      agency_type: value,
                    }))
                  }
                />
                <SelectInput
                  label="Time zone"
                  value={department.timezone}
                  options={TIMEZONE_OPTIONS}
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      timezone: value,
                    }))
                  }
                />
                <NumberInput
                  label="Sworn officers"
                  value={department.sworn_officers}
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      sworn_officers: value,
                    }))
                  }
                />
                <NumberInput
                  label="Civilian staff"
                  value={department.civilian_staff}
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      civilian_staff: value,
                    }))
                  }
                />
                <div className="sm:col-span-2">
                  <SelectInput
                    label="Primary contact"
                    value={department.primary_contact_user_id}
                    options={primaryContactOptions}
                    onChange={(value) =>
                      setDepartment((current) => ({
                        ...current,
                        primary_contact_user_id: value,
                      }))
                    }
                    hint="Primary department contact for TracePoint administration."
                  />
                </div>
              </div>
            </SettingsCard>

            <SettingsCard
              title="Configuration Status"
              description="Live readiness based on saved department data."
            >
              <div className="space-y-3">
                {[
                  {
                    label: "Agency identity",
                    ready: Boolean(department.name && department.short_name),
                  },
                  {
                    label: "Jurisdiction",
                    ready: Boolean(department.state && department.county),
                  },
                  {
                    label: "User administration",
                    ready: members.length > 0,
                  },
                  {
                    label: "Department patch",
                    ready: Boolean(department.patch_url),
                  },
                  {
                    label: "Operational rules",
                    ready: Boolean(rules.inspection_interval_days),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                  >
                    <span className="text-sm text-slate-400">
                      {item.label}
                    </span>
                    <StatusPill
                      label={item.ready ? "Configured" : "Needs Setup"}
                      tone={item.ready ? "green" : "amber"}
                    />
                  </div>
                ))}
              </div>
            </SettingsCard>
          </div>
        ) : null}

        {!loading && !accessLoading && activeTab === "users" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {userRoleCounts.map((role) => (
                <div
                  key={role.code}
                  className="rounded-3xl border border-slate-800 bg-slate-900 p-4"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                    {role.display_name}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {role.count}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-600">
                    {role.description}
                  </p>
                </div>
              ))}
            </div>

            <SettingsCard
              title="Department Users"
              description="Assign multiple operational roles. Effective permissions are calculated automatically."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setInviteDraft(EMPTY_INVITE);
                    setInviteOpen(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  <UserPlus size={15} />
                  Invite User
                </button>
              }
            >
              <div className="space-y-3">
                {members.map((member) => (
                  <article
                    key={member.user_id}
                    className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-white">
                            {member.rank_title
                              ? `${member.rank_title} ${member.full_name}`
                              : member.full_name}
                          </h3>
                          <StatusPill
                            label={member.is_active ? "Active" : "Inactive"}
                            tone={member.is_active ? "green" : "slate"}
                          />
                          {member.user_id === userId ? (
                            <StatusPill label="You" tone="blue" />
                          ) : null}
                        </div>

                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                          <span>{member.email || "No email recorded"}</span>
                          {member.badge_number ? (
                            <span>Badge {member.badge_number}</span>
                          ) : null}
                          {member.unit_name ? (
                            <span>{member.unit_name}</span>
                          ) : null}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {member.role_codes.map((roleCode) => (
                            <span
                              key={roleCode}
                              className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold text-blue-300"
                            >
                              {roleMap.get(roleCode)?.display_name ??
                                humanize(roleCode)}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-3">
                        <div className="hidden text-right sm:block">
                          <p className="text-xs font-medium text-slate-400">
                            {member.effective_permissions.length} effective
                            permissions
                          </p>
                          <p className="mt-1 text-[11px] text-slate-600">
                            Joined {formatDateTime(member.joined_at)}
                          </p>
                        </div>

                        {member.email ? (
                          <button
                            type="button"
                            onClick={() =>
                              void handleSendPasswordReset(member.email ?? "")
                            }
                            disabled={
                              !canManageUsers ||
                              passwordResetEmail === member.email ||
                              (member.role_codes.includes("administrator") &&
                                !canAdminister)
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-3.5 py-2 text-sm font-semibold text-slate-300 transition hover:border-amber-500/50 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {passwordResetEmail === member.email ? (
                              <LoaderCircle size={14} className="animate-spin" />
                            ) : (
                              <Mail size={14} />
                            )}
                            {passwordResetEmail === member.email
                              ? "Sending..."
                              : "Send Password Reset"}
                          </button>
                        ) : null}

                        {member.role_codes.includes("administrator") &&
                        !canAdminister ? (
                          <span className="rounded-2xl border border-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-600">
                            Administrator only
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => beginEditMember(member)}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-3.5 py-2 text-sm font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white"
                          >
                            <Pencil size={14} />
                            Edit Access
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}

                {members.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 px-5 py-10 text-center">
                    <Users size={24} className="mx-auto text-slate-600" />
                    <p className="mt-3 text-sm text-slate-400">
                      No department memberships were returned.
                    </p>
                  </div>
                ) : null}
              </div>
            </SettingsCard>

            <SettingsCard
              title="Role Permission Matrix"
              description="Define what each department role can do. The Administrator role is locked to preserve tenant access."
            >
              <div className="grid gap-3 lg:grid-cols-2">
                {roles.map((role) => {
                  const granted =
                    rolePermissionMap.get(role.code) ?? [];
                  const locked = role.code === "administrator";

                  return (
                    <article
                      key={role.code}
                      className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-white">
                              {role.display_name}
                            </h3>
                            {locked ? (
                              <StatusPill label="Locked" tone="slate" />
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            {role.description ||
                              "TracePoint operational role."}
                          </p>
                        </div>

                        {canAdminister && !locked ? (
                          <button
                            type="button"
                            onClick={() =>
                              beginEditRolePermissions(role.code)
                            }
                            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white"
                          >
                            <Pencil size={13} />
                            Edit
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {granted.length > 0 ? (
                          granted
                            .slice()
                            .sort((left, right) =>
                              (
                                permissionMap.get(left)?.display_name ??
                                left
                              ).localeCompare(
                                permissionMap.get(right)?.display_name ??
                                  right,
                              ),
                            )
                            .map((permissionCode) => (
                              <span
                                key={permissionCode}
                                className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300"
                              >
                                {permissionMap.get(permissionCode)
                                  ?.display_name ??
                                  humanize(permissionCode)}
                              </span>
                            ))
                        ) : (
                          <span className="text-xs text-amber-300">
                            No permissions assigned.
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </SettingsCard>
          </div>
        ) : null}

        {!loading && !accessLoading && activeTab === "rules" ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsCard
              title="Qualification Cycles"
              description="Store agency-defined spring and fall cycle boundaries using MM-DD."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <TextInput
                  label="Spring cycle start"
                  value={rules.spring_cycle_start}
                  placeholder="04-01"
                  onChange={(value) =>
                    setRules((current) => ({
                      ...current,
                      spring_cycle_start: value,
                    }))
                  }
                />
                <TextInput
                  label="Spring cycle end"
                  value={rules.spring_cycle_end}
                  placeholder="06-30"
                  onChange={(value) =>
                    setRules((current) => ({
                      ...current,
                      spring_cycle_end: value,
                    }))
                  }
                />
                <TextInput
                  label="Fall cycle start"
                  value={rules.fall_cycle_start}
                  placeholder="09-01"
                  onChange={(value) =>
                    setRules((current) => ({
                      ...current,
                      fall_cycle_start: value,
                    }))
                  }
                />
                <TextInput
                  label="Fall cycle end"
                  value={rules.fall_cycle_end}
                  placeholder="11-30"
                  onChange={(value) =>
                    setRules((current) => ({
                      ...current,
                      fall_cycle_end: value,
                    }))
                  }
                />
              </div>
            </SettingsCard>

            <SettingsCard
              title="Training Requirements"
              description="Agency-level compliance intervals used by future automated alerts."
            >
              <div className="space-y-4">
                <ToggleRow
                  title="Require rifle familiarization"
                  description="Track familiarization separately from rifle qualification."
                  checked={rules.require_rifle_familiarization}
                  onChange={(checked) =>
                    setRules((current) => ({
                      ...current,
                      require_rifle_familiarization: checked,
                    }))
                  }
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberInput
                    label="Inspection interval"
                    value={rules.inspection_interval_days}
                    min={1}
                    max={3650}
                    hint="Days"
                    onChange={(value) =>
                      setRules((current) => ({
                        ...current,
                        inspection_interval_days: value,
                      }))
                    }
                  />
                  <NumberInput
                    label="Battery check interval"
                    value={rules.battery_check_interval_days}
                    min={1}
                    max={3650}
                    hint="Days"
                    onChange={(value) =>
                      setRules((current) => ({
                        ...current,
                        battery_check_interval_days: value,
                      }))
                    }
                  />
                  <NumberInput
                    label="Off-duty renewal"
                    value={rules.off_duty_renewal_days}
                    min={1}
                    max={3650}
                    hint="Days"
                    onChange={(value) =>
                      setRules((current) => ({
                        ...current,
                        off_duty_renewal_days: value,
                      }))
                    }
                  />
                </div>
              </div>
            </SettingsCard>
          </div>
        ) : null}

        {!loading && !accessLoading && activeTab === "branding" ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsCard
              title="Department Branding"
              description="Configure the department identity and app appearance displayed throughout TracePoint."
            >
              <div className="space-y-4">
                <TextInput
                  label="Agency display name"
                  value={department.short_name}
                  placeholder="Readington PD"
                  onChange={(value) =>
                    setDepartment((current) => ({
                      ...current,
                      short_name: value,
                    }))
                  }
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectInput
                    label="Color palette"
                    value={normalizeAccentColor(department.accent_color)}
                    options={ACCENT_OPTIONS}
                    hint="Applies immediately to navigation, buttons, highlights, and key interface accents."
                    onChange={(value) =>
                      setDepartment((current) => ({
                        ...current,
                        accent_color: normalizeAccentColor(value),
                      }))
                    }
                  />
                  <SelectInput
                    label="Screen brightness"
                    value={normalizeBrightness(department.login_theme)}
                    options={BRIGHTNESS_OPTIONS}
                    hint="Applies immediately and persists for this browser after save."
                    onChange={(value) =>
                      setDepartment((current) => ({
                        ...current,
                        login_theme: normalizeBrightness(value),
                      }))
                    }
                  />
                </div>
              </div>
            </SettingsCard>

            <SettingsCard
              title="Department Patch"
              description="PNG, JPG, or WEBP. Maximum file size: 2 MB."
            >
              <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-700 bg-slate-950/60 p-6 text-center">
                {department.patch_url ? (
                  <img
                    src={department.patch_url}
                    alt="Department patch"
                    className="h-28 w-28 object-contain"
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-slate-700 bg-slate-900 text-slate-500">
                    <ImagePlus size={30} />
                  </div>
                )}

                <p className="mt-4 text-sm font-semibold text-slate-200">
                  {department.patch_url
                    ? "Department patch configured"
                    : "Upload department patch"}
                </p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-slate-600">
                  Used in future sidebar, login, and generated report
                  branding.
                </p>

                <label className="mt-4 inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white">
                  {uploadingPatch ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <Upload size={15} />
                  )}
                  {uploadingPatch ? "Uploading..." : "Select Image"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploadingPatch}
                    onChange={uploadPatch}
                    className="hidden"
                  />
                </label>
              </div>
            </SettingsCard>
          </div>
        ) : null}

        {!loading && !accessLoading && activeTab === "audit" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,1.2fr)]">
            <SettingsCard
              title="Security Policy"
              description="These values are stored now for department policy. Authentication enforcement will be connected as the security layer is completed."
            >
              <div className="space-y-4">
                <ToggleRow
                  title="MFA required by department policy"
                  description="Records the agency requirement for multi-factor authentication."
                  checked={security.require_mfa_policy}
                  onChange={(checked) =>
                    setSecurity((current) => ({
                      ...current,
                      require_mfa_policy: checked,
                    }))
                  }
                  disabled={!canAdminister}
                />

                <ToggleRow
                  title="Log data exports"
                  description="Record export activity in the TracePoint audit trail."
                  checked={security.export_logging_enabled}
                  onChange={(checked) =>
                    setSecurity((current) => ({
                      ...current,
                      export_logging_enabled: checked,
                    }))
                  }
                  disabled={!canAdminister}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberInput
                    label="Session timeout"
                    hint="Minutes"
                    value={security.session_timeout_minutes}
                    min={5}
                    max={1440}
                    disabled={!canAdminister}
                    onChange={(value) =>
                      setSecurity((current) => ({
                        ...current,
                        session_timeout_minutes: value,
                      }))
                    }
                  />
                  <NumberInput
                    label="Data retention"
                    hint="Days"
                    value={security.data_retention_days}
                    min={30}
                    max={36500}
                    disabled={!canAdminister}
                    onChange={(value) =>
                      setSecurity((current) => ({
                        ...current,
                        data_retention_days: value,
                      }))
                    }
                  />
                </div>
              </div>
            </SettingsCard>

            <SettingsCard
              title="Recent Administrative Activity"
              description="The latest department audit events recorded by Supabase."
              action={
                <button
                  type="button"
                  onClick={() => void exportAuditLog()}
                  disabled={savingSection === "audit-export"}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-700 px-3.5 py-2 text-sm font-semibold text-slate-300 transition hover:border-blue-500/50 hover:text-white disabled:opacity-50"
                >
                  {savingSection === "audit-export" ? (
                    <LoaderCircle size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  Export CSV
                </button>
              }
            >
              <div className="space-y-3">
                {auditEvents.map((event) => {
                  const actor = members.find(
                    (member) => member.user_id === event.actor_user_id,
                  );

                  return (
                    <article
                      key={event.id}
                      className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <FileText
                              size={14}
                              className="shrink-0 text-blue-400"
                            />
                            <p className="text-sm font-medium text-slate-200">
                              {event.summary ||
                                `${humanize(event.action)} · ${humanize(
                                  event.entity_type,
                                )}`}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            {actor?.full_name || "System"} ·{" "}
                            {humanize(event.action)}
                          </p>
                        </div>
                        <time className="shrink-0 text-[11px] text-slate-600">
                          {formatDateTime(event.created_at)}
                        </time>
                      </div>
                    </article>
                  );
                })}

                {auditEvents.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 px-5 py-10 text-center">
                    <ShieldCheck
                      size={24}
                      className="mx-auto text-slate-600"
                    />
                    <p className="mt-3 text-sm text-slate-400">
                      No audit events are available yet.
                    </p>
                  </div>
                ) : null}
              </div>
            </SettingsCard>
          </div>
        ) : null}

        {!loading &&
        !accessLoading &&
        availableTabs.length === 0 ? (
          <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 px-5 py-10 text-center">
            <Lock size={28} className="mx-auto text-amber-300" />
            <h2 className="mt-3 text-lg font-semibold text-white">
              Settings access is restricted
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Your current roles do not grant administrative settings
              access.
            </p>
            <p className="mt-3 text-xs text-slate-600">
              Loaded permissions: {currentPermissions.length}
            </p>
          </div>
        ) : null}
      </div>

      {inviteOpen ? (
        <Modal
          title="Invite Department User"
          description="Invite a new TracePoint account or add an existing TracePoint user to this department."
          onClose={() => {
            if (savingSection !== "invite") setInviteOpen(false);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Full name"
              value={inviteDraft.fullName}
              onChange={(value) =>
                setInviteDraft((current) => ({
                  ...current,
                  fullName: value,
                }))
              }
            />
            <TextInput
              label="Email address"
              type="email"
              value={inviteDraft.email}
              onChange={(value) =>
                setInviteDraft((current) => ({
                  ...current,
                  email: value,
                }))
              }
            />
            <TextInput
              label="Rank / title"
              value={inviteDraft.rankTitle}
              onChange={(value) =>
                setInviteDraft((current) => ({
                  ...current,
                  rankTitle: value,
                }))
              }
              placeholder="Lieutenant"
            />
            <TextInput
              label="Badge number"
              value={inviteDraft.badgeNumber}
              onChange={(value) =>
                setInviteDraft((current) => ({
                  ...current,
                  badgeNumber: value,
                }))
              }
            />
            <TextInput
              label="Unit"
              value={inviteDraft.unitName}
              onChange={(value) =>
                setInviteDraft((current) => ({
                  ...current,
                  unitName: value,
                }))
              }
              placeholder="Special Services"
            />
            <TextInput
              label="Employee number"
              value={inviteDraft.employeeNumber}
              onChange={(value) =>
                setInviteDraft((current) => ({
                  ...current,
                  employeeNumber: value,
                }))
              }
            />
          </div>

          <div className="mt-5">
            <RoleSelector
              roles={assignableRoles}
              selected={inviteDraft.roleCodes}
              onChange={(roleCodes) =>
                setInviteDraft((current) => ({
                  ...current,
                  roleCodes,
                }))
              }
              rolePermissionMap={rolePermissionMap}
              permissionMap={permissionMap}
              disabled={savingSection === "invite"}
            />
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={savingSection === "invite"}
              onClick={() => setInviteOpen(false)}
              className="rounded-2xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingSection === "invite"}
              onClick={() => void inviteUser()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {savingSection === "invite" ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Mail size={15} />
              )}
              Send Invitation
            </button>
          </div>
        </Modal>
      ) : null}

      {editingRoleCode ? (
        <Modal
          title={`Edit ${
            roleMap.get(editingRoleCode)?.display_name ??
            humanize(editingRoleCode)
          } Permissions`}
          description="Changes apply to every department member assigned this role."
          onClose={() => {
            if (savingSection !== "role-permissions") {
              setEditingRoleCode(null);
              setRolePermissionDraft([]);
            }
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {permissions.map((permission) => {
              const reserved =
                permission.code === "administer_department";
              const checked = rolePermissionDraft.includes(
                permission.code,
              );

              return (
                <button
                  key={permission.code}
                  type="button"
                  disabled={
                    reserved ||
                    savingSection === "role-permissions"
                  }
                  onClick={() =>
                    setRolePermissionDraft((current) =>
                      current.includes(permission.code)
                        ? current.filter(
                            (code) => code !== permission.code,
                          )
                        : [...current, permission.code],
                    )
                  }
                  className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${
                    checked
                      ? "border-blue-500/50 bg-blue-500/10"
                      : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                  } disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      checked
                        ? "border-blue-500 bg-blue-600 text-white"
                        : "border-slate-700 text-transparent"
                    }`}
                  >
                    <Check size={13} />
                  </span>

                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-200">
                      {permission.display_name}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 text-slate-600">
                      {reserved
                        ? "Reserved for the Administrator role."
                        : permission.description ||
                          "TracePoint permission."}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={savingSection === "role-permissions"}
              onClick={() => {
                setEditingRoleCode(null);
                setRolePermissionDraft([]);
              }}
              className="rounded-2xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingSection === "role-permissions"}
              onClick={() => void saveRolePermissions()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {savingSection === "role-permissions" ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              Save Permissions
            </button>
          </div>
        </Modal>
      ) : null}

      {editingMember && memberDraft ? (
        <Modal
          title={`Edit ${editingMember.full_name}`}
          description="Update membership details, status, roles, and effective access."
          onClose={() => {
            if (savingSection !== "member") {
              setEditingMember(null);
              setMemberDraft(null);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Email"
              value={editingMember.email ?? ""}
              onChange={() => undefined}
              disabled
              hint="Authentication email changes are managed through Supabase Auth."
            />
            <TextInput
              label="Rank / title"
              value={memberDraft.rank_title}
              onChange={(value) =>
                setMemberDraft((current) =>
                  current
                    ? { ...current, rank_title: value }
                    : current,
                )
              }
            />
            <TextInput
              label="Badge number"
              value={memberDraft.badge_number}
              onChange={(value) =>
                setMemberDraft((current) =>
                  current
                    ? { ...current, badge_number: value }
                    : current,
                )
              }
            />
            <TextInput
              label="Employee number"
              value={memberDraft.employee_number}
              onChange={(value) =>
                setMemberDraft((current) =>
                  current
                    ? { ...current, employee_number: value }
                    : current,
                )
              }
            />
            <div className="sm:col-span-2">
              <TextInput
                label="Unit"
                value={memberDraft.unit_name}
                onChange={(value) =>
                  setMemberDraft((current) =>
                    current
                      ? { ...current, unit_name: value }
                      : current,
                  )
                }
              />
            </div>
          </div>

          <div className="mt-5">
            <ToggleRow
              title="Active department membership"
              description={
                editingMember.user_id === userId
                  ? "You cannot deactivate your own current membership."
                  : "Inactive members cannot access department data."
              }
              checked={memberDraft.is_active}
              disabled={
                editingMember.user_id === userId ||
                savingSection === "member"
              }
              onChange={(checked) =>
                setMemberDraft((current) =>
                  current
                    ? { ...current, is_active: checked }
                    : current,
                )
              }
            />
          </div>

          <div className="mt-5">
            <RoleSelector
              roles={assignableRoles}
              selected={memberDraft.role_codes}
              onChange={(roleCodes) =>
                setMemberDraft((current) =>
                  current
                    ? { ...current, role_codes: roleCodes }
                    : current,
                )
              }
              rolePermissionMap={rolePermissionMap}
              permissionMap={permissionMap}
              disabled={savingSection === "member"}
            />
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={savingSection === "member"}
              onClick={() => {
                setEditingMember(null);
                setMemberDraft(null);
              }}
              className="rounded-2xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={savingSection === "member"}
              onClick={() => void saveMember()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {savingSection === "member" ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              Save Access
            </button>
          </div>
        </Modal>
      ) : null}
    </TracePointShell>
  );
}

