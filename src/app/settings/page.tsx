"use client";

import { useState } from "react";
import {
  CalendarDays,
  Clock,
  MapPin,
  Shield,
  Users,
  Target,
  Plus,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  BookOpen,
  BarChart3,
  History,
  CircleDot,
  UserCheck,
  Crosshair,
  TrendingUp,
  Filter,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RangeDayStatus = "Draft" | "Scheduled" | "Completed";
type StaffingStatus = "Meets Policy" | "Understaffed";

interface Instructor {
  name: string;
  badgeNo: string;
}

interface Drill {
  id: string;
  name: string;
  category: string;
  rounds: number;
  completed?: boolean;
}

interface RangeDay {
  id: string;
  title: string;
  date: string;            // ISO date string
  time: string;            // e.g. "08:00 – 12:00"
  location: string;
  status: RangeDayStatus;
  rangeMaster: Instructor;
  instructors: Instructor[];
  officersAssigned: number;
  officersCompleted: number;
  drills: Drill[];
  requiredRatio: number;   // max officers per instructor (incl. range master)
}

interface DrillTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  rounds: number;
  durationMin: number;
  qualificationRelevant: boolean;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_RANGE_DAYS: RangeDay[] = [
  {
    id: "rd-001",
    title: "Q2 Qualification — Pistol",
    date: "2026-05-22",
    time: "07:00 – 13:00",
    location: "Flemington Indoor Range",
    status: "Scheduled",
    rangeMaster: { name: "Sgt. Rivera, M.", badgeNo: "1142" },
    instructors: [
      { name: "Det. Patel, A.",   badgeNo: "2201" },
      { name: "Off. Chen, D.",    badgeNo: "3087" },
    ],
    officersAssigned: 18,
    officersCompleted: 0,
    drills: [
      { id: "d1", name: "3-Yard Draw & Fire",     category: "Qualification", rounds: 12, completed: false },
      { id: "d2", name: "7-Yard Double Tap",      category: "Qualification", rounds: 12, completed: false },
      { id: "d3", name: "15-Yard Slow Fire",      category: "Qualification", rounds: 10, completed: false },
      { id: "d4", name: "Reload Under Pressure",  category: "Tactical",      rounds: 8,  completed: false },
    ],
    requiredRatio: 6,
  },
  {
    id: "rd-002",
    title: "Patrol Rifle Proficiency",
    date: "2026-05-29",
    time: "06:30 – 11:30",
    location: "Morris County Outdoor Range",
    status: "Scheduled",
    rangeMaster: { name: "Lt. Brooks, C.", badgeNo: "0921" },
    instructors: [
      { name: "Sgt. Rivera, M.", badgeNo: "1142" },
    ],
    officersAssigned: 14,
    officersCompleted: 0,
    drills: [
      { id: "d5", name: "50-Yard Zeroing",        category: "Proficiency", rounds: 20, completed: false },
      { id: "d6", name: "Transition Drill",        category: "Tactical",    rounds: 10, completed: false },
      { id: "d7", name: "Barricade Engagement",    category: "Tactical",    rounds: 12, completed: false },
    ],
    requiredRatio: 6,
  },
  {
    id: "rd-003",
    title: "Q1 Qualification — Pistol",
    date: "2026-03-14",
    time: "08:00 – 14:00",
    location: "Flemington Indoor Range",
    status: "Completed",
    rangeMaster: { name: "Sgt. Rivera, M.", badgeNo: "1142" },
    instructors: [
      { name: "Det. Patel, A.",   badgeNo: "2201" },
      { name: "Off. Torres, L.", badgeNo: "3312" },
    ],
    officersAssigned: 22,
    officersCompleted: 20,
    drills: [
      { id: "d8",  name: "3-Yard Draw & Fire",     category: "Qualification", rounds: 12, completed: true },
      { id: "d9",  name: "7-Yard Double Tap",      category: "Qualification", rounds: 12, completed: true },
      { id: "d10", name: "15-Yard Slow Fire",      category: "Qualification", rounds: 10, completed: true },
      { id: "d11", name: "Malfunction Clearance",  category: "Tactical",      rounds: 6,  completed: true },
    ],
    requiredRatio: 6,
  },
  {
    id: "rd-004",
    title: "Low-Light Tactics",
    date: "2026-04-03",
    time: "19:00 – 23:00",
    location: "Morris County Outdoor Range",
    status: "Completed",
    rangeMaster: { name: "Lt. Brooks, C.", badgeNo: "0921" },
    instructors: [
      { name: "Det. Okafor, B.", badgeNo: "2418" },
    ],
    officersAssigned: 10,
    officersCompleted: 10,
    drills: [
      { id: "d12", name: "Handheld Light Technique", category: "Tactical",    rounds: 15, completed: true },
      { id: "d13", name: "WML Engagement",            category: "Tactical",    rounds: 10, completed: true },
      { id: "d14", name: "Shoot / No-Shoot",          category: "Judgment",    rounds: 8,  completed: true },
    ],
    requiredRatio: 5,
  },
  {
    id: "rd-005",
    title: "New Hire Orientation — Pistol",
    date: "2026-06-10",
    time: "08:00 – 16:00",
    location: "Flemington Indoor Range",
    status: "Draft",
    rangeMaster: { name: "Sgt. Rivera, M.", badgeNo: "1142" },
    instructors: [],
    officersAssigned: 4,
    officersCompleted: 0,
    drills: [
      { id: "d15", name: "Safety Brief & Rules",   category: "Administrative", rounds: 0,  completed: false },
      { id: "d16", name: "Fundamentals Review",    category: "Proficiency",    rounds: 25, completed: false },
      { id: "d17", name: "Qual Course",            category: "Qualification",  rounds: 50, completed: false },
    ],
    requiredRatio: 6,
  },
];

const MOCK_DRILLS: DrillTemplate[] = [
  { id: "dt1",  name: "3-Yard Draw & Fire",       category: "Qualification", description: "Standard close-range qualification string. Two rounds from the holster at 3 yards.", rounds: 12, durationMin: 10, qualificationRelevant: true  },
  { id: "dt2",  name: "7-Yard Double Tap",         category: "Qualification", description: "Controlled pair to center mass at 7 yards, holster start.", rounds: 12, durationMin: 12, qualificationRelevant: true  },
  { id: "dt3",  name: "15-Yard Slow Fire",         category: "Qualification", description: "Accuracy string at 15 yards, freestyle stance.", rounds: 10, durationMin: 15, qualificationRelevant: true  },
  { id: "dt4",  name: "Reload Under Pressure",     category: "Tactical",      description: "Emergency reload after slide lock at 7 yards, target re-engagement.", rounds: 8,  durationMin: 10, qualificationRelevant: false },
  { id: "dt5",  name: "Malfunction Clearance",     category: "Tactical",      description: "Type I and Type II clearance drills with induced malfunctions.", rounds: 6,  durationMin: 15, qualificationRelevant: false },
  { id: "dt6",  name: "Barricade Engagement",      category: "Tactical",      description: "Strong and support side shooting from barricade cover at 10 yards.", rounds: 12, durationMin: 12, qualificationRelevant: false },
  { id: "dt7",  name: "Transition Drill",          category: "Tactical",      description: "Rifle to pistol transition on target at 10 yards.", rounds: 10, durationMin: 10, qualificationRelevant: false },
  { id: "dt8",  name: "Shoot / No-Shoot",          category: "Judgment",      description: "Mixed threat / non-threat target engagement. Decision-making under time pressure.", rounds: 8,  durationMin: 20, qualificationRelevant: false },
  { id: "dt9",  name: "50-Yard Zeroing",           category: "Proficiency",   description: "Rifle zero confirmation at 50 yards, 3-shot groups.", rounds: 20, durationMin: 20, qualificationRelevant: false },
  { id: "dt10", name: "WML Engagement",            category: "Tactical",      description: "Weapon-mounted light engagement in simulated low-light conditions.", rounds: 10, durationMin: 15, qualificationRelevant: false },
  { id: "dt11", name: "Handheld Light Technique",  category: "Tactical",      description: "Harries and Rogers/Surefire technique live fire.", rounds: 15, durationMin: 20, qualificationRelevant: false },
  { id: "dt12", name: "Fundamentals Review",       category: "Proficiency",   description: "Grip, stance, sight picture, trigger control — slow fire accuracy work.", rounds: 25, durationMin: 30, qualificationRelevant: false },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStaffingStatus(rd: RangeDay): StaffingStatus {
  const totalInstructors = 1 + rd.instructors.length; // range master + additional
  const capacity = totalInstructors * rd.requiredRatio;
  return rd.officersAssigned <= capacity ? "Meets Policy" : "Understaffed";
}

function getCompletionPct(rd: RangeDay): number {
  if (rd.officersAssigned === 0) return 0;
  if (rd.status === "Completed") {
    return Math.round((rd.officersCompleted / rd.officersAssigned) * 100);
  }
  return 0;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month:   "short",
    day:     "numeric",
    year:    "numeric",
  });
}

function getDrillCompletionPct(rd: RangeDay): number {
  if (rd.drills.length === 0) return 0;
  return Math.round(
    (rd.drills.filter((d) => d.completed).length / rd.drills.length) * 100
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  Qualification:  "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Tactical:       "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Judgment:       "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Proficiency:    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Administrative: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

function CategoryPill({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? "bg-slate-500/10 text-slate-400 border-slate-500/20";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {category}
    </span>
  );
}

function StatusBadge({ status }: { status: RangeDayStatus }) {
  const map: Record<RangeDayStatus, { dot: string; text: string; bg: string }> = {
    Draft:     { dot: "bg-slate-500",   text: "text-slate-400",   bg: "bg-slate-500/10 border-slate-500/20"  },
    Scheduled: { dot: "bg-blue-400",    text: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/20"    },
    Completed: { dot: "bg-emerald-400", text: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.bg} ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function StaffingBadge({ status }: { status: StaffingStatus }) {
  if (status === "Meets Policy") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
        <CheckCircle2 size={12} />
        Meets Policy
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
      <AlertTriangle size={12} />
      Understaffed
    </span>
  );
}

function ProgressBar({ pct, color = "bg-blue-500" }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Range Day Card
// ---------------------------------------------------------------------------

function RangeDayCard({ rd }: { rd: RangeDay }) {
  const staffing    = getStaffingStatus(rd);
  const completion  = getCompletionPct(rd);
  const drillPct    = getDrillCompletionPct(rd);
  const totalInstructors = 1 + rd.instructors.length;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#161b27] transition-colors duration-150 hover:border-white/[0.14] hover:bg-[#1a2030]">

      {/* Card header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={rd.status} />
            <StaffingBadge status={staffing} />
          </div>
          <h3 className="truncate text-[15px] font-semibold text-[#e8eaf0]">{rd.title}</h3>
        </div>
        <button className="mt-0.5 flex-shrink-0 rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-white/[0.06] hover:text-slate-300">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-1 gap-y-2 px-5 pb-4 sm:grid-cols-2">
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <CalendarDays size={12} className="flex-shrink-0 text-slate-600" />
          {formatDate(rd.date)}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <Clock size={12} className="flex-shrink-0 text-slate-600" />
          {rd.time}
        </div>
        <div className="flex items-center gap-2 text-[12px] text-slate-500 sm:col-span-2">
          <MapPin size={12} className="flex-shrink-0 text-slate-600" />
          {rd.location}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-5 border-t border-white/[0.06]" />

      {/* Staff & officers */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4">

        {/* Instructor column */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            Instructors
          </p>
          <div className="space-y-1.5">
            {/* Range Master */}
            <div className="flex items-center gap-2">
              <Shield size={11} className="flex-shrink-0 text-blue-400" />
              <span className="truncate text-[12px] text-slate-300">{rd.rangeMaster.name}</span>
              <span className="ml-auto flex-shrink-0 text-[10px] text-slate-600">RM</span>
            </div>
            {/* Additional instructors */}
            {rd.instructors.length > 0 ? (
              rd.instructors.map((inst) => (
                <div key={inst.badgeNo} className="flex items-center gap-2">
                  <UserCheck size={11} className="flex-shrink-0 text-slate-500" />
                  <span className="truncate text-[12px] text-slate-400">{inst.name}</span>
                </div>
              ))
            ) : (
              <p className="text-[11px] italic text-slate-600">No additional instructors</p>
            )}
          </div>

          {/* Ratio indicator */}
          <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2">
            <p className="text-[10px] text-slate-600">
              <span className="font-semibold text-slate-400">{totalInstructors}</span> instructor{totalInstructors !== 1 ? "s" : ""}
              {" · "}
              <span className="font-semibold text-slate-400">{rd.officersAssigned}</span> officers
              {" · "}
              1:{rd.requiredRatio} policy
            </p>
          </div>
        </div>

        {/* Officers & drills column */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            Officers / Drills
          </p>

          <div className="mb-3 flex items-center gap-2">
            <Users size={11} className="flex-shrink-0 text-slate-500" />
            <span className="text-[12px] text-slate-400">
              {rd.officersAssigned} officers assigned
            </span>
          </div>

          {rd.status === "Completed" && (
            <div className="mb-3">
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="text-slate-500">Officer completion</span>
                <span className="font-medium text-slate-300">{completion}%</span>
              </div>
              <ProgressBar
                pct={completion}
                color={completion === 100 ? "bg-emerald-500" : "bg-blue-500"}
              />
              <p className="mt-1 text-[10px] text-slate-600">
                {rd.officersCompleted} of {rd.officersAssigned} completed
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Target size={11} className="flex-shrink-0 text-slate-500" />
            <span className="text-[12px] text-slate-400">
              {rd.drills.length} drills planned
            </span>
          </div>

          {rd.status === "Completed" && (
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="text-slate-500">Drills completed</span>
                <span className="font-medium text-slate-300">{drillPct}%</span>
              </div>
              <ProgressBar
                pct={drillPct}
                color={drillPct === 100 ? "bg-emerald-500" : "bg-violet-500"}
              />
            </div>
          )}
        </div>
      </div>

      {/* Drill pills */}
      <div className="flex flex-wrap gap-1.5 px-5 pb-5">
        {rd.drills.map((d) => (
          <CategoryPill key={d.id} category={d.category} />
        ))}
      </div>

      {/* Alert stripe for understaffed */}
      {staffing === "Understaffed" && rd.status !== "Completed" && (
        <div className="flex items-center gap-2 border-t border-amber-500/20 bg-amber-500/[0.06] px-5 py-2.5">
          <AlertTriangle size={12} className="flex-shrink-0 text-amber-400" />
          <p className="text-[11px] text-amber-400">
            Staffing below required 1:{rd.requiredRatio} ratio — additional instructors needed.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drill Library tab
// ---------------------------------------------------------------------------

function DrillLibrary() {
  const categories = Array.from(new Set(MOCK_DRILLS.map((d) => d.category)));
  const [active, setActive] = useState<string>("All");
  const filtered = active === "All" ? MOCK_DRILLS : MOCK_DRILLS.filter((d) => d.category === active);

  return (
    <div>
      {/* Category filter */}
      <div className="mb-5 flex flex-wrap gap-2">
        {["All", ...categories].map((c) => (
          <button
            key={c}
            onClick={() => setActive(c)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
              active === c
                ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                : "border-white/[0.08] bg-transparent text-slate-500 hover:border-white/[0.14] hover:text-slate-300"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((d) => (
          <div
            key={d.id}
            className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#161b27] p-4 transition-colors hover:border-white/[0.14]"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-[#e8eaf0]">{d.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{d.description}</p>
              </div>
              {d.qualificationRelevant && (
                <span className="flex-shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-400 border border-blue-500/20">
                  Qual
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 border-t border-white/[0.06] pt-3">
              <CategoryPill category={d.category} />
              <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <CircleDot size={11} />
                  {d.rounds} rds
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {d.durationMin} min
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Training History tab
// ---------------------------------------------------------------------------

function TrainingHistory() {
  const completed = MOCK_RANGE_DAYS.filter((r) => r.status === "Completed")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#161b27]">
      <table className="w-full border-collapse text-left">
        <thead className="bg-[#1e2535]">
          <tr>
            {["Event", "Date", "Location", "Range Master", "Officers", "Completion", ""].map((h) => (
              <th
                key={h}
                className="border-b border-white/[0.08] px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {completed.map((rd) => {
            const pct = getCompletionPct(rd);
            return (
              <tr
                key={rd.id}
                className="border-b border-white/[0.06] last:border-b-0 transition-colors hover:bg-white/[0.02]"
              >
                <td className="px-4 py-3 text-[13px] font-medium text-[#e8eaf0]">{rd.title}</td>
                <td className="px-4 py-3 text-[12px] text-slate-400">{formatDate(rd.date)}</td>
                <td className="px-4 py-3 text-[12px] text-slate-400">{rd.location}</td>
                <td className="px-4 py-3 text-[12px] text-slate-400">{rd.rangeMaster.name}</td>
                <td className="px-4 py-3 text-[12px] text-slate-400">{rd.officersCompleted}/{rd.officersAssigned}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <ProgressBar
                      pct={pct}
                      color={pct === 100 ? "bg-emerald-500" : "bg-blue-500"}
                    />
                    <span className="w-8 flex-shrink-0 text-right text-[11px] font-medium text-slate-300">
                      {pct}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] text-slate-500 transition-colors hover:border-white/[0.14] hover:text-slate-300">
                    View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance Trends tab — static placeholder charts
// ---------------------------------------------------------------------------

function PerformanceTrends() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May"];
  const completionData = [88, 91, 85, 95, 0]; // May is upcoming
  const rangeDaysData  = [2, 1, 2, 2, 2];

  const maxCompletion = 100;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "YTD Range Days",    value: "8",    sub: "2026",           icon: CalendarDays, color: "text-blue-400"    },
          { label: "Avg. Completion",   value: "90%",  sub: "Q1–Q2",          icon: TrendingUp,   color: "text-emerald-400" },
          { label: "Officers Trained",  value: "42",   sub: "unique YTD",     icon: Users,        color: "text-violet-400"  },
          { label: "Drills Logged",     value: "27",   sub: "across all days", icon: Target,       color: "text-amber-400"   },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-white/[0.08] bg-[#161b27] p-4">
            <div className="mb-2 flex items-center gap-2">
              <s.icon size={14} className={s.color} />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">{s.label}</span>
            </div>
            <p className={`text-[22px] font-bold leading-none ${s.color}`}>{s.value}</p>
            <p className="mt-1 text-[11px] text-slate-600">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Bar chart — completion rate by month */}
      <div className="rounded-xl border border-white/[0.08] bg-[#161b27] p-5">
        <p className="mb-5 text-[13px] font-semibold text-[#e8eaf0]">Officer Completion Rate by Month</p>
        <div className="flex items-end gap-3" style={{ height: 120 }}>
          {months.map((m, i) => {
            const val = completionData[i];
            const pct = (val / maxCompletion) * 100;
            const isUpcoming = val === 0;
            return (
              <div key={m} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[11px] font-medium text-slate-400">
                  {isUpcoming ? "—" : `${val}%`}
                </span>
                <div className="w-full rounded-t-sm" style={{ height: 90 }}>
                  <div
                    className={`w-full rounded-t-sm transition-all ${isUpcoming ? "bg-white/[0.04] border border-white/[0.06] border-dashed" : "bg-blue-500/70"}`}
                    style={{ height: `${isUpcoming ? 100 : pct}%`, marginTop: `${isUpcoming ? 0 : 100 - pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-600">{m}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Range days per month */}
      <div className="rounded-xl border border-white/[0.08] bg-[#161b27] p-5">
        <p className="mb-4 text-[13px] font-semibold text-[#e8eaf0]">Range Days Conducted per Month</p>
        <div className="space-y-2.5">
          {months.map((m, i) => (
            <div key={m} className="flex items-center gap-3">
              <span className="w-7 flex-shrink-0 text-[11px] text-slate-600">{m}</span>
              <div className="flex flex-1 items-center gap-2">
                <div className="flex flex-1 overflow-hidden rounded-full bg-white/[0.04]" style={{ height: 8 }}>
                  <div
                    className="rounded-full bg-violet-500/70"
                    style={{ width: `${(rangeDaysData[i] / 3) * 100}%` }}
                  />
                </div>
                <span className="w-4 text-right text-[11px] font-medium text-slate-400">{rangeDaysData[i]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = "range-days" | "drill-library" | "training-history" | "performance-trends";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "range-days",         label: "Range Days",        icon: Crosshair   },
  { id: "drill-library",      label: "Drill Library",     icon: BookOpen    },
  { id: "training-history",   label: "Training History",  icon: History     },
  { id: "performance-trends", label: "Performance Trends",icon: BarChart3   },
];

// ---------------------------------------------------------------------------
// Stat strip
// ---------------------------------------------------------------------------

function StatsStrip() {
  const scheduled  = MOCK_RANGE_DAYS.filter((r) => r.status === "Scheduled").length;
  const completed  = MOCK_RANGE_DAYS.filter((r) => r.status === "Completed").length;
  const draft      = MOCK_RANGE_DAYS.filter((r) => r.status === "Draft").length;
  const understaffed = MOCK_RANGE_DAYS.filter(
    (r) => getStaffingStatus(r) === "Understaffed" && r.status !== "Completed"
  ).length;

  return (
    <div className="mb-6 flex gap-px overflow-hidden rounded-lg bg-white/[0.06]">
      {[
        { label: "Scheduled",   value: scheduled,   color: "text-blue-400"    },
        { label: "Completed",   value: completed,   color: "text-emerald-400" },
        { label: "Draft",       value: draft,       color: "text-slate-400"   },
        { label: "Understaffed",value: understaffed, color: understaffed > 0 ? "text-amber-400" : "text-slate-600" },
      ].map((s) => (
        <div key={s.label} className="flex-1 bg-[#161b27] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">{s.label}</p>
          <p className={`mt-0.5 text-xl font-bold leading-none ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RangeDaysPage() {
  const [activeTab, setActiveTab] = useState<TabId>("range-days");
  const [statusFilter, setStatusFilter] = useState<RangeDayStatus | "All">("All");

  const visibleRangeDays = statusFilter === "All"
    ? MOCK_RANGE_DAYS
    : MOCK_RANGE_DAYS.filter((r) => r.status === statusFilter);

  return (
    <div
      className="min-h-screen bg-[#0f1117] text-[#e8eaf0]"
      style={{ fontFamily: "var(--font-sans, system-ui, sans-serif)" }}
    >
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-white/[0.08] bg-[#161b27] px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500 text-[11px] font-bold text-white tracking-wide">
            TP
          </div>
          <span className="text-[13px] font-semibold tracking-tight">TracePoint</span>
          <span className="text-[11px] text-slate-600">/ Range</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/[0.08] bg-[#1e2535] px-2.5 py-0.5 text-[11px] text-slate-400">
            Flemington PD · NJ
          </span>
          <div className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-white/[0.08] bg-[#2a3550] text-[11px] font-semibold text-slate-400">
            JM
          </div>
        </div>
      </header>

      {/* ── Page content ── */}
      <main className="mx-auto max-w-[1280px] px-5 py-6">

        {/* Breadcrumb */}
        <nav className="mb-1.5 flex items-center gap-1.5 text-[11px] text-slate-600">
          <span>Training</span>
          <span>›</span>
          <span className="text-slate-400">Range Days</span>
        </nav>

        {/* Page title */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Range Days</h1>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Schedule and manage qualification events, drills, and instructor staffing.
            </p>
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-600">
            <Plus size={14} />
            Create Range Day
          </button>
        </div>

        {/* Stat strip */}
        <StatsStrip />

        {/* ── Tabs ── */}
        <div className="mb-6 flex gap-px overflow-hidden rounded-lg border border-white/[0.08] bg-[#161b27]">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-blue-500/10 text-blue-400 border-b-2 border-blue-500"
                  : "text-slate-500 hover:bg-white/[0.03] hover:text-slate-300"
              }`}
            >
              <tab.icon size={13} className={activeTab === tab.id ? "text-blue-400" : "text-slate-600"} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}

        {activeTab === "range-days" && (
          <div>
            {/* Filter row */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Filter size={13} className="text-slate-600" />
              {(["All", "Scheduled", "Draft", "Completed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                    statusFilter === s
                      ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                      : "border-white/[0.08] bg-transparent text-slate-500 hover:border-white/[0.14] hover:text-slate-300"
                  }`}
                >
                  {s}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-slate-600">
                {visibleRangeDays.length} event{visibleRangeDays.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Cards */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleRangeDays
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((rd) => (
                  <RangeDayCard key={rd.id} rd={rd} />
                ))}
            </div>
          </div>
        )}

        {activeTab === "drill-library"      && <DrillLibrary />}
        {activeTab === "training-history"   && <TrainingHistory />}
        {activeTab === "performance-trends" && <PerformanceTrends />}

      </main>
    </div>
  );
}
