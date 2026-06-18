"use client";

import TracePointShell from "@/app/components/TracePointShell";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  Download,
  History,
  Plus,
  Search,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FirearmStatus = "Armory" | "Issued" | "OOS" | "Maintenance" | "Missing/Lost";
type FirearmType = "Pistol" | "Shotgun" | "Rifle" | "Revolver";

interface Firearm {
  serial: string;
  make: string;
  model: string;
  type: FirearmType;
  caliber: string;
  status: FirearmStatus;
  assignedTo: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  detail: string;
  actor: string;
  timestamp: string;
  tone: "green" | "blue" | "amber" | "orange" | "red" | "slate";
}

type StatusFilter = FirearmStatus | "";
type TypeFilter = FirearmType | "";

const FIREARM_STATUSES: FirearmStatus[] = [
  "Armory",
  "Issued",
  "OOS",
  "Maintenance",
  "Missing/Lost",
];

const FIREARM_TYPES: FirearmType[] = ["Pistol", "Shotgun", "Rifle", "Revolver"];

const FIREARMS_STORAGE_KEY = "tracepoint.firearms.repository.v1";
const AUDIT_LOG_STORAGE_KEY = "tracepoint.firearms.auditLog.v1";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_FIREARMS: Firearm[] = [
  {
    serial: "GBR4921",
    make: "Glock",
    model: "17 Gen5",
    type: "Pistol",
    caliber: "9mm",
    status: "Issued",
    assignedTo: "Sgt. Rivera, M.",
  },
  {
    serial: "GBR5503",
    make: "Glock",
    model: "19 Gen4",
    type: "Pistol",
    caliber: "9mm",
    status: "Issued",
    assignedTo: "Off. Chen, D.",
  },
  {
    serial: "GBR6102",
    make: "Glock",
    model: "17 Gen5",
    type: "Pistol",
    caliber: "9mm",
    status: "Armory",
    assignedTo: null,
  },
  {
    serial: "SW22819",
    make: "S&W",
    model: "M&P Shield",
    type: "Pistol",
    caliber: "9mm",
    status: "Issued",
    assignedTo: "Det. Patel, A.",
  },
  {
    serial: "SW29401",
    make: "S&W",
    model: "686 Plus",
    type: "Revolver",
    caliber: ".357",
    status: "Maintenance",
    assignedTo: null,
  },
  {
    serial: "REM8834",
    make: "Remington",
    model: "870 Express",
    type: "Shotgun",
    caliber: "12ga",
    status: "Issued",
    assignedTo: "Off. Torres, L.",
  },
  {
    serial: "REM9012",
    make: "Remington",
    model: "870 Tactical",
    type: "Shotgun",
    caliber: "12ga",
    status: "Armory",
    assignedTo: null,
  },
  {
    serial: "SIG7731",
    make: "Sig Sauer",
    model: "P320",
    type: "Pistol",
    caliber: "9mm",
    status: "Issued",
    assignedTo: "Lt. Brooks, C.",
  },
  {
    serial: "SIG7890",
    make: "Sig Sauer",
    model: "P226",
    type: "Pistol",
    caliber: "9mm",
    status: "OOS",
    assignedTo: "Off. Nguyen, T.",
  },
  {
    serial: "AR15112",
    make: "Colt",
    model: "LE6920",
    type: "Rifle",
    caliber: "5.56",
    status: "Issued",
    assignedTo: "Sgt. Rivera, M.",
  },
  {
    serial: "AR15220",
    make: "Colt",
    model: "LE6920",
    type: "Rifle",
    caliber: "5.56",
    status: "Armory",
    assignedTo: null,
  },
  {
    serial: "BER0041",
    make: "Beretta",
    model: "92FS",
    type: "Pistol",
    caliber: "9mm",
    status: "Missing/Lost",
    assignedTo: "Off. Walsh, R.",
  },
  {
    serial: "GLK0080",
    make: "Glock",
    model: "26 Gen5",
    type: "Pistol",
    caliber: "9mm",
    status: "Issued",
    assignedTo: "Off. Martinez, K.",
  },
  {
    serial: "WIN4490",
    make: "Winchester",
    model: "SXP Defender",
    type: "Shotgun",
    caliber: "12ga",
    status: "Maintenance",
    assignedTo: null,
  },
  {
    serial: "SIG8821",
    make: "Sig Sauer",
    model: "MCX Patrol",
    type: "Rifle",
    caliber: "5.56",
    status: "Issued",
    assignedTo: "Det. Okafor, B.",
  },
  {
    serial: "GLK0221",
    make: "Glock",
    model: "21 Gen4",
    type: "Pistol",
    caliber: ".45",
    status: "OOS",
    assignedTo: null,
  },
  {
    serial: "REM0055",
    make: "Remington",
    model: "700P",
    type: "Rifle",
    caliber: ".308",
    status: "Armory",
    assignedTo: null,
  },
];

const INITIAL_AUDIT_LOG: AuditEntry[] = [
  {
    id: "audit-001",
    action: "Inventory Reviewed",
    detail: "Firearms repository opened and inventory status reviewed.",
    actor: "System",
    timestamp: "Today",
    tone: "blue",
  },
  {
    id: "audit-002",
    action: "Firearm Marked OOS",
    detail: "SIG7890 was marked out of service pending armorer review.",
    actor: "Range Master",
    timestamp: "Yesterday",
    tone: "orange",
  },
  {
    id: "audit-003",
    action: "Maintenance Entry",
    detail: "WIN4490 placed into maintenance queue.",
    actor: "Armorer",
    timestamp: "2 days ago",
    tone: "amber",
  },
  {
    id: "audit-004",
    action: "Missing / Lost Flag",
    detail: "BER0041 flagged as missing/lost and requires command review.",
    actor: "Command Staff",
    timestamp: "3 days ago",
    tone: "red",
  },
];

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  FirearmStatus,
  { label: string; className: string; dotClassName: string }
> = {
  Armory: {
    label: "Armory",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    dotClassName: "bg-blue-400",
  },
  Issued: {
    label: "Issued",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    dotClassName: "bg-emerald-400",
  },
  OOS: {
    label: "OOS",
    className: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    dotClassName: "bg-orange-400",
  },
  Maintenance: {
    label: "Maintenance",
    className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    dotClassName: "bg-amber-400",
  },
  "Missing/Lost": {
    label: "Missing/Lost",
    className: "bg-red-500/15 text-red-300 border-red-500/30",
    dotClassName: "bg-red-400",
  },
};

const AUDIT_TONE_CLASS: Record<AuditEntry["tone"], string> = {
  green: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  slate: "bg-slate-500",
};

const ACTION_LABELS: Record<string, string> = {
  issue: "Issue Firearm",
  return: "Return / RTS",
  "mark-oos": "Mark Out of Service",
  "send-maintenance": "Send to Maintenance",
  "return-armory": "Return to Armory",
  "log-inspection": "Log Inspection",
  "file-report": "File Report",
  "view-history": "View History",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .replace(/Sgt\.|Off\.|Det\.|Lt\./g, "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function escapeCsvValue(value: string | number | null): string {
  const text = String(value ?? "");

  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function exportFirearmsCsv(records: Firearm[]) {
  const headers = [
    "Serial",
    "Make",
    "Model",
    "Type",
    "Caliber",
    "Status",
    "Assigned To",
  ];

  const rows = records.map((f) => [
    f.serial,
    f.make,
    f.model,
    f.type,
    f.caliber,
    f.status,
    f.assignedTo ?? "Armory",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `tracepoint-firearms-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: FirearmStatus }) {
  const cfg = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotClassName}`} />
      {cfg.label}
    </span>
  );
}

function AssignedToCell({ assignedTo }: { assignedTo: string | null }) {
  if (!assignedTo) {
    return <span className="text-[11px] italic text-slate-600">— Armory</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[9px] font-semibold text-slate-400">
        {getInitials(assignedTo)}
      </div>

      <span className="truncate text-[12px] text-slate-400">{assignedTo}</span>
    </div>
  );
}

function ModalShell({
  title,
  eyebrow,
  children,
  onClose,
  size = "md",
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  size?: "md" | "lg";
}) {
  const width = size === "lg" ? "max-w-3xl" : "max-w-md";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6 ${width}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-white"
        >
          <X size={16} />
        </button>

        {eyebrow && (
          <p className="mb-1 pr-8 text-xs font-semibold uppercase tracking-widest text-slate-500">
            {eyebrow}
          </p>
        )}

        <h3 className="pr-8 text-xl font-bold text-white">{title}</h3>

        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function AddFirearmModal({
  existingSerials,
  onAdd,
  onClose,
}: {
  existingSerials: Set<string>;
  onAdd: (firearm: Firearm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<{
    serial: string;
    make: string;
    model: string;
    type: FirearmType;
    caliber: string;
    status: FirearmStatus;
    assignedTo: string;
  }>({
    serial: "",
    make: "",
    model: "",
    type: "Pistol",
    caliber: "9mm",
    status: "Armory",
    assignedTo: "",
  });

  const [error, setError] = useState("");

  const inputClass =
    "w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none transition placeholder:text-slate-700 focus:border-blue-500";
  const labelClass =
    "mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600";

  const update = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const serial = form.serial.trim().toUpperCase();
    const make = form.make.trim();
    const model = form.model.trim();
    const caliber = form.caliber.trim();
    const assignedTo = form.assignedTo.trim();

    if (!serial || !make || !model || !caliber) {
      setError("Serial, make, model, and caliber are required.");
      return;
    }

    if (existingSerials.has(serial)) {
      setError("A firearm with that serial number already exists.");
      return;
    }

    onAdd({
      serial,
      make,
      model,
      type: form.type,
      caliber,
      status: form.status,
      assignedTo: assignedTo || null,
    });
  };

  return (
    <ModalShell title="Add Firearm" eyebrow="Firearms Repository" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Serial Number</label>
            <input
              value={form.serial}
              onChange={(e) => update("serial", e.target.value)}
              className={inputClass}
              placeholder="Example: GLK1234"
            />
          </div>

          <div>
            <label className={labelClass}>Make</label>
            <input
              value={form.make}
              onChange={(e) => update("make", e.target.value)}
              className={inputClass}
              placeholder="Glock, Sig Sauer, Colt"
            />
          </div>

          <div>
            <label className={labelClass}>Model</label>
            <input
              value={form.model}
              onChange={(e) => update("model", e.target.value)}
              className={inputClass}
              placeholder="17 Gen5"
            />
          </div>

          <div>
            <label className={labelClass}>Caliber</label>
            <input
              value={form.caliber}
              onChange={(e) => update("caliber", e.target.value)}
              className={inputClass}
              placeholder="9mm"
            />
          </div>

          <div>
            <label className={labelClass}>Type</label>
            <select
              value={form.type}
              onChange={(e) => update("type", e.target.value as FirearmType)}
              className={inputClass}
            >
              {FIREARM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Status</label>
            <select
              value={form.status}
              onChange={(e) =>
                update("status", e.target.value as FirearmStatus)
              }
              className={inputClass}
            >
              {FIREARM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_CONFIG[status].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Assigned To</label>
          <input
            value={form.assignedTo}
            onChange={(e) => update("assignedTo", e.target.value)}
            className={inputClass}
            placeholder="Leave blank if stored in armory"
          />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200"
          >
            Cancel
          </button>

          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            <Plus size={14} />
            Save Firearm
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function AuditLogModal({
  entries,
  onClose,
}: {
  entries: AuditEntry[];
  onClose: () => void;
}) {
  return (
    <ModalShell
      title="Audit Log"
      eyebrow="System Activity"
      size="lg"
      onClose={onClose}
    >
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                    AUDIT_TONE_CLASS[entry.tone]
                  }`}
                />

                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {entry.action}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-slate-400">
                    {entry.detail}
                  </p>
                </div>
              </div>

              <span className="whitespace-nowrap text-xs text-slate-600">
                {entry.timestamp}
              </span>
            </div>

            <p className="mt-2 border-t border-slate-800 pt-2 text-[11px] text-slate-600">
              Actor: {entry.actor}
            </p>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

function WorkflowModal({
  title,
  description,
  onClose,
}: {
  title: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <ModalShell title={title} eyebrow="Workflow" onClose={onClose}>
      <p className="text-sm leading-6 text-slate-400">{description}</p>

      <button
        type="button"
        onClick={onClose}
        className="mt-6 w-full rounded-xl bg-slate-800 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-700"
      >
        Close
      </button>
    </ModalShell>
  );
}

function RowActions({
  firearm,
  onAction,
  align = "end",
}: {
  firearm: Firearm;
  onAction: (action: string, serial: string) => void;
  align?: "start" | "end";
}) {
  const { serial, status } = firearm;

  const primary: {
    label: string;
    variant?: "warn" | "danger";
    action: string;
  }[] = [];

  if (status === "Armory") {
    primary.push({ label: "Issue", action: "issue" });
  }

  if (status === "Issued") {
    primary.push({ label: "Return / RTS", action: "return" });
    primary.push({ label: "Mark OOS", variant: "warn", action: "mark-oos" });
  }

  if (status === "OOS") {
    primary.push({ label: "Send to Maint.", action: "send-maintenance" });
    primary.push({ label: "Return to Armory", action: "return-armory" });
  }

  if (status === "Maintenance") {
    primary.push({ label: "Log Inspection", action: "log-inspection" });
    primary.push({ label: "Return to Armory", action: "return-armory" });
  }

  if (status === "Missing/Lost") {
    primary.push({
      label: "File Report",
      variant: "danger",
      action: "file-report",
    });
  }

  const base =
    "rounded px-2 py-1 text-[10px] font-medium border transition-colors duration-150 cursor-pointer whitespace-nowrap";

  const def = `${base} border-white/[0.08] bg-slate-800 text-slate-400 hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-400`;
  const warn = `${base} border-white/[0.08] bg-slate-800 text-slate-400 hover:border-orange-500/50 hover:bg-orange-500/10 hover:text-orange-400`;
  const danger = `${base} border-white/[0.08] bg-slate-800 text-slate-400 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400`;
  const history = `${base} border-white/[0.08] bg-slate-800 text-slate-500 hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-400`;

  return (
    <div
      className={`flex flex-wrap items-center gap-1 opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100 ${
        align === "end" ? "justify-end" : "justify-start"
      }`}
    >
      {primary.map((p) => (
        <button
          key={p.action}
          type="button"
          className={
            p.variant === "danger" ? danger : p.variant === "warn" ? warn : def
          }
          onClick={() => onAction(p.action, serial)}
        >
          {p.label}
        </button>
      ))}

      {primary.length > 0 && (
        <div className="mx-0.5 hidden h-3.5 w-px flex-shrink-0 bg-white/[0.08] sm:block" />
      )}

      <button
        type="button"
        className={history}
        title="View history"
        aria-label={`View history for firearm ${serial}`}
        onClick={() => onAction("view-history", serial)}
      >
        <History size={11} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FirearmsRepository() {
  const [firearms, setFirearms] = useState<Firearm[]>(MOCK_FIREARMS);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(INITIAL_AUDIT_LOG);
  const [storageReady, setStorageReady] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");

  const [addFirearmOpen, setAddFirearmOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [workflowModal, setWorkflowModal] = useState<{
    title: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    try {
      const savedFirearms = window.localStorage.getItem(FIREARMS_STORAGE_KEY);
      const savedAuditLog = window.localStorage.getItem(AUDIT_LOG_STORAGE_KEY);

      if (savedFirearms) {
        const parsedFirearms = JSON.parse(savedFirearms);

        if (Array.isArray(parsedFirearms)) {
          setFirearms(parsedFirearms);
        }
      }

      if (savedAuditLog) {
        const parsedAuditLog = JSON.parse(savedAuditLog);

        if (Array.isArray(parsedAuditLog)) {
          setAuditLog(parsedAuditLog);
        }
      }
    } catch (error) {
      console.error("[TracePoint] Failed to load saved firearms data.", error);
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;

    try {
      window.localStorage.setItem(
        FIREARMS_STORAGE_KEY,
        JSON.stringify(firearms),
      );
    } catch (error) {
      console.error("[TracePoint] Failed to save firearms data.", error);
    }
  }, [firearms, storageReady]);

  useEffect(() => {
    if (!storageReady) return;

    try {
      window.localStorage.setItem(
        AUDIT_LOG_STORAGE_KEY,
        JSON.stringify(auditLog),
      );
    } catch (error) {
      console.error("[TracePoint] Failed to save audit log data.", error);
    }
  }, [auditLog, storageReady]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();

    return firearms.filter((f) => {
      const haystack = [
        f.serial,
        f.make,
        f.model,
        f.type,
        f.caliber,
        f.status,
        f.assignedTo ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!q || haystack.includes(q)) &&
        (!statusFilter || f.status === statusFilter) &&
        (!typeFilter || f.type === typeFilter)
      );
    });
  }, [firearms, search, statusFilter, typeFilter]);

  const stats = useMemo(
    () => ({
      total: firearms.length,
      issued: firearms.filter((f) => f.status === "Issued").length,
      armory: firearms.filter((f) => f.status === "Armory").length,
      maintenance: firearms.filter((f) => f.status === "Maintenance").length,
      oos: firearms.filter((f) => f.status === "OOS").length,
      missing: firearms.filter((f) => f.status === "Missing/Lost").length,
    }),
    [firearms],
  );

  const attention = [
    stats.oos > 0 && {
      text: `${stats.oos} out of service`,
      dot: "bg-orange-500",
      filter: "OOS" as FirearmStatus,
    },
    stats.missing > 0 && {
      text: `${stats.missing} missing / unaccounted`,
      dot: "bg-red-500",
      filter: "Missing/Lost" as FirearmStatus,
    },
    stats.maintenance > 0 && {
      text: `${stats.maintenance} in maintenance`,
      dot: "bg-amber-500",
      filter: "Maintenance" as FirearmStatus,
    },
  ].filter(Boolean) as {
    text: string;
    dot: string;
    filter: FirearmStatus;
  }[];

  const kpiCards = [
    {
      label: "Total",
      value: stats.total,
      color: "text-slate-200",
      sub: "All firearms",
      filter: "" as StatusFilter,
    },
    {
      label: "Issued",
      value: stats.issued,
      color: "text-emerald-400",
      sub: "Active carry",
      filter: "Issued" as StatusFilter,
    },
    {
      label: "In Armory",
      value: stats.armory,
      color: "text-blue-400",
      sub: "Available",
      filter: "Armory" as StatusFilter,
    },
    {
      label: "Maintenance",
      value: stats.maintenance,
      color: "text-amber-400",
      sub: "Service queue",
      filter: "Maintenance" as StatusFilter,
    },
    {
      label: "Out of Service",
      value: stats.oos,
      color: "text-orange-400",
      sub: "Non-operational",
      filter: "OOS" as StatusFilter,
    },
    {
      label: "Missing",
      value: stats.missing,
      color: "text-red-400",
      sub: "Unaccounted",
      filter: "Missing/Lost" as StatusFilter,
    },
  ];

  const hasActiveFilters = Boolean(search || statusFilter || typeFilter);

  function showNotice(message: string) {
    setNotice(message);

    window.setTimeout(() => {
      setNotice(null);
    }, 3500);
  }

  function recordAudit(
    action: string,
    detail: string,
    tone: AuditEntry["tone"] = "blue",
  ) {
    setAuditLog((prev) => [
      {
        id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        action,
        detail,
        actor: "Current User",
        timestamp: "Just now",
        tone,
      },
      ...prev,
    ]);
  }

  function handleAddFirearm(firearm: Firearm) {
    setFirearms((prev) => [firearm, ...prev]);

    recordAudit(
      "Firearm Added",
      `${firearm.make} ${firearm.model} (${firearm.serial}) added to the repository.`,
      "green",
    );

    setAddFirearmOpen(false);
    showNotice(`${firearm.serial} added to repository.`);
  }

  const handleAction = (action: string, serial: string) => {
    if (action === "export") {
      exportFirearmsCsv(filtered);

      recordAudit(
        "Export Generated",
        `${filtered.length} firearm record${
          filtered.length === 1 ? "" : "s"
        } exported to CSV.`,
        "blue",
      );

      showNotice(
        `Exported ${filtered.length} firearm record${
          filtered.length === 1 ? "" : "s"
        }.`,
      );

      return;
    }

    if (action === "audit-log") {
      setAuditLogOpen(true);
      return;
    }

    if (action === "add-firearm") {
      setAddFirearmOpen(true);
      return;
    }

    const firearm = firearms.find((f) => f.serial === serial);
    const label = ACTION_LABELS[action] ?? action;

    if (!firearm) {
      return;
    }

    if (action === "view-history") {
      recordAudit(
        "History Viewed",
        `History opened for ${firearm.make} ${firearm.model} (${serial}).`,
        "slate",
      );

      setWorkflowModal({
        title: `History: ${serial}`,
        description: `This history view is ready to connect to the permanent firearm audit trail. For now, the action is captured in the in-page audit log for ${firearm.make} ${firearm.model}.`,
      });

      return;
    }

    recordAudit(
      label,
      `${label} workflow opened for ${firearm.make} ${firearm.model} (${serial}).`,
      action === "file-report"
        ? "red"
        : action === "mark-oos"
          ? "orange"
          : "blue",
    );

    setWorkflowModal({
      title: `${label}: ${serial}`,
      description: `The ${label.toLowerCase()} workflow is now wired to open from this row. The next build step would be replacing this placeholder with the actual guided form, validations, and database write. Firearm: ${firearm.make} ${firearm.model}, ${firearm.caliber}.`,
    });
  };

  return (
    <TracePointShell activePage="Firearms">
      {notice && (
        <div className="fixed right-4 top-4 z-[60] flex max-w-sm items-center gap-3 rounded-2xl border border-blue-500/30 bg-slate-900 px-4 py-3 text-sm text-slate-200 shadow-2xl">
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
            aria-label="Dismiss notice"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {addFirearmOpen && (
        <AddFirearmModal
          existingSerials={
            new Set(firearms.map((firearm) => firearm.serial.toUpperCase()))
          }
          onAdd={handleAddFirearm}
          onClose={() => setAddFirearmOpen(false)}
        />
      )}

      {auditLogOpen && (
        <AuditLogModal
          entries={auditLog}
          onClose={() => setAuditLogOpen(false)}
        />
      )}

      {workflowModal && (
        <WorkflowModal
          title={workflowModal.title}
          description={workflowModal.description}
          onClose={() => setWorkflowModal(null)}
        />
      )}

      <div className="w-full min-w-0 space-y-5">
        {/* Page header */}
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold leading-tight text-white sm:text-[22px]">
                Firearms Repository
              </h1>

              <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-slate-500">
                Inventory status, assignments, service exceptions, and weapon
                accountability.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-700">
                <span>{stats.total} tracked</span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span>{stats.issued} issued</span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span className={stats.oos > 0 ? "text-orange-500" : ""}>
                  {stats.oos} OOS
                </span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span className={stats.missing > 0 ? "text-red-400" : ""}>
                  {stats.missing} missing/lost
                </span>
              </div>
            </div>

            <span className="w-fit rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-[11px] font-medium text-slate-400">
              Readington PD
            </span>
          </div>
        </header>

        {/* KPI strip */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((card) => {
            const isActive = statusFilter === card.filter;

            return (
              <button
                key={card.label}
                type="button"
                onClick={() => setStatusFilter(card.filter)}
                className={`group cursor-pointer rounded-2xl border px-4 py-3 text-left transition-all duration-200 hover:-translate-y-px hover:shadow-[0_2px_12px_rgba(0,0,0,0.3)] ${
                  isActive
                    ? "border-blue-500/35 bg-slate-800/80"
                    : "border-slate-800 bg-slate-900 hover:border-blue-500/25 hover:bg-slate-800/70"
                }`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 transition-colors group-hover:text-slate-500">
                  {card.label}
                </p>

                <p className={`mt-1 text-2xl font-bold leading-none ${card.color}`}>
                  {card.value}
                </p>

                <p className="mt-0.5 text-[10px] text-slate-600">{card.sub}</p>
              </button>
            );
          })}
        </section>

        {/* Attention Required */}
        {attention.length > 0 && (
          <section className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 md:flex-row md:items-center md:gap-x-5">
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <AlertTriangle size={12} className="text-amber-500" />
              <span className="text-[9.5px] font-semibold uppercase tracking-widest text-slate-500">
                Attention Required
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {attention.map((item) => (
                <button
                  key={item.text}
                  type="button"
                  onClick={() => setStatusFilter(item.filter)}
                  className="flex items-center gap-1.5 text-[11.5px] text-slate-400 transition-colors hover:text-slate-200"
                >
                  <span
                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${item.dot}`}
                  />
                  {item.text}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Toolbar */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
              <div className="relative w-full md:max-w-[440px]">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                />

                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search serial, make, model, caliber, assigned to..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/60 py-2 pl-9 pr-3 text-[12px] text-white outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:w-auto">
                <div className="relative">
                  <select
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as StatusFilter)
                    }
                    className="w-full cursor-pointer appearance-none rounded-xl border border-slate-800 bg-slate-950/60 py-2 pl-3 pr-8 text-[12px] text-slate-400 outline-none transition-colors focus:border-blue-500 md:w-[150px]"
                  >
                    <option value="">All statuses</option>
                    <option value="Armory">Armory</option>
                    <option value="Issued">Issued</option>
                    <option value="OOS">OOS</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="Missing/Lost">Missing / Lost</option>
                  </select>

                  <ChevronDown
                    size={11}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600"
                  />
                </div>

                <div className="relative">
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                    className="w-full cursor-pointer appearance-none rounded-xl border border-slate-800 bg-slate-950/60 py-2 pl-3 pr-8 text-[12px] text-slate-400 outline-none transition-colors focus:border-blue-500 md:w-[135px]"
                  >
                    <option value="">All types</option>
                    <option value="Pistol">Pistol</option>
                    <option value="Shotgun">Shotgun</option>
                    <option value="Rifle">Rifle</option>
                    <option value="Revolver">Revolver</option>
                  </select>

                  <ChevronDown
                    size={11}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600"
                  />
                </div>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("");
                    setTypeFilter("");
                  }}
                  className="w-full rounded-xl border border-slate-800 px-3 py-2 text-[12px] text-slate-500 transition hover:border-slate-700 hover:bg-slate-800/60 hover:text-slate-300 md:w-auto"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 xl:flex xl:items-center xl:justify-end">
              <button
                type="button"
                onClick={() => handleAction("export", "")}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-transparent px-3 py-2 text-[12px] text-slate-400 transition-all hover:border-slate-700 hover:bg-slate-800/60 hover:text-slate-200"
              >
                <Download size={12} />
                Export
              </button>

              <button
                type="button"
                onClick={() => handleAction("audit-log", "")}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-transparent px-3 py-2 text-[12px] text-slate-400 transition-all hover:border-slate-700 hover:bg-slate-800/60 hover:text-slate-200"
              >
                <ClipboardList size={12} />
                Audit Log
              </button>

              <button
                type="button"
                onClick={() => handleAction("add-firearm", "")}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-[12px] font-semibold text-white transition-all hover:bg-blue-500"
              >
                <Plus size={13} />
                Add Firearm
              </button>
            </div>
          </div>
        </section>

        {/* Mobile / tablet card list */}
        <section className="space-y-2 lg:hidden">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-10 text-center text-[13px] text-slate-600">
              No firearms match your current filters.
            </div>
          ) : (
            filtered.map((firearm) => (
              <article
                key={firearm.serial}
                className={`group rounded-2xl border border-slate-800 bg-slate-900 p-4 ${
                  firearm.status === "Missing/Lost"
                    ? "border-red-500/20 bg-red-500/[0.03]"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] tracking-wide text-slate-400">
                      {firearm.serial}
                    </p>

                    <h3 className="mt-0.5 truncate text-[15px] font-semibold text-white">
                      {firearm.make} {firearm.model}
                    </h3>

                    <p className="mt-1 text-[11px] text-slate-600">
                      {firearm.type} · {firearm.caliber}
                    </p>
                  </div>

                  <StatusBadge status={firearm.status} />
                </div>

                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                    Assigned To
                  </p>

                  <AssignedToCell assignedTo={firearm.assignedTo} />
                </div>

                <div className="mt-3">
                  <RowActions
                    firearm={firearm}
                    onAction={handleAction}
                    align="start"
                  />
                </div>
              </article>
            ))
          )}
        </section>

        {/* Desktop table */}
        <section className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 lg:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead className="bg-slate-900/80">
                <tr>
                  {[
                    { label: "Serial No.", cls: "w-[12%]" },
                    { label: "Make", cls: "w-[10%]" },
                    { label: "Model", cls: "w-[14%]" },
                    { label: "Type", cls: "w-[9%]" },
                    { label: "Caliber", cls: "w-[7%]" },
                    { label: "Status", cls: "w-[13%]" },
                    { label: "Assigned To", cls: "w-[20%]" },
                    { label: "", cls: "w-[220px] pr-4 text-right" },
                  ].map((col) => (
                    <th
                      key={col.label}
                      className={`border-b border-slate-800 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600 ${col.cls}`}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-800/60">
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-12 text-center text-[13px] text-slate-600"
                    >
                      No firearms match your current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((firearm) => (
                    <tr
                      key={firearm.serial}
                      className={`group cursor-pointer transition-colors duration-100 ${
                        firearm.status === "Missing/Lost"
                          ? "hover:bg-red-500/[0.05]"
                          : "hover:bg-slate-800/50"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11px] tracking-wide text-slate-200">
                          {firearm.serial}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-[12px] font-medium text-slate-200">
                        {firearm.make}
                      </td>

                      <td className="px-4 py-3 text-[12px] text-slate-400">
                        {firearm.model}
                      </td>

                      <td className="px-4 py-3 text-[12px] text-slate-400">
                        {firearm.type}
                      </td>

                      <td className="px-4 py-3 text-[12px] text-slate-400">
                        {firearm.caliber}
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge status={firearm.status} />
                      </td>

                      <td className="px-4 py-3">
                        <AssignedToCell assignedTo={firearm.assignedTo} />
                      </td>

                      <td className="px-4 py-3 text-right">
                        <RowActions firearm={firearm} onAction={handleAction} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-2.5 text-[11px] text-slate-600">
            <span>
              {filtered.length === firearms.length
                ? `Showing all ${firearms.length} records`
                : `${filtered.length} of ${firearms.length} records`}
            </span>

            <div className="flex items-center gap-1">
              {["‹", "1", "2", "›"].map((p, i) => (
                <button
                  key={`${p}-${i}`}
                  type="button"
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-lg border text-[11px] transition-colors ${
                    p === "1"
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-slate-800 bg-transparent text-slate-600 hover:border-slate-700 hover:text-slate-300"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}