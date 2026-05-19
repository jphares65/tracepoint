"use client";
import TracePointShell from "@/components/TracePointShell";
import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Download,
  ClipboardList,
  History,
  ChevronDown,
  AlertTriangle,
  LayoutDashboard,
  Crosshair,
  Shield,
  ShieldCheck,
  CalendarRange,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types — unchanged
// ---------------------------------------------------------------------------

type FirearmStatus = "Armory" | "Issued" | "OOS" | "Maintenance" | "Missing/Lost";
type FirearmType   = "Pistol" | "Shotgun" | "Rifle" | "Revolver";

interface Firearm {
  serial:     string;
  make:       string;
  model:      string;
  type:       FirearmType;
  caliber:    string;
  status:     FirearmStatus;
  assignedTo: string | null;
}

// ---------------------------------------------------------------------------
// Mock data — unchanged
// ---------------------------------------------------------------------------

const MOCK_FIREARMS: Firearm[] = [
  { serial: "GBR4921", make: "Glock",      model: "17 Gen5",      type: "Pistol",   caliber: "9mm",   status: "Issued",       assignedTo: "Sgt. Rivera, M."   },
  { serial: "GBR5503", make: "Glock",      model: "19 Gen4",      type: "Pistol",   caliber: "9mm",   status: "Issued",       assignedTo: "Off. Chen, D."     },
  { serial: "GBR6102", make: "Glock",      model: "17 Gen5",      type: "Pistol",   caliber: "9mm",   status: "Armory",       assignedTo: null                 },
  { serial: "SW22819", make: "S&W",        model: "M&P Shield",   type: "Pistol",   caliber: "9mm",   status: "Issued",       assignedTo: "Det. Patel, A."    },
  { serial: "SW29401", make: "S&W",        model: "686 Plus",     type: "Revolver", caliber: ".357",  status: "Maintenance",  assignedTo: null                 },
  { serial: "REM8834", make: "Remington",  model: "870 Express",  type: "Shotgun",  caliber: "12ga",  status: "Issued",       assignedTo: "Off. Torres, L."   },
  { serial: "REM9012", make: "Remington",  model: "870 Tactical", type: "Shotgun",  caliber: "12ga",  status: "Armory",       assignedTo: null                 },
  { serial: "SIG7731", make: "Sig Sauer",  model: "P320",         type: "Pistol",   caliber: "9mm",   status: "Issued",       assignedTo: "Lt. Brooks, C."    },
  { serial: "SIG7890", make: "Sig Sauer",  model: "P226",         type: "Pistol",   caliber: "9mm",   status: "OOS",          assignedTo: "Off. Nguyen, T."   },
  { serial: "AR15112", make: "Colt",       model: "LE6920",       type: "Rifle",    caliber: "5.56",  status: "Issued",       assignedTo: "Sgt. Rivera, M."   },
  { serial: "AR15220", make: "Colt",       model: "LE6920",       type: "Rifle",    caliber: "5.56",  status: "Armory",       assignedTo: null                 },
  { serial: "BER0041", make: "Beretta",    model: "92FS",         type: "Pistol",   caliber: "9mm",   status: "Missing/Lost", assignedTo: "Off. Walsh, R."    },
  { serial: "GLK0080", make: "Glock",      model: "26 Gen5",      type: "Pistol",   caliber: "9mm",   status: "Issued",       assignedTo: "Off. Martinez, K." },
  { serial: "WIN4490", make: "Winchester", model: "SXP Defender", type: "Shotgun",  caliber: "12ga",  status: "Maintenance",  assignedTo: null                 },
  { serial: "SIG8821", make: "Sig Sauer",  model: "MCX Patrol",   type: "Rifle",    caliber: "5.56",  status: "Issued",       assignedTo: "Det. Okafor, B."   },
  { serial: "GLK0221", make: "Glock",      model: "21 Gen4",      type: "Pistol",   caliber: ".45",   status: "OOS",          assignedTo: null                 },
  { serial: "REM0055", make: "Remington",  model: "700P",         type: "Rifle",    caliber: ".308",  status: "Armory",       assignedTo: null                 },
];

// ---------------------------------------------------------------------------
// Status config — unchanged
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<FirearmStatus, { label: string; className: string }> = {
  Armory:         { label: "Armory",       className: "bg-blue-500/10    text-blue-400   border-blue-500/20"   },
  Issued:         { label: "Issued",       className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  OOS:            { label: "OOS",          className: "bg-orange-500/10  text-orange-400 border-orange-500/20" },
  Maintenance:    { label: "Maintenance",  className: "bg-amber-500/10   text-amber-400  border-amber-500/20"  },
  "Missing/Lost": { label: "Missing/Lost", className: "bg-red-500/15     text-red-300    border-red-500/30"    },
};

const STATUS_DOT: Record<FirearmStatus, string> = {
  Armory:         "bg-blue-400",
  Issued:         "bg-emerald-400",
  OOS:            "bg-orange-400",
  Maintenance:    "bg-amber-400",
  "Missing/Lost": "bg-red-400",
};

// ---------------------------------------------------------------------------
// Helpers — unchanged
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .replace(/Sgt\.|Off\.|Det\.|Lt\./g, "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

// ---------------------------------------------------------------------------
// StatusBadge — unchanged
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: FirearmStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AssignedToCell — unchanged
// ---------------------------------------------------------------------------

function AssignedToCell({ assignedTo }: { assignedTo: string | null }) {
  if (!assignedTo) {
    return <span className="text-[11px] italic text-slate-600">— Armory</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[9px] font-semibold text-slate-400">
        {getInitials(assignedTo)}
      </div>
      <span className="truncate text-[12px] text-slate-400">{assignedTo}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RowActions — all status gates, action strings, variants, history btn unchanged
// ---------------------------------------------------------------------------

function RowActions({
  firearm,
  onAction,
}: {
  firearm: Firearm;
  onAction: (action: string, serial: string) => void;
}) {
  const { serial, status } = firearm;
  const primary: { label: string; variant?: "warn" | "danger"; action: string }[] = [];

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
    // Log Inspection — record only, does NOT change status
    primary.push({ label: "Log Inspection", action: "log-inspection" });
    // Return to Armory — explicit disposition after approval
    primary.push({ label: "Return to Armory", action: "return-armory" });
  }
  if (status === "Missing/Lost") {
    primary.push({ label: "File Report", variant: "danger", action: "file-report" });
  }

  const base    = "rounded px-2 py-1 text-[10px] font-medium border transition-colors duration-150 cursor-pointer whitespace-nowrap";
  const def     = `${base} border-white/[0.08] bg-slate-800 text-slate-400 hover:border-blue-500/50 hover:text-blue-400 hover:bg-blue-500/10`;
  const warn    = `${base} border-white/[0.08] bg-slate-800 text-slate-400 hover:border-orange-500/50 hover:text-orange-400 hover:bg-orange-500/10`;
  const danger  = `${base} border-white/[0.08] bg-slate-800 text-slate-400 hover:border-red-500/50 hover:text-red-400 hover:bg-red-500/10`;
  const history = `${base} border-white/[0.08] bg-slate-800 text-slate-500 hover:border-blue-500/50 hover:text-blue-400 hover:bg-blue-500/10 opacity-60 hover:opacity-100`;

  return (
    <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      {primary.map((p) => (
        <button
          key={p.action}
          className={p.variant === "danger" ? danger : p.variant === "warn" ? warn : def}
          onClick={() => onAction(p.action, serial)}
        >
          {p.label}
        </button>
      ))}
      {primary.length > 0 && (
        <div className="mx-0.5 h-3.5 w-px flex-shrink-0 bg-white/[0.08]" />
      )}
      <button
        className={history}
        title="View history"
        onClick={() => onAction("view-history", serial)}
      >
        <History size={11} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TracePoint icon mark — extracted so it renders in sidebar + mobile header
// Matches the brand sheet: navy circle, white radar arcs, orange location pin
// ---------------------------------------------------------------------------

function TPMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="flex-shrink-0"
    >
      <circle cx="18" cy="18" r="18" fill="#1B2B4B" />
      <path d="M18 6 A12 12 0 0 0 6 18"  stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.9"/>
      <path d="M18 10 A8 8 0 0 0 10 18"  stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.9"/>
      <path d="M18 14 A4 4 0 0 0 14 18"  stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.9"/>
      <path d="M18 6 A12 12 0 0 1 30 18" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.6"/>
      <path d="M18 10 A8 8 0 0 1 26 18"  stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.6"/>
      <line x1="9" y1="27" x2="25" y2="14" stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.7"/>
      <circle cx="18" cy="18" r="1.5" fill="white" opacity="0.9"/>
      <path d="M18 8.5 C15.5 8.5 13.5 10.5 13.5 13 C13.5 16.5 18 21.5 18 21.5 C18 21.5 22.5 16.5 22.5 13 C22.5 10.5 20.5 8.5 18 8.5Z" fill="#E8721C"/>
      <circle cx="18" cy="13" r="2" fill="white"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — identical to dashboard (logo + nav + profile card)
// Firearms Repository is marked active
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { label: "Dashboard",           href: "/",                  icon: LayoutDashboard, active: false },
  { label: "Firearms Repository", href: "/firearms",          icon: Crosshair,       active: true  },
  { label: "Off-Duty Firearms",   href: "/off-duty-firearms", icon: Shield,          active: false },
  { label: "Qualifications",      href: "/qualifications",    icon: ShieldCheck,     active: false },
  { label: "Range & Training",    href: "/range-days",        icon: CalendarRange,   active: false },
  { label: "Inspections",         href: "/inspections",       icon: ClipboardList,   active: false },
] as const;

function Sidebar() {
  return (
    <aside className="hidden w-60 flex-col border-r border-slate-800 bg-slate-900 lg:flex">

      {/* Logo + wordmark — matches dashboard exactly */}
      <div className="border-b border-slate-800 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <TPMark size={32} />
          <div>
            <div className="flex items-baseline">
              <span className="text-[16px] font-extrabold leading-none tracking-tight text-white">Trace</span>
              <span className="text-[16px] font-extrabold leading-none tracking-tight text-[#E8721C]">Point</span>
            </div>
            <p className="mt-0.5 text-[7.5px] font-semibold uppercase tracking-[0.14em] text-slate-600">
              Operational Accountability
            </p>
          </div>
        </div>
      </div>

      {/* Nav — same active-indicator pattern as dashboard */}
      <nav className="flex flex-col gap-0.5 p-3">
        <p className="mb-1 px-3 pt-1 text-[9px] font-semibold uppercase tracking-widest text-slate-700">
          Navigation
        </p>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition-all duration-150 ${
              item.active
                ? "bg-blue-600/12 text-blue-300"
                : "text-slate-500 hover:bg-slate-800/70 hover:text-slate-200"
            }`}
          >
            {item.active && (
              <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-blue-500" />
            )}
            <item.icon size={14} className={item.active ? "text-blue-400" : "text-slate-600"} />
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Footer profile/status card — matches dashboard */}
      <div className="mt-auto border-t border-slate-800 p-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-bold text-slate-300">
              JM
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold leading-none text-slate-200">Readington PD</p>
              <p className="mt-0.5 text-[10px] text-slate-600">Administrator</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 border-t border-slate-800/60 pt-2">
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
            <span className="text-[10px] font-medium text-slate-600">System Online</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function FirearmsRepository() {

  // State — unchanged
  const [search, setSearch]             = useState("");
  const [statusFilter, setStatusFilter] = useState<FirearmStatus | "">("");
  const [typeFilter, setTypeFilter]     = useState<FirearmType | "">("");

  // Handler — unchanged (wire to router/modal in production)
  const handleAction = (action: string, serial: string) => {
    console.log(`[TracePoint] action="${action}" serial="${serial}"`);
  };

  // Filtered list — unchanged logic
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return MOCK_FIREARMS.filter((f) => {
      const haystack = [f.serial, f.make, f.model, f.type, f.status, f.assignedTo ?? ""]
        .join(" ")
        .toLowerCase();
      return (
        (!q || haystack.includes(q)) &&
        (!statusFilter || f.status === statusFilter) &&
        (!typeFilter || f.type === typeFilter)
      );
    });
  }, [search, statusFilter, typeFilter]);

  // Stats — unchanged logic
  const stats = useMemo(() => ({
    total:       MOCK_FIREARMS.length,
    issued:      MOCK_FIREARMS.filter((f) => f.status === "Issued").length,
    armory:      MOCK_FIREARMS.filter((f) => f.status === "Armory").length,
    maintenance: MOCK_FIREARMS.filter((f) => f.status === "Maintenance").length,
    oos:         MOCK_FIREARMS.filter((f) => f.status === "OOS").length,
    missing:     MOCK_FIREARMS.filter((f) => f.status === "Missing/Lost").length,
  }), []);

  // Attention strip — derived from stats, each item filters the table on click
  const attention = [
    stats.oos     > 0 && { text: `${stats.oos} out of service`,               dot: "bg-orange-500", filter: "OOS"          as FirearmStatus },
    stats.missing > 0 && { text: `${stats.missing} missing / unaccounted`,    dot: "bg-red-500",    filter: "Missing/Lost" as FirearmStatus },
    stats.maintenance > 0 && { text: `${stats.maintenance} in maintenance`,   dot: "bg-amber-500",  filter: "Maintenance"  as FirearmStatus },
  ].filter(Boolean) as { text: string; dot: string; filter: FirearmStatus }[];

  // KPI card config — clicking sets statusFilter (same state as selects)
  const KPI_CARDS = [
    { label: "Total",          value: stats.total,       color: "text-slate-200",   sub: "All firearms",    filter: ""             as FirearmStatus | "" },
    { label: "Issued",         value: stats.issued,      color: "text-emerald-400", sub: "Active carry",    filter: "Issued"       as FirearmStatus },
    { label: "In Armory",      value: stats.armory,      color: "text-blue-400",    sub: "Available",       filter: "Armory"       as FirearmStatus },
    { label: "Maintenance",    value: stats.maintenance, color: "text-amber-400",   sub: "Service queue",   filter: "Maintenance"  as FirearmStatus },
    { label: "Out of Service", value: stats.oos,         color: "text-orange-400",  sub: "Non-operational", filter: "OOS"          as FirearmStatus },
    { label: "Missing",        value: stats.missing,     color: "text-red-400",     sub: "Unaccounted",     filter: "Missing/Lost" as FirearmStatus },
  ];

  return (
    <TracePointShell activePage="Firearms">
      <div className="space-y-5">

          {/* Page header — dashboard style */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">

              {/* Mobile logo — visible only when sidebar is hidden on small screens */}
              <div className="flex items-center gap-2.5 lg:hidden">
                <TPMark size={26} />
                <span className="text-[15px] font-extrabold text-white">
                  Trace<span className="text-[#E8721C]">Point</span>
                </span>
              </div>

              <div>
                <h1 className="text-[20px] font-bold leading-tight text-white">Firearms Repository</h1>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  Inventory status, assignments, and accountability.
                </p>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-700">
                  <span>{stats.total} tracked</span>
                  <span className="text-slate-800">·</span>
                  <span>{stats.issued} issued</span>
                  <span className="text-slate-800">·</span>
                  <span className={stats.oos > 0 ? "text-orange-600" : ""}>{stats.oos} OOS</span>
                </div>
              </div>

              <span className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-[11px] font-medium text-slate-400">
                Readington PD
              </span>
            </div>
          </div>

          {/* Dashboard content */}
          <div className="space-y-4">

            {/* KPI strip — dashboard card style, clicking filters the table */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {KPI_CARDS.map((card) => {
                const isActive = statusFilter === card.filter;
                return (
                  <button
                    key={card.label}
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
                    <p className={`mt-1 text-2xl font-bold leading-none ${card.color}`}>{card.value}</p>
                    <p className="mt-0.5 text-[10px] text-slate-600">{card.sub}</p>
                  </button>
                );
              })}
            </div>

            {/* Attention Required — manage by exception, each item filters on click */}
            {attention.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5">
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <AlertTriangle size={11} className="text-amber-500" />
                  <span className="text-[9.5px] font-semibold uppercase tracking-widest text-slate-500">
                    Attention Required
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {attention.map((item) => (
                    <button
                      key={item.text}
                      onClick={() => setStatusFilter(item.filter)}
                      className="flex items-center gap-1.5 text-[11.5px] text-slate-400 transition-colors hover:text-slate-200"
                    >
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${item.dot}`} />
                      {item.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Toolbar — search + filters left, utility actions + primary CTA right */}
            <div className="flex flex-wrap items-center gap-2">

              {/* Search — unchanged onChange */}
              <div className="relative min-w-[220px] flex-1 max-w-[320px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search serial, make, model, assigned to…"
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-[12px] text-white outline-none placeholder:text-slate-600 transition-colors focus:border-blue-500"
                />
              </div>

              {/* Status filter — unchanged onChange */}
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as FirearmStatus | "")}
                  className="appearance-none rounded-xl border border-slate-800 bg-slate-900 py-2 pl-3 pr-7 text-[12px] text-slate-400 outline-none transition-colors focus:border-blue-500 cursor-pointer"
                >
                  <option value="">All statuses</option>
                  <option value="Armory">Armory</option>
                  <option value="Issued">Issued</option>
                  <option value="OOS">OOS</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Missing/Lost">Missing / Lost</option>
                </select>
                <ChevronDown size={11} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
              </div>

              {/* Type filter — unchanged onChange */}
              <div className="relative">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as FirearmType | "")}
                  className="appearance-none rounded-xl border border-slate-800 bg-slate-900 py-2 pl-3 pr-7 text-[12px] text-slate-400 outline-none transition-colors focus:border-blue-500 cursor-pointer"
                >
                  <option value="">All types</option>
                  <option value="Pistol">Pistol</option>
                  <option value="Shotgun">Shotgun</option>
                  <option value="Rifle">Rifle</option>
                  <option value="Revolver">Revolver</option>
                </select>
                <ChevronDown size={11} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
              </div>

              <div className="flex-1" />

              {/* Right-side actions — unchanged onClick handlers */}
              <button
                onClick={() => handleAction("export", "")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-transparent px-3 py-2 text-[12px] text-slate-400 transition-all hover:border-slate-700 hover:bg-slate-800/60 hover:text-slate-200"
              >
                <Download size={12} />
                Export
              </button>
              <button
                onClick={() => handleAction("audit-log", "")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-transparent px-3 py-2 text-[12px] text-slate-400 transition-all hover:border-slate-700 hover:bg-slate-800/60 hover:text-slate-200"
              >
                <ClipboardList size={12} />
                Audit Log
              </button>
              <button
                onClick={() => handleAction("add-firearm", "")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-[12px] font-semibold text-white transition-all hover:bg-blue-500"
              >
                <Plus size={13} />
                Add Firearm
              </button>
            </div>

            {/* Table — architecture, columns, responsive classes, filtering all unchanged */}
            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-slate-900/80">
                    <tr>
                      {[
                        { label: "Serial No",   cls: "w-[12%]" },
                        { label: "Make",        cls: "w-[10%]" },
                        { label: "Model",       cls: "w-[14%]" },
                        { label: "Type",        cls: "w-[9%] hidden sm:table-cell" },
                        { label: "Caliber",     cls: "w-[7%] hidden md:table-cell" },
                        { label: "Status",      cls: "w-[13%]" },
                        { label: "Assigned To", cls: "w-[20%]" },
                        { label: "",            cls: "w-[180px] text-right pr-4" },
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
                        <td colSpan={8} className="py-12 text-center text-[13px] text-slate-600">
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
                          <td className="hidden px-4 py-3 text-[12px] text-slate-400 sm:table-cell">
                            {firearm.type}
                          </td>
                          <td className="hidden px-4 py-3 text-[12px] text-slate-400 md:table-cell">
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

              {/* Table footer — pagination unchanged */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-slate-900/60 px-4 py-2.5 text-[11px] text-slate-600">
                <span>
                  {filtered.length === MOCK_FIREARMS.length
                    ? `Showing all ${MOCK_FIREARMS.length} records`
                    : `${filtered.length} of ${MOCK_FIREARMS.length} records`}
                </span>
                <div className="flex items-center gap-1">
                  {["‹", "1", "2", "›"].map((p, i) => (
                    <button
                      key={i}
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
            </div>

          </div>
      </div>
    </TracePointShell>
  );
}
