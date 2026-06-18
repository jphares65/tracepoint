"use client";

import TracePointShell from "@/components/TracePointShell";
import Link from "next/link";
import {
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Crosshair,
  FileText,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  XCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QualStatus = "Current" | "Due" | "Overdue" | "Failed";
type RifleStatus = "Current" | "Due" | "Overdue" | "N/A";
type ComplianceStatus = "Ready" | "At Risk" | "Non-Compliant";
type TrendDir = "Improving" | "Stable" | "Declining";

type TabId =
  | "current-cycle"
  | "history"
  | "rifle-fam"
  | "exceptions"
  | "trends";

type FilterPill =
  | "All"
  | "Due"
  | "Completed"
  | "Overdue"
  | "Rifle Familiarization"
  | "Failed"
  | "Remediation Required";

interface OfficerRecord {
  id: string;
  name: string;
  badge: string;
  rank: string;
  unit: string;
  dutyWeapon: string;
  lastQualDate: string;
  lastQualScore: number;
  dayScore: number;
  nightScore: number;
  qualStatus: QualStatus;
  rifleStatus: RifleStatus;
  compliance: ComplianceStatus;
  trend: TrendDir;
  cycle: string;
  remediation: boolean;
  notes?: string;
}

interface HistoryRecord {
  id: string;
  officer: string;
  badge: string;
  date: string;
  cycle: string;
  weapon: string;
  dayScore: number;
  ngtScore: number;
  result: "Pass" | "Fail";
  rangeMaster: string;
}

type KpiCardProps = {
  label: string;
  value: string | number;
  color: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  sub?: string;
};

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_OFFICERS: OfficerRecord[] = [
  {
    id: "o1",
    name: "Rivera, Miguel",
    badge: "1142",
    rank: "Sgt.",
    unit: "Patrol A",
    dutyWeapon: "Glock 17",
    lastQualDate: "2025-10-14",
    lastQualScore: 94,
    dayScore: 96,
    nightScore: 91,
    qualStatus: "Current",
    rifleStatus: "Current",
    compliance: "Ready",
    trend: "Improving",
    cycle: "Fall 2025",
    remediation: false,
  },
  {
    id: "o2",
    name: "Chen, David",
    badge: "3087",
    rank: "Off.",
    unit: "Patrol B",
    dutyWeapon: "Glock 19",
    lastQualDate: "2025-10-18",
    lastQualScore: 88,
    dayScore: 89,
    nightScore: 87,
    qualStatus: "Current",
    rifleStatus: "Due",
    compliance: "At Risk",
    trend: "Stable",
    cycle: "Fall 2025",
    remediation: false,
  },
  {
    id: "o3",
    name: "Patel, Arun",
    badge: "2201",
    rank: "Det.",
    unit: "CID",
    dutyWeapon: "Sig P320",
    lastQualDate: "2025-10-22",
    lastQualScore: 91,
    dayScore: 93,
    nightScore: 89,
    qualStatus: "Current",
    rifleStatus: "Current",
    compliance: "Ready",
    trend: "Stable",
    cycle: "Fall 2025",
    remediation: false,
  },
  {
    id: "o4",
    name: "Torres, Lucia",
    badge: "3312",
    rank: "Off.",
    unit: "Patrol C",
    dutyWeapon: "Glock 17",
    lastQualDate: "2025-04-09",
    lastQualScore: 76,
    dayScore: 78,
    nightScore: 74,
    qualStatus: "Due",
    rifleStatus: "Overdue",
    compliance: "At Risk",
    trend: "Declining",
    cycle: "Spring 2025",
    remediation: false,
  },
  {
    id: "o5",
    name: "Brooks, Catherine",
    badge: "0921",
    rank: "Lt.",
    unit: "Command",
    dutyWeapon: "Sig P226",
    lastQualDate: "2025-10-31",
    lastQualScore: 97,
    dayScore: 98,
    nightScore: 96,
    qualStatus: "Current",
    rifleStatus: "Current",
    compliance: "Ready",
    trend: "Improving",
    cycle: "Fall 2025",
    remediation: false,
  },
  {
    id: "o6",
    name: "Nguyen, Thomas",
    badge: "3088",
    rank: "Off.",
    unit: "Patrol A",
    dutyWeapon: "Sig P226",
    lastQualDate: "2025-04-15",
    lastQualScore: 69,
    dayScore: 70,
    nightScore: 68,
    qualStatus: "Failed",
    rifleStatus: "Overdue",
    compliance: "Non-Compliant",
    trend: "Declining",
    cycle: "Spring 2025",
    remediation: true,
    notes: "Missed remediation appointment 05/12.",
  },
  {
    id: "o7",
    name: "Walsh, Robert",
    badge: "4401",
    rank: "Off.",
    unit: "Patrol B",
    dutyWeapon: "Glock 19",
    lastQualDate: "2025-04-02",
    lastQualScore: 82,
    dayScore: 84,
    nightScore: 80,
    qualStatus: "Overdue",
    rifleStatus: "Due",
    compliance: "Non-Compliant",
    trend: "Declining",
    cycle: "Spring 2025",
    remediation: false,
  },
  {
    id: "o8",
    name: "Martinez, Karen",
    badge: "3091",
    rank: "Off.",
    unit: "Patrol C",
    dutyWeapon: "Glock 26",
    lastQualDate: "2025-10-08",
    lastQualScore: 85,
    dayScore: 87,
    nightScore: 83,
    qualStatus: "Current",
    rifleStatus: "Current",
    compliance: "Ready",
    trend: "Improving",
    cycle: "Fall 2025",
    remediation: false,
  },
  {
    id: "o9",
    name: "Okafor, Blessing",
    badge: "2418",
    rank: "Det.",
    unit: "CID",
    dutyWeapon: "Sig MCX",
    lastQualDate: "2025-10-21",
    lastQualScore: 93,
    dayScore: 94,
    nightScore: 92,
    qualStatus: "Current",
    rifleStatus: "Current",
    compliance: "Ready",
    trend: "Stable",
    cycle: "Fall 2025",
    remediation: false,
  },
  {
    id: "o10",
    name: "Smith, James",
    badge: "3102",
    rank: "Off.",
    unit: "Patrol A",
    dutyWeapon: "Glock 17",
    lastQualDate: "2025-03-28",
    lastQualScore: 71,
    dayScore: 73,
    nightScore: 69,
    qualStatus: "Overdue",
    rifleStatus: "Overdue",
    compliance: "Non-Compliant",
    trend: "Declining",
    cycle: "Spring 2025",
    remediation: false,
    notes: "Overdue Spring 2025 — no Fall qual recorded.",
  },
  {
    id: "o11",
    name: "Johnson, Mark",
    badge: "3205",
    rank: "Off.",
    unit: "Patrol B",
    dutyWeapon: "Glock 19",
    lastQualDate: "2025-10-11",
    lastQualScore: 79,
    dayScore: 81,
    nightScore: 77,
    qualStatus: "Current",
    rifleStatus: "Due",
    compliance: "At Risk",
    trend: "Stable",
    cycle: "Fall 2025",
    remediation: false,
  },
  {
    id: "o12",
    name: "Garcia, Elena",
    badge: "2890",
    rank: "Sgt.",
    unit: "Patrol C",
    dutyWeapon: "Sig P320",
    lastQualDate: "2025-10-19",
    lastQualScore: 90,
    dayScore: 91,
    nightScore: 89,
    qualStatus: "Current",
    rifleStatus: "Current",
    compliance: "Ready",
    trend: "Improving",
    cycle: "Fall 2025",
    remediation: false,
  },
];

const MOCK_HISTORY: HistoryRecord[] = [
  {
    id: "h1",
    officer: "Rivera, Miguel",
    badge: "1142",
    date: "2025-10-14",
    cycle: "Fall 2025",
    weapon: "Glock 17",
    dayScore: 96,
    ngtScore: 91,
    result: "Pass",
    rangeMaster: "Lt. Brooks",
  },
  {
    id: "h2",
    officer: "Rivera, Miguel",
    badge: "1142",
    date: "2025-04-10",
    cycle: "Spring 2025",
    weapon: "Glock 17",
    dayScore: 92,
    ngtScore: 88,
    result: "Pass",
    rangeMaster: "Sgt. Rivera",
  },
  {
    id: "h3",
    officer: "Chen, David",
    badge: "3087",
    date: "2025-10-18",
    cycle: "Fall 2025",
    weapon: "Glock 19",
    dayScore: 89,
    ngtScore: 87,
    result: "Pass",
    rangeMaster: "Lt. Brooks",
  },
  {
    id: "h4",
    officer: "Nguyen, Thomas",
    badge: "3088",
    date: "2025-04-15",
    cycle: "Spring 2025",
    weapon: "Sig P226",
    dayScore: 70,
    ngtScore: 68,
    result: "Fail",
    rangeMaster: "Sgt. Rivera",
  },
  {
    id: "h5",
    officer: "Walsh, Robert",
    badge: "4401",
    date: "2025-04-02",
    cycle: "Spring 2025",
    weapon: "Glock 19",
    dayScore: 84,
    ngtScore: 80,
    result: "Pass",
    rangeMaster: "Lt. Brooks",
  },
  {
    id: "h6",
    officer: "Smith, James",
    badge: "3102",
    date: "2025-03-28",
    cycle: "Spring 2025",
    weapon: "Glock 17",
    dayScore: 73,
    ngtScore: 69,
    result: "Pass",
    rangeMaster: "Sgt. Rivera",
  },
  {
    id: "h7",
    officer: "Brooks, Catherine",
    badge: "0921",
    date: "2025-10-31",
    cycle: "Fall 2025",
    weapon: "Sig P226",
    dayScore: 98,
    ngtScore: 96,
    result: "Pass",
    rangeMaster: "Lt. Brooks",
  },
  {
    id: "h8",
    officer: "Patel, Arun",
    badge: "2201",
    date: "2025-10-22",
    cycle: "Fall 2025",
    weapon: "Sig P320",
    dayScore: 93,
    ngtScore: 89,
    result: "Pass",
    rangeMaster: "Lt. Brooks",
  },
  {
    id: "h9",
    officer: "Torres, Lucia",
    badge: "3312",
    date: "2025-04-09",
    cycle: "Spring 2025",
    weapon: "Glock 17",
    dayScore: 78,
    ngtScore: 74,
    result: "Pass",
    rangeMaster: "Sgt. Rivera",
  },
  {
    id: "h10",
    officer: "Martinez, Karen",
    badge: "3091",
    date: "2025-10-08",
    cycle: "Fall 2025",
    weapon: "Glock 26",
    dayScore: 87,
    ngtScore: 83,
    result: "Pass",
    rangeMaster: "Lt. Brooks",
  },
];

const UNITS = [
  "All Units",
  "Patrol A",
  "Patrol B",
  "Patrol C",
  "CID",
  "Command",
] as const;

const QUAL_TYPES = ["All Types", "Pistol", "Rifle", "Shotgun"] as const;

const PASSING_SCORE = 70;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function scoreColor(score: number): string {
  if (score >= 90) return "text-emerald-400";
  if (score >= 80) return "text-blue-400";
  if (score >= 70) return "text-amber-400";
  return "text-red-400";
}

function getInitials(name: string): string {
  return name
    .split(",")
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .join("")
    .toUpperCase();
}

function getWeaponType(weapon: string): "Pistol" | "Rifle" | "Shotgun" {
  const normalized = weapon.toLowerCase();

  if (
    normalized.includes("rifle") ||
    normalized.includes("colt") ||
    normalized.includes("mcx") ||
    normalized.includes("le6920")
  ) {
    return "Rifle";
  }

  if (normalized.includes("870") || normalized.includes("shotgun")) {
    return "Shotgun";
  }

  return "Pistol";
}

function calcResult(day: string, night: string): "Pass" | "Fail" | null {
  const d = Number.parseInt(day, 10);
  const n = Number.parseInt(night, 10);

  if (!day || !night || Number.isNaN(d) || Number.isNaN(n)) {
    return null;
  }

  return d >= PASSING_SCORE && n >= PASSING_SCORE ? "Pass" : "Fail";
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function QualBadge({ status }: { status: QualStatus }) {
  const map: Record<QualStatus, { cls: string; dot: string }> = {
    Current: {
      cls: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
      dot: "bg-emerald-400",
    },
    Due: {
      cls: "border-amber-500/20 bg-amber-500/10 text-amber-400",
      dot: "bg-amber-400",
    },
    Overdue: {
      cls: "border-orange-500/20 bg-orange-500/10 text-orange-400",
      dot: "bg-orange-400",
    },
    Failed: {
      cls: "border-red-500/20 bg-red-500/10 text-red-400",
      dot: "bg-red-400",
    },
  };

  const s = map[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function RifleBadge({ status }: { status: RifleStatus }) {
  const map: Record<RifleStatus, string> = {
    Current: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    Due: "border-amber-500/20 bg-amber-500/10 text-amber-400",
    Overdue: "border-orange-500/20 bg-orange-500/10 text-orange-400",
    "N/A": "border-slate-500/20 bg-slate-500/10 text-slate-500",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[status]}`}
    >
      {status}
    </span>
  );
}

function ComplianceBadge({ status }: { status: ComplianceStatus }) {
  const map: Record<ComplianceStatus, { cls: string; icon: ReactNode }> = {
    Ready: {
      cls: "text-emerald-400",
      icon: <CheckCircle2 size={13} />,
    },
    "At Risk": {
      cls: "text-amber-400",
      icon: <AlertTriangle size={13} />,
    },
    "Non-Compliant": {
      cls: "text-red-400",
      icon: <XCircle size={13} />,
    },
  };

  const s = map[status];

  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${s.cls}`}>
      {s.icon}
      {status}
    </span>
  );
}

function TrendBadge({ trend }: { trend: TrendDir }) {
  const map: Record<TrendDir, { icon: ReactNode; cls: string }> = {
    Improving: {
      icon: <TrendingUp size={13} />,
      cls: "text-emerald-400",
    },
    Stable: {
      icon: <Minus size={13} />,
      cls: "text-slate-400",
    },
    Declining: {
      icon: <TrendingDown size={13} />,
      cls: "text-red-400",
    },
  };

  const s = map[trend];

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${s.cls}`}>
      {s.icon}
      {trend}
    </span>
  );
}

function ResultBadge({ result }: { result: "Pass" | "Fail" }) {
  return result === "Pass" ? (
    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
      Pass
    </span>
  ) : (
    <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400">
      Fail
    </span>
  );
}

// ---------------------------------------------------------------------------
// Individual Qualification Modal
// ---------------------------------------------------------------------------

function IndividualQualModal({ onClose }: { onClose: () => void }) {
  const [officer, setOfficer] = useState("");
  const [weapon, setWeapon] = useState("");
  const [day, setDay] = useState("");
  const [night, setNight] = useState("");
  const [notes, setNotes] = useState("");

  const result = calcResult(day, night);
  const dayFail = day !== "" && Number.parseInt(day, 10) < PASSING_SCORE;
  const nightFail = night !== "" && Number.parseInt(night, 10) < PASSING_SCORE;
  const canSave = Boolean(officer && weapon && day && night);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h3 className="font-bold text-white">
              Record Individual Qualification
            </h3>

            <p className="mt-0.5 text-[11px] text-slate-500">
              For makeup quals and administrative entries only.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-4 mt-4 flex items-start gap-2 rounded-xl border border-blue-500/20 bg-blue-500/[0.05] px-4 py-3 sm:mx-6">
            <Crosshair
              size={13}
              className="mt-0.5 flex-shrink-0 text-blue-400"
            />

            <p className="text-[11px] leading-relaxed text-slate-400">
              Scoring a full Range Day?{" "}
              <Link
                href="/range-days"
                className="font-medium text-blue-400 underline underline-offset-2 hover:text-blue-300"
              >
                Go to Range &amp; Training
              </Link>{" "}
              and use the{" "}
              <span className="font-medium text-white">Score Range Day</span>{" "}
              tab for batch scoring.
            </p>
          </div>

          <div className="space-y-4 px-4 py-5 sm:px-6">
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Officer
              </label>

              <select
                value={officer}
                onChange={(e) => setOfficer(e.target.value)}
                className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white outline-none transition focus:border-blue-500"
              >
                <option value="">Select officer...</option>
                {MOCK_OFFICERS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.rank} {o.name} #{o.badge}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Weapon
              </label>

              <select
                value={weapon}
                onChange={(e) => setWeapon(e.target.value)}
                className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white outline-none transition focus:border-blue-500"
              >
                <option value="">Select weapon...</option>
                {[
                  "Glock 17",
                  "Glock 19",
                  "Glock 26",
                  "Sig P320",
                  "Sig P226",
                  "Colt LE6920",
                  "Remington 870",
                ].map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Day Score
                </label>

                <input
                  type="number"
                  min="0"
                  max="100"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  placeholder="0–100"
                  className={`w-full rounded-xl border px-4 py-2.5 text-center text-xl font-bold outline-none transition ${
                    dayFail
                      ? "border-red-500/50 bg-red-500/10 text-red-400"
                      : "border-slate-700 bg-slate-800 text-white focus:border-blue-500"
                  }`}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  Night Score
                </label>

                <input
                  type="number"
                  min="0"
                  max="100"
                  value={night}
                  onChange={(e) => setNight(e.target.value)}
                  placeholder="0–100"
                  className={`w-full rounded-xl border px-4 py-2.5 text-center text-xl font-bold outline-none transition ${
                    nightFail
                      ? "border-red-500/50 bg-red-500/10 text-red-400"
                      : "border-slate-700 bg-slate-800 text-white focus:border-blue-500"
                  }`}
                />
              </div>
            </div>

            {result && (
              <div
                className={`rounded-xl border px-4 py-3 text-center text-sm font-semibold ${
                  result === "Pass"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-red-500/30 bg-red-500/10 text-red-400"
                }`}
              >
                {result === "Pass" ? "✓ Pass" : "✗ Fail"} — auto-calculated ·
                passing score {PASSING_SCORE}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Notes
              </label>

              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason for individual entry, observations..."
                className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 transition hover:border-slate-600 hover:text-white"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={!canSave}
            onClick={onClose}
            className={`rounded-xl px-5 py-2 text-sm font-semibold transition ${
              canSave
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "cursor-not-allowed bg-slate-800 text-slate-600"
            }`}
          >
            Save Qualification
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function KpiCard({ label, value, color, icon: Icon, sub }: KpiCardProps) {
  return (
    <div className="group cursor-default rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 transition-all duration-200 hover:-translate-y-px hover:border-blue-500/25 hover:bg-slate-800/70 hover:shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 transition-colors group-hover:text-slate-500">
          {label}
        </p>

        <Icon size={14} className={color} />
      </div>

      <p className={`mt-1 text-2xl font-bold leading-none ${color}`}>
        {value}
      </p>

      {sub && <p className="mt-0.5 text-[10px] text-slate-600">{sub}</p>}
    </div>
  );
}

function OfficerCard({ officer }: { officer: OfficerRecord }) {
  return (
    <article
      className={`rounded-2xl border bg-slate-900 p-4 ${
        officer.compliance === "Non-Compliant"
          ? "border-red-500/25"
          : "border-slate-800"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-slate-400">
            {getInitials(officer.name)}
          </div>

          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold text-white">
              {officer.rank} {officer.name}
            </h3>

            <p className="mt-0.5 text-[11px] text-slate-500">
              #{officer.badge} · {officer.unit}
            </p>
          </div>
        </div>

        <QualBadge status={officer.qualStatus} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
            Duty Weapon
          </p>

          <p className="mt-1 text-[12px] text-slate-300">
            {officer.dutyWeapon}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
            Last Qual
          </p>

          <p className="mt-1 text-[12px] text-slate-300">
            {formatDate(officer.lastQualDate)}
          </p>

          <p className="mt-0.5 text-[10px] text-slate-600">{officer.cycle}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <RifleBadge status={officer.rifleStatus} />

        <span
          className={`rounded-full border border-slate-800 bg-slate-950/40 px-2.5 py-0.5 font-mono text-[11px] font-semibold ${scoreColor(
            officer.lastQualScore,
          )}`}
        >
          Score {officer.lastQualScore}
        </span>

        <TrendBadge trend={officer.trend} />
      </div>

      <div className="mt-3 border-t border-slate-800 pt-3">
        <ComplianceBadge status={officer.compliance} />
      </div>

      {officer.notes && (
        <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-3 py-2 text-[11px] leading-relaxed text-red-300/80">
          {officer.notes}
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Current Cycle tab
// ---------------------------------------------------------------------------

function CurrentCycleTab() {
  const [pill, setPill] = useState<FilterPill>("All");
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState<(typeof UNITS)[number]>("All Units");
  const [qualType, setQualType] =
    useState<(typeof QUAL_TYPES)[number]>("All Types");

  const filtered = useMemo(() => {
    return MOCK_OFFICERS.filter((o) => {
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        `${o.name} ${o.badge} ${o.unit} ${o.dutyWeapon}`
          .toLowerCase()
          .includes(q);

      const matchUnit = unit === "All Units" || o.unit === unit;
      const matchQualType =
        qualType === "All Types" || getWeaponType(o.dutyWeapon) === qualType;

      let matchPill = true;

      if (pill === "Due") matchPill = o.qualStatus === "Due";
      if (pill === "Completed") matchPill = o.qualStatus === "Current";
      if (pill === "Overdue") matchPill = o.qualStatus === "Overdue";
      if (pill === "Rifle Familiarization") {
        matchPill = o.rifleStatus === "Due" || o.rifleStatus === "Overdue";
      }
      if (pill === "Failed") matchPill = o.qualStatus === "Failed";
      if (pill === "Remediation Required") matchPill = o.remediation;

      return matchSearch && matchUnit && matchQualType && matchPill;
    });
  }, [search, unit, qualType, pill]);

  const pills: FilterPill[] = [
    "All",
    "Due",
    "Completed",
    "Overdue",
    "Rifle Familiarization",
    "Failed",
    "Remediation Required",
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {pills.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPill(p)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
              pill === p
                ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="relative w-full xl:max-w-md">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            />

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search officer, badge, unit, weapon..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 py-2 pl-9 pr-3 text-[12px] text-white outline-none transition placeholder:text-slate-600 focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:flex">
            <div className="relative">
              <select
                value={unit}
                onChange={(e) =>
                  setUnit(e.target.value as (typeof UNITS)[number])
                }
                className="w-full cursor-pointer appearance-none rounded-xl border border-slate-800 bg-slate-950/60 py-2 pl-3 pr-8 text-[12px] text-slate-400 outline-none transition focus:border-blue-500 xl:w-[145px]"
              >
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>

              <ChevronDown
                size={11}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600"
              />
            </div>

            <div className="relative">
              <select
                value={qualType}
                onChange={(e) =>
                  setQualType(e.target.value as (typeof QUAL_TYPES)[number])
                }
                className="w-full cursor-pointer appearance-none rounded-xl border border-slate-800 bg-slate-950/60 py-2 pl-3 pr-8 text-[12px] text-slate-400 outline-none transition focus:border-blue-500 xl:w-[135px]"
              >
                {QUAL_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>

              <ChevronDown
                size={11}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600"
              />
            </div>
          </div>

          <div className="flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-600 xl:ml-auto">
            {filtered.length} of {MOCK_OFFICERS.length} officers
          </div>
        </div>
      </div>

      <div className="space-y-2 xl:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-10 text-center text-[13px] text-slate-600">
            No officers match current filters.
          </div>
        ) : (
          filtered.map((o) => <OfficerCard key={o.id} officer={o} />)
        )}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 xl:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
            <thead className="bg-slate-900/80 text-[10px] uppercase tracking-widest text-slate-600">
              <tr>
                <th className="px-4 py-3">Officer</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3">Duty Weapon</th>
                <th className="px-4 py-3">Last Qual</th>
                <th className="px-4 py-3">Cycle Status</th>
                <th className="px-4 py-3">Rifle Fam.</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Trend</th>
                <th className="px-4 py-3">Compliance</th>
                <th className="w-8 px-4 py-3" />
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800">
              {filtered.map((o) => (
                <tr
                  key={o.id}
                  className={`cursor-pointer transition-colors hover:bg-slate-800/60 ${
                    o.compliance === "Non-Compliant"
                      ? "border-l-2 border-l-red-500/40"
                      : ""
                  }`}
                >
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-white">
                      {o.rank} {o.name}
                    </p>

                    <p className="text-[11px] text-slate-500">#{o.badge}</p>
                  </td>

                  <td className="px-4 py-3.5 text-slate-400">{o.unit}</td>

                  <td className="px-4 py-3.5 text-slate-400">
                    {o.dutyWeapon}
                  </td>

                  <td className="px-4 py-3.5">
                    <p className="text-slate-300">
                      {formatDate(o.lastQualDate)}
                    </p>

                    <p className="text-[11px] text-slate-600">{o.cycle}</p>
                  </td>

                  <td className="px-4 py-3.5">
                    <QualBadge status={o.qualStatus} />
                  </td>

                  <td className="px-4 py-3.5">
                    <RifleBadge status={o.rifleStatus} />
                  </td>

                  <td className="px-4 py-3.5">
                    <span
                      className={`font-mono font-semibold ${scoreColor(
                        o.lastQualScore,
                      )}`}
                    >
                      {o.lastQualScore}
                    </span>
                  </td>

                  <td className="px-4 py-3.5">
                    <TrendBadge trend={o.trend} />
                  </td>

                  <td className="px-4 py-3.5">
                    <ComplianceBadge status={o.compliance} />
                  </td>

                  <td className="px-4 py-3.5 text-slate-600">
                    <ChevronRight size={14} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-600">
            No officers match current filters.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Qualification History tab
// ---------------------------------------------------------------------------

function HistoryTab() {
  return (
    <div>
      <div className="space-y-2 xl:hidden">
        {MOCK_HISTORY.map((h) => (
          <article
            key={h.id}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-semibold text-white">
                  {h.officer}
                </h3>

                <p className="mt-0.5 text-[11px] text-slate-500">
                  #{h.badge} · {h.cycle}
                </p>
              </div>

              <ResultBadge result={h.result} />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                  Date
                </p>

                <p className="mt-1 text-[12px] text-slate-300">
                  {formatDate(h.date)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                  Weapon
                </p>

                <p className="mt-1 text-[12px] text-slate-300">{h.weapon}</p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border border-slate-800 bg-slate-950/40 px-2.5 py-0.5 font-mono text-[11px] font-semibold ${scoreColor(
                  h.dayScore,
                )}`}
              >
                Day {h.dayScore}
              </span>

              <span
                className={`rounded-full border border-slate-800 bg-slate-950/40 px-2.5 py-0.5 font-mono text-[11px] font-semibold ${scoreColor(
                  h.ngtScore,
                )}`}
              >
                Night {h.ngtScore}
              </span>

              <span className="text-[11px] text-slate-500">
                RM: {h.rangeMaster}
              </span>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 xl:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="bg-slate-900/80 text-[10px] uppercase tracking-widest text-slate-600">
              <tr>
                <th className="px-4 py-3">Officer</th>
                <th className="px-4 py-3">Cycle</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Weapon</th>
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3">Night</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Range Master</th>
                <th className="w-8 px-4 py-3" />
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800">
              {MOCK_HISTORY.map((h) => (
                <tr
                  key={h.id}
                  className="cursor-pointer transition-colors hover:bg-slate-800/60"
                >
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-white">{h.officer}</p>
                    <p className="text-[11px] text-slate-500">#{h.badge}</p>
                  </td>

                  <td className="px-4 py-3.5">
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-[10px] font-medium text-slate-400">
                      {h.cycle}
                    </span>
                  </td>

                  <td className="px-4 py-3.5 text-slate-400">
                    {formatDate(h.date)}
                  </td>

                  <td className="px-4 py-3.5 text-slate-400">{h.weapon}</td>

                  <td className="px-4 py-3.5 font-mono font-semibold">
                    <span className={scoreColor(h.dayScore)}>{h.dayScore}</span>
                  </td>

                  <td className="px-4 py-3.5 font-mono font-semibold">
                    <span className={scoreColor(h.ngtScore)}>{h.ngtScore}</span>
                  </td>

                  <td className="px-4 py-3.5">
                    <ResultBadge result={h.result} />
                  </td>

                  <td className="px-4 py-3.5 text-slate-400">
                    {h.rangeMaster}
                  </td>

                  <td className="px-4 py-3.5 text-slate-600">
                    <ChevronRight size={14} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rifle Familiarization tab
// ---------------------------------------------------------------------------

function RifleFamTab() {
  const rifleOfficers = MOCK_OFFICERS.filter((o) => o.rifleStatus !== "N/A");

  const summary = [
    {
      label: "Current",
      count: rifleOfficers.filter((o) => o.rifleStatus === "Current").length,
      color: "text-emerald-400",
    },
    {
      label: "Due",
      count: rifleOfficers.filter((o) => o.rifleStatus === "Due").length,
      color: "text-amber-400",
    },
    {
      label: "Overdue",
      count: rifleOfficers.filter((o) => o.rifleStatus === "Overdue").length,
      color: "text-orange-400",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        {summary.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              {s.label}
            </p>

            <p className={`mt-1 text-2xl font-bold leading-none ${s.color}`}>
              {s.count}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-2 xl:hidden">
        {rifleOfficers.map((o) => (
          <article
            key={o.id}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-semibold text-white">
                  {o.rank} {o.name}
                </h3>

                <p className="mt-0.5 text-[11px] text-slate-500">
                  #{o.badge} · {o.unit}
                </p>
              </div>

              <RifleBadge status={o.rifleStatus} />
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                  Assigned Rifle
                </p>

                <p className="mt-1 text-[12px] text-slate-300">Colt LE6920</p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                  Last Familiarization
                </p>

                <p className="mt-1 text-[12px] text-slate-300">
                  {formatDate(o.lastQualDate)}
                </p>
              </div>
            </div>

            <div className="mt-3 border-t border-slate-800 pt-3">
              <ComplianceBadge status={o.compliance} />
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 xl:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="bg-slate-900/80 text-[10px] uppercase tracking-widest text-slate-600">
              <tr>
                <th className="px-4 py-3">Officer</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3">Assigned Rifle</th>
                <th className="px-4 py-3">Last Familiarization</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Compliance</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800">
              {rifleOfficers.map((o) => (
                <tr
                  key={o.id}
                  className="cursor-pointer transition-colors hover:bg-slate-800/60"
                >
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-white">
                      {o.rank} {o.name}
                    </p>
                    <p className="text-[11px] text-slate-500">#{o.badge}</p>
                  </td>

                  <td className="px-4 py-3.5 text-slate-400">{o.unit}</td>

                  <td className="px-4 py-3.5 text-slate-400">Colt LE6920</td>

                  <td className="px-4 py-3.5 text-slate-400">
                    {formatDate(o.lastQualDate)}
                  </td>

                  <td className="px-4 py-3.5">
                    <RifleBadge status={o.rifleStatus} />
                  </td>

                  <td className="px-4 py-3.5">
                    <ComplianceBadge status={o.compliance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exceptions tab
// ---------------------------------------------------------------------------

function ExceptionRow({
  officer,
  tone,
}: {
  officer: OfficerRecord;
  tone: "red" | "orange" | "amber";
}) {
  const toneClasses = {
    red: "border-red-500/20 bg-red-500/[0.04] hover:bg-red-500/[0.07]",
    orange:
      "border-orange-500/20 bg-orange-500/[0.04] hover:bg-orange-500/[0.07]",
    amber:
      "border-amber-500/20 bg-amber-500/[0.04] hover:bg-amber-500/[0.07]",
  };

  return (
    <div
      className={`flex cursor-pointer flex-col gap-3 rounded-2xl border px-4 py-4 transition-colors sm:flex-row sm:items-start sm:justify-between sm:px-5 ${toneClasses[tone]}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-950/40 text-[11px] font-bold text-slate-300">
          {getInitials(officer.name)}
        </div>

        <div className="min-w-0">
          <p className="font-semibold text-white">
            {officer.rank} {officer.name}{" "}
            <span className="font-normal text-slate-500">#{officer.badge}</span>
          </p>

          <p className="mt-0.5 text-[12px] text-slate-400">
            {officer.unit} · {officer.dutyWeapon}
          </p>

          {officer.notes && (
            <p className="mt-1.5 text-[11px] italic text-slate-300/70">
              {officer.notes}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-end">
        <QualBadge status={officer.qualStatus} />
        <RifleBadge status={officer.rifleStatus} />

        {officer.remediation && (
          <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-red-400">
            Remediation Required
          </span>
        )}
      </div>
    </div>
  );
}

function ExceptionsTab() {
  const exceptions = MOCK_OFFICERS.filter(
    (o) => o.compliance !== "Ready" || o.remediation,
  );

  const nonCompliant = exceptions.filter(
    (o) => o.compliance === "Non-Compliant",
  );

  const atRisk = exceptions.filter((o) => o.compliance === "At Risk");
  const remediation = exceptions.filter((o) => o.remediation);

  return (
    <div className="space-y-6">
      {nonCompliant.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <XCircle size={15} className="text-red-400" />

            <h3 className="text-sm font-semibold uppercase tracking-wide text-red-400">
              Non-Compliant ({nonCompliant.length})
            </h3>
          </div>

          <div className="space-y-2">
            {nonCompliant.map((o) => (
              <ExceptionRow key={o.id} officer={o} tone="red" />
            ))}
          </div>
        </section>
      )}

      {remediation.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle size={15} className="text-orange-400" />

            <h3 className="text-sm font-semibold uppercase tracking-wide text-orange-400">
              Remediation Required ({remediation.length})
            </h3>
          </div>

          <div className="space-y-2">
            {remediation.map((o) => (
              <ExceptionRow key={o.id} officer={o} tone="orange" />
            ))}
          </div>
        </section>
      )}

      {atRisk.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" />

            <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-400">
              At Risk ({atRisk.length})
            </h3>
          </div>

          <div className="space-y-2">
            {atRisk.map((o) => (
              <ExceptionRow key={o.id} officer={o} tone="amber" />
            ))}
          </div>
        </section>
      )}

      {exceptions.length === 0 && (
        <div className="py-16 text-center">
          <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-400" />

          <p className="font-medium text-slate-400">
            No exceptions — all officers compliant.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance Trends tab
// ---------------------------------------------------------------------------

function TrendsTab() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const avgScores = [84, 86, 83, 88, 90, 0];
  const passRates = [91, 93, 88, 95, 97, 0];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: "Avg. Score YTD",
            value: "88.2",
            sub: "All officers",
            color: "text-blue-400",
            icon: Target,
          },
          {
            label: "Pass Rate YTD",
            value: "94%",
            sub: "Spring + Fall 2025",
            color: "text-emerald-400",
            icon: ShieldCheck,
          },
          {
            label: "Officers Improved",
            value: "7",
            sub: "vs. last cycle",
            color: "text-violet-400",
            icon: TrendingUp,
          },
          {
            label: "Failed This Cycle",
            value: "2",
            sub: "Remediation pending",
            color: "text-red-400",
            icon: XCircle,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
          >
            <div className="mb-2 flex items-center gap-1.5">
              <s.icon size={13} className={s.color} />

              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                {s.label}
              </span>
            </div>

            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="mt-0.5 text-[11px] text-slate-600">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 2xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <p className="mb-5 text-sm font-semibold text-white">
            Average Qualification Score — 2026
          </p>

          <div className="flex items-end gap-2 sm:gap-3" style={{ height: 120 }}>
            {months.map((m, i) => {
              const val = avgScores[i];
              const pct = val ? ((val - 60) / 40) * 100 : 0;
              const upcoming = val === 0;

              return (
                <div key={m} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[11px] font-medium text-slate-400">
                    {upcoming ? "—" : val}
                  </span>

                  <div className="relative w-full" style={{ height: 90 }}>
                    <div
                      className={`absolute bottom-0 w-full rounded-t-sm transition-all ${
                        upcoming
                          ? "border border-dashed border-slate-700 bg-transparent"
                          : "bg-blue-500/70"
                      }`}
                      style={{ height: upcoming ? "100%" : `${pct}%` }}
                    />
                  </div>

                  <span className="text-[10px] text-slate-600">{m}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <p className="mb-4 text-sm font-semibold text-white">
            Pass Rate by Month — 2026
          </p>

          <div className="space-y-2.5">
            {months.map((m, i) => (
              <div key={m} className="flex items-center gap-3">
                <span className="w-7 flex-shrink-0 text-[11px] text-slate-600">
                  {m}
                </span>

                <div className="flex flex-1 items-center gap-2">
                  <div
                    className="flex flex-1 overflow-hidden rounded-full bg-white/[0.04]"
                    style={{ height: 8 }}
                  >
                    <div
                      className="rounded-full bg-emerald-500/70"
                      style={{ width: `${passRates[i]}%` }}
                    />
                  </div>

                  <span className="w-8 text-right text-[11px] font-medium text-slate-400">
                    {passRates[i] ? `${passRates[i]}%` : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
        <p className="mb-4 text-sm font-semibold text-white">
          Score Distribution — Current Officers
        </p>

        <div className="space-y-2.5">
          {[
            {
              range: "90–100",
              label: "Distinguished",
              count: MOCK_OFFICERS.filter((o) => o.lastQualScore >= 90).length,
              color: "bg-emerald-500/70",
            },
            {
              range: "80–89",
              label: "Proficient",
              count: MOCK_OFFICERS.filter(
                (o) => o.lastQualScore >= 80 && o.lastQualScore < 90,
              ).length,
              color: "bg-blue-500/70",
            },
            {
              range: "70–79",
              label: "Passing",
              count: MOCK_OFFICERS.filter(
                (o) => o.lastQualScore >= 70 && o.lastQualScore < 80,
              ).length,
              color: "bg-amber-500/70",
            },
            {
              range: "Below 70",
              label: "Failing",
              count: MOCK_OFFICERS.filter((o) => o.lastQualScore < 70).length,
              color: "bg-red-500/70",
            },
          ].map((row) => (
            <div
              key={row.range}
              className="grid grid-cols-1 gap-1 sm:grid-cols-[180px_1fr] sm:items-center sm:gap-3"
            >
              <span className="text-[11px] text-slate-500">
                {row.range}{" "}
                <span className="hidden text-slate-700 sm:inline">
                  ({row.label})
                </span>
              </span>

              <div className="flex flex-1 items-center gap-2">
                <div
                  className="flex flex-1 overflow-hidden rounded-full bg-white/[0.04]"
                  style={{ height: 8 }}
                >
                  <div
                    className={`rounded-full ${row.color}`}
                    style={{
                      width: `${(row.count / MOCK_OFFICERS.length) * 100}%`,
                    }}
                  />
                </div>

                <span className="w-5 text-right text-[11px] font-medium text-slate-400">
                  {row.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS: {
  id: TabId;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}[] = [
  {
    id: "current-cycle",
    label: "Current Cycle",
    icon: ShieldCheck,
  },
  {
    id: "history",
    label: "Qualification History",
    icon: BookOpen,
  },
  {
    id: "rifle-fam",
    label: "Rifle Familiarization",
    icon: Crosshair,
  },
  {
    id: "exceptions",
    label: "Exceptions",
    icon: AlertTriangle,
  },
  {
    id: "trends",
    label: "Performance Trends",
    icon: BarChart3,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function QualificationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("current-cycle");
  const [showIndivModal, setShowIndivModal] = useState(false);

  const ready = MOCK_OFFICERS.filter((o) => o.compliance === "Ready").length;
  const total = MOCK_OFFICERS.length;
  const readinessPct = Math.round((ready / total) * 100);
  const dueCount = MOCK_OFFICERS.filter((o) => o.qualStatus === "Due").length;
  const rifleDueCount = MOCK_OFFICERS.filter(
    (o) => o.rifleStatus === "Due" || o.rifleStatus === "Overdue",
  ).length;
  const failedCount = MOCK_OFFICERS.filter(
    (o) => o.qualStatus === "Failed",
  ).length;
  const remediationCount = MOCK_OFFICERS.filter((o) => o.remediation).length;

  return (
    <TracePointShell activePage="Qualifications">
      {showIndivModal && (
        <IndividualQualModal onClose={() => setShowIndivModal(false)} />
      )}

      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold leading-tight text-white sm:text-[22px]">
                Qualifications
              </h1>

              <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-slate-500">
                Cycle status, rifle familiarization, exceptions, and performance
                history.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-700">
                <span>Updated 2 min ago</span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span>{dueCount} qualifications due this cycle</span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                  System Healthy
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <span className="inline-flex justify-center rounded-full border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-[12px] font-semibold text-blue-300">
                Spring 2026
              </span>

              <button
                type="button"
                onClick={() => setActiveTab("current-cycle")}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-500"
              >
                <ShieldCheck size={15} />
                Current Cycle
              </button>
            </div>
          </div>
        </header>

        <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 text-[11px] font-medium text-slate-400">
              <CalendarDays size={11} className="mr-1.5 inline -mt-0.5" />
              Current Cycle:{" "}
              <span className="font-semibold text-white">Spring 2026</span>
            </span>

            <span className="rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 text-[11px] font-medium text-slate-400">
              Previous: <span className="text-slate-300">Fall 2025</span>
            </span>

            <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] font-medium text-blue-400">
              Cycle window: Mar 1 – Jun 30, 2026
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 xl:flex xl:items-center">
            <button
              type="button"
              onClick={() => setActiveTab("exceptions")}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 px-3 py-2 text-[12px] font-medium text-slate-400 transition hover:border-blue-500/50 hover:bg-slate-800/70 hover:text-white"
            >
              <AlertTriangle size={13} />
              Exceptions
            </button>

            <button
              type="button"
              onClick={() => setShowIndivModal(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-800 px-3 py-2 text-[12px] font-medium text-slate-400 transition hover:border-blue-500/50 hover:bg-slate-800/70 hover:text-white"
              title="For makeup quals and administrative entries only"
            >
              <Plus size={13} />
              Individual Qual
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 md:flex-row md:items-center">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-blue-500/15">
            <Crosshair size={13} className="text-blue-400" />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <span className="font-medium text-slate-300">
              Primary scoring workflow:
            </span>

            <div className="flex flex-wrap items-center gap-2 text-slate-500">
              <Link
                href="/range-days"
                className="font-medium text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
              >
                Range &amp; Training
              </Link>

              <ChevronRight size={11} />
              <span>Range Day</span>
              <ChevronRight size={11} />
              <span className="font-medium text-white">Score Range Day</span>
              <ChevronRight size={11} />
              <span>Records auto-generated here</span>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="Readiness"
            value={`${readinessPct}%`}
            color="text-emerald-400"
            icon={ShieldCheck}
            sub={`${ready} of ${total} ready`}
          />

          <KpiCard
            label="Quals Due"
            value={dueCount}
            color="text-amber-400"
            icon={Clock}
            sub="Spring cycle"
          />

          <KpiCard
            label="Rifle Fam Due"
            value={rifleDueCount}
            color="text-orange-400"
            icon={Crosshair}
            sub="Due or overdue"
          />

          <KpiCard
            label="Failed Quals"
            value={failedCount}
            color="text-red-400"
            icon={XCircle}
            sub="This cycle"
          />

          <KpiCard
            label="Remediation"
            value={remediationCount}
            color="text-red-400"
            icon={AlertTriangle}
            sub="Pending action"
          />

          <KpiCard
            label="Cycle Completion"
            value="84%"
            color="text-blue-400"
            icon={FileText}
            sub="Fall 2025 final"
          />
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-1.5">
          <div className="grid grid-cols-1 gap-1 min-[420px]:grid-cols-2 lg:grid-cols-5">
            {TABS.map((tab) => {
              const Icon = tab.icon;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[12px] font-medium transition ${
                    activeTab === tab.id
                      ? "bg-blue-600/90 text-white shadow-sm"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Icon
                    size={13}
                    className={
                      activeTab === tab.id ? "text-white" : "text-slate-600"
                    }
                  />

                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          {activeTab === "current-cycle" && <CurrentCycleTab />}
          {activeTab === "history" && <HistoryTab />}
          {activeTab === "rifle-fam" && <RifleFamTab />}
          {activeTab === "exceptions" && <ExceptionsTab />}
          {activeTab === "trends" && <TrendsTab />}
        </section>
      </div>
    </TracePointShell>
  );
}