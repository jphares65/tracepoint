"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import TracePointShell from "@/components/TracePointShell";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock,
  Crosshair,
  Filter,
  History,
  MapPin,
  Plus,
  Search,
  Shield,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  X,
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
  date: string;
  time: string;
  location: string;
  status: RangeDayStatus;
  rangeMaster: Instructor;
  instructors: Instructor[];
  officersAssigned: number;
  officersCompleted: number;
  drills: Drill[];
  requiredRatio: number;
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

type TabId =
  | "range-days"
  | "drill-library"
  | "training-history"
  | "performance-trends";

interface CreateRangeDayForm {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  rangeType: string;
  qualCycle: string;
  status: "Draft" | "Scheduled";
  rangeMasterId: string;
  instructorIds: string[];
  ratio: number;
  officerIds: string[];
  drillIds: string[];
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
      { name: "Det. Patel, A.", badgeNo: "2201" },
      { name: "Off. Chen, D.", badgeNo: "3087" },
    ],
    officersAssigned: 18,
    officersCompleted: 0,
    drills: [
      {
        id: "d1",
        name: "3-Yard Draw & Fire",
        category: "Qualification",
        rounds: 12,
        completed: false,
      },
      {
        id: "d2",
        name: "7-Yard Double Tap",
        category: "Qualification",
        rounds: 12,
        completed: false,
      },
      {
        id: "d3",
        name: "15-Yard Slow Fire",
        category: "Qualification",
        rounds: 10,
        completed: false,
      },
      {
        id: "d4",
        name: "Reload Under Pressure",
        category: "Tactical",
        rounds: 8,
        completed: false,
      },
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
    instructors: [{ name: "Sgt. Rivera, M.", badgeNo: "1142" }],
    officersAssigned: 14,
    officersCompleted: 0,
    drills: [
      {
        id: "d5",
        name: "50-Yard Zeroing",
        category: "Proficiency",
        rounds: 20,
        completed: false,
      },
      {
        id: "d6",
        name: "Transition Drill",
        category: "Tactical",
        rounds: 10,
        completed: false,
      },
      {
        id: "d7",
        name: "Barricade Engagement",
        category: "Tactical",
        rounds: 12,
        completed: false,
      },
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
      { name: "Det. Patel, A.", badgeNo: "2201" },
      { name: "Off. Torres, L.", badgeNo: "3312" },
    ],
    officersAssigned: 22,
    officersCompleted: 20,
    drills: [
      {
        id: "d8",
        name: "3-Yard Draw & Fire",
        category: "Qualification",
        rounds: 12,
        completed: true,
      },
      {
        id: "d9",
        name: "7-Yard Double Tap",
        category: "Qualification",
        rounds: 12,
        completed: true,
      },
      {
        id: "d10",
        name: "15-Yard Slow Fire",
        category: "Qualification",
        rounds: 10,
        completed: true,
      },
      {
        id: "d11",
        name: "Malfunction Clearance",
        category: "Tactical",
        rounds: 6,
        completed: true,
      },
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
    instructors: [{ name: "Det. Okafor, B.", badgeNo: "2418" }],
    officersAssigned: 10,
    officersCompleted: 10,
    drills: [
      {
        id: "d12",
        name: "Handheld Light Technique",
        category: "Tactical",
        rounds: 15,
        completed: true,
      },
      {
        id: "d13",
        name: "WML Engagement",
        category: "Tactical",
        rounds: 10,
        completed: true,
      },
      {
        id: "d14",
        name: "Shoot / No-Shoot",
        category: "Judgment",
        rounds: 8,
        completed: true,
      },
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
      {
        id: "d15",
        name: "Safety Brief & Rules",
        category: "Administrative",
        rounds: 0,
        completed: false,
      },
      {
        id: "d16",
        name: "Fundamentals Review",
        category: "Proficiency",
        rounds: 25,
        completed: false,
      },
      {
        id: "d17",
        name: "Qual Course",
        category: "Qualification",
        rounds: 50,
        completed: false,
      },
    ],
    requiredRatio: 6,
  },
];

const MOCK_DRILLS: DrillTemplate[] = [
  {
    id: "dt1",
    name: "3-Yard Draw & Fire",
    category: "Qualification",
    description:
      "Standard close-range qualification string. Two rounds from the holster at 3 yards.",
    rounds: 12,
    durationMin: 10,
    qualificationRelevant: true,
  },
  {
    id: "dt2",
    name: "7-Yard Double Tap",
    category: "Qualification",
    description: "Controlled pair to center mass at 7 yards, holster start.",
    rounds: 12,
    durationMin: 12,
    qualificationRelevant: true,
  },
  {
    id: "dt3",
    name: "15-Yard Slow Fire",
    category: "Qualification",
    description: "Accuracy string at 15 yards, freestyle stance.",
    rounds: 10,
    durationMin: 15,
    qualificationRelevant: true,
  },
  {
    id: "dt4",
    name: "Reload Under Pressure",
    category: "Tactical",
    description:
      "Emergency reload after slide lock at 7 yards, target re-engagement.",
    rounds: 8,
    durationMin: 10,
    qualificationRelevant: false,
  },
  {
    id: "dt5",
    name: "Malfunction Clearance",
    category: "Tactical",
    description:
      "Type I and Type II clearance drills with induced malfunctions.",
    rounds: 6,
    durationMin: 15,
    qualificationRelevant: false,
  },
  {
    id: "dt6",
    name: "Barricade Engagement",
    category: "Tactical",
    description:
      "Strong and support side shooting from barricade cover at 10 yards.",
    rounds: 12,
    durationMin: 12,
    qualificationRelevant: false,
  },
  {
    id: "dt7",
    name: "Transition Drill",
    category: "Tactical",
    description: "Rifle to pistol transition on target at 10 yards.",
    rounds: 10,
    durationMin: 10,
    qualificationRelevant: false,
  },
  {
    id: "dt8",
    name: "Shoot / No-Shoot",
    category: "Judgment",
    description:
      "Mixed threat / non-threat target engagement. Decision-making under time pressure.",
    rounds: 8,
    durationMin: 20,
    qualificationRelevant: false,
  },
  {
    id: "dt9",
    name: "50-Yard Zeroing",
    category: "Proficiency",
    description: "Rifle zero confirmation at 50 yards, 3-shot groups.",
    rounds: 20,
    durationMin: 20,
    qualificationRelevant: false,
  },
  {
    id: "dt10",
    name: "WML Engagement",
    category: "Tactical",
    description:
      "Weapon-mounted light engagement in simulated low-light conditions.",
    rounds: 10,
    durationMin: 15,
    qualificationRelevant: false,
  },
  {
    id: "dt11",
    name: "Handheld Light Technique",
    category: "Tactical",
    description: "Harries and Rogers/Surefire technique live fire.",
    rounds: 15,
    durationMin: 20,
    qualificationRelevant: false,
  },
  {
    id: "dt12",
    name: "Fundamentals Review",
    category: "Proficiency",
    description:
      "Grip, stance, sight picture, trigger control — slow fire accuracy work.",
    rounds: 25,
    durationMin: 30,
    qualificationRelevant: false,
  },
];

const ROSTER_INSTRUCTORS = [
  { id: "i1", name: "Sgt. Rivera, M.", badge: "1142", unit: "Patrol A" },
  { id: "i2", name: "Lt. Brooks, C.", badge: "0921", unit: "Command" },
  { id: "i3", name: "Det. Patel, A.", badge: "2201", unit: "CID" },
  { id: "i4", name: "Off. Chen, D.", badge: "3087", unit: "Patrol B" },
  { id: "i5", name: "Det. Okafor, B.", badge: "2418", unit: "CID" },
  { id: "i6", name: "Off. Torres, L.", badge: "3312", unit: "Patrol C" },
];

const ROSTER_OFFICERS = [
  {
    id: "o1",
    name: "Torres, Lucia",
    rank: "Off.",
    badge: "3312",
    unit: "Patrol C",
    qualDue: true,
    rifleDue: true,
  },
  {
    id: "o2",
    name: "Walsh, Robert",
    rank: "Off.",
    badge: "4401",
    unit: "Patrol B",
    qualDue: true,
    rifleDue: false,
  },
  {
    id: "o3",
    name: "Smith, James",
    rank: "Off.",
    badge: "3102",
    unit: "Patrol A",
    qualDue: true,
    rifleDue: true,
  },
  {
    id: "o4",
    name: "Johnson, Mark",
    rank: "Off.",
    badge: "3205",
    unit: "Patrol B",
    qualDue: false,
    rifleDue: false,
  },
  {
    id: "o5",
    name: "Nguyen, Thomas",
    rank: "Off.",
    badge: "3088",
    unit: "Patrol A",
    qualDue: true,
    rifleDue: false,
  },
  {
    id: "o6",
    name: "Martinez, Karen",
    rank: "Off.",
    badge: "3091",
    unit: "Patrol C",
    qualDue: false,
    rifleDue: false,
  },
  {
    id: "o7",
    name: "Garcia, Elena",
    rank: "Sgt.",
    badge: "2890",
    unit: "Patrol C",
    qualDue: false,
    rifleDue: false,
  },
  {
    id: "o8",
    name: "Brooks, Catherine",
    rank: "Lt.",
    badge: "0921",
    unit: "Command",
    qualDue: false,
    rifleDue: false,
  },
  {
    id: "o9",
    name: "Rivera, Miguel",
    rank: "Sgt.",
    badge: "1142",
    unit: "Patrol A",
    qualDue: false,
    rifleDue: false,
  },
  {
    id: "o10",
    name: "Okafor, Blessing",
    rank: "Det.",
    badge: "2418",
    unit: "CID",
    qualDue: false,
    rifleDue: false,
  },
  {
    id: "o11",
    name: "Patel, Arun",
    rank: "Det.",
    badge: "2201",
    unit: "CID",
    qualDue: false,
    rifleDue: false,
  },
  {
    id: "o12",
    name: "Chen, David",
    rank: "Off.",
    badge: "3087",
    unit: "Patrol B",
    qualDue: false,
    rifleDue: false,
  },
];

const QUICK_GROUPS = [
  {
    label: "Patrol A",
    filter: (o: (typeof ROSTER_OFFICERS)[number]) => o.unit === "Patrol A",
  },
  {
    label: "Patrol B",
    filter: (o: (typeof ROSTER_OFFICERS)[number]) => o.unit === "Patrol B",
  },
  {
    label: "Patrol C",
    filter: (o: (typeof ROSTER_OFFICERS)[number]) => o.unit === "Patrol C",
  },
  {
    label: "CID",
    filter: (o: (typeof ROSTER_OFFICERS)[number]) => o.unit === "CID",
  },
  {
    label: "Command",
    filter: (o: (typeof ROSTER_OFFICERS)[number]) => o.unit === "Command",
  },
  {
    label: "All Sworn",
    filter: (_o: (typeof ROSTER_OFFICERS)[number]) => true,
  },
  {
    label: "Due This Cycle",
    filter: (o: (typeof ROSTER_OFFICERS)[number]) => o.qualDue,
  },
  {
    label: "Rifle Fam. Due",
    filter: (o: (typeof ROSTER_OFFICERS)[number]) => o.rifleDue,
  },
];

const RANGE_TYPES = [
  "Qualification",
  "Rifle Familiarization",
  "Department Drill",
  "Remediation",
  "Administrative / New Hire",
];

const QUAL_CYCLES = ["Spring 2026", "Fall 2026", "Not applicable"];

const LOCATIONS = [
  "Flemington Indoor Range",
  "Morris County Outdoor Range",
  "Somerset County Range",
  "Other",
];

const EMPTY_FORM: CreateRangeDayForm = {
  title: "",
  date: "",
  startTime: "",
  endTime: "",
  location: "",
  rangeType: "",
  qualCycle: "",
  status: "Draft",
  rangeMasterId: "",
  instructorIds: [],
  ratio: 6,
  officerIds: [],
  drillIds: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStaffingStatus(rd: RangeDay): StaffingStatus {
  const totalInstructors = 1 + rd.instructors.length;
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
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDrillCompletionPct(rd: RangeDay): number {
  if (rd.drills.length === 0) return 0;

  return Math.round(
    (rd.drills.filter((d) => d.completed).length / rd.drills.length) * 100,
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<string, string> = {
  Qualification: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Tactical: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  Judgment: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Proficiency: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  Administrative: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {label}
        {required && <span className="text-blue-500">*</span>}
      </label>

      {children}
    </div>
  );
}

function CategoryPill({ category }: { category: string }) {
  const cls =
    CATEGORY_COLORS[category] ??
    "bg-slate-500/10 text-slate-400 border-slate-500/20";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {category}
    </span>
  );
}

function StatusBadge({ status }: { status: RangeDayStatus }) {
  const map: Record<RangeDayStatus, { dot: string; text: string; bg: string }> =
    {
      Draft: {
        dot: "bg-slate-500",
        text: "text-slate-400",
        bg: "bg-slate-500/10 border-slate-500/20",
      },
      Scheduled: {
        dot: "bg-blue-400",
        text: "text-blue-400",
        bg: "bg-blue-500/10 border-blue-500/20",
      },
      Completed: {
        dot: "bg-emerald-400",
        text: "text-emerald-400",
        bg: "bg-emerald-500/10 border-emerald-500/20",
      },
    };

  const s = map[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.bg} ${s.text}`}
    >
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

function ProgressBar({
  pct,
  color = "bg-blue-500",
}: {
  pct: number;
  color?: string;
}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Range Day drawer
// ---------------------------------------------------------------------------

function CreateRangeDayDrawer({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (rd: RangeDay) => void;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<CreateRangeDayForm>(EMPTY_FORM);
  const [officerSearch, setOfficerSearch] = useState("");
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const patch = (updates: Partial<CreateRangeDayForm>) =>
    setForm((current) => ({ ...current, ...updates }));

  const totalInstructors =
    (form.rangeMasterId ? 1 : 0) + form.instructorIds.length;

  const capacity = totalInstructors * form.ratio;

  const staffingOk =
    form.officerIds.length <= capacity || form.officerIds.length === 0;

  const filteredOfficers = ROSTER_OFFICERS.filter((o) => {
    const q = officerSearch.toLowerCase().trim();
    return !q || `${o.name} ${o.badge} ${o.unit}`.toLowerCase().includes(q);
  });

  function toggleOfficer(id: string) {
    patch({
      officerIds: form.officerIds.includes(id)
        ? form.officerIds.filter((x) => x !== id)
        : [...form.officerIds, id],
    });
  }

  function applyQuickGroup(filter: (o: (typeof ROSTER_OFFICERS)[number]) => boolean) {
    const ids = ROSTER_OFFICERS.filter(filter).map((o) => o.id);
    const merged = Array.from(new Set([...form.officerIds, ...ids]));

    patch({ officerIds: merged });
  }

  function toggleDrill(id: string) {
    patch({
      drillIds: form.drillIds.includes(id)
        ? form.drillIds.filter((x) => x !== id)
        : [...form.drillIds, id],
    });
  }

  function toggleInstructor(id: string) {
    patch({
      instructorIds: form.instructorIds.includes(id)
        ? form.instructorIds.filter((x) => x !== id)
        : [...form.instructorIds, id],
    });
  }

  const canAdvance =
    [
      false,
      Boolean(
        form.title &&
          form.date &&
          form.startTime &&
          form.endTime &&
          form.location &&
          form.rangeType,
      ),
      Boolean(form.rangeMasterId),
      form.officerIds.length > 0,
      true,
    ][step] ?? true;

  function handleCreate() {
    const rm = ROSTER_INSTRUCTORS.find((i) => i.id === form.rangeMasterId);

    if (!rm) return;

    const additionalInstructors = ROSTER_INSTRUCTORS.filter((i) =>
      form.instructorIds.includes(i.id),
    );

    const selectedDrills = MOCK_DRILLS.filter((d) =>
      form.drillIds.includes(d.id),
    );

    const newRD: RangeDay = {
      id: `rd-${Date.now()}`,
      title: form.title,
      date: form.date,
      time: `${form.startTime} – ${form.endTime}`,
      location: form.location,
      status: form.status,
      rangeMaster: { name: rm.name, badgeNo: rm.badge },
      instructors: additionalInstructors.map((i) => ({
        name: i.name,
        badgeNo: i.badge,
      })),
      officersAssigned: form.officerIds.length,
      officersCompleted: 0,
      drills: selectedDrills.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        rounds: d.rounds,
        completed: false,
      })),
      requiredRatio: form.ratio,
    };

    onCreate(newRD);
    onClose();
  }

  const stepLabels = ["Event Details", "Staffing", "Officers", "Drills"];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        ref={drawerRef}
        className="fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-slate-800 bg-slate-950 shadow-2xl sm:max-w-xl"
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Step {step} of 4
            </p>

            <h2 className="text-[16px] font-bold leading-tight text-white">
              {stepLabels[step - 1]}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex h-1 flex-shrink-0 gap-px bg-slate-900">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`flex-1 transition-colors ${
                s <= step ? "bg-blue-500" : "bg-slate-800"
              }`}
            />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {step === 1 && (
            <div className="space-y-4">
              <Field label="Range Day Title" required>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder="e.g. Q3 Qualification — Pistol"
                  className="tp-input"
                />
              </Field>

              <Field label="Date" required>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => patch({ date: e.target.value })}
                  className="tp-input"
                  style={{ colorScheme: "dark" }}
                />
              </Field>

              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <Field label="Start Time" required>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => patch({ startTime: e.target.value })}
                    className="tp-input"
                    style={{ colorScheme: "dark" }}
                  />
                </Field>

                <Field label="End Time" required>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => patch({ endTime: e.target.value })}
                    className="tp-input"
                    style={{ colorScheme: "dark" }}
                  />
                </Field>
              </div>

              <Field label="Location" required>
                <div className="relative">
                  <select
                    value={form.location}
                    onChange={(e) => patch({ location: e.target.value })}
                    className="tp-select"
                  >
                    <option value="">Select location…</option>
                    {LOCATIONS.map((location) => (
                      <option key={location}>{location}</option>
                    ))}
                  </select>

                  <ChevronDown
                    size={12}
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-600"
                  />
                </div>
              </Field>

              <Field label="Range Type" required>
                <div className="flex flex-wrap gap-2">
                  {RANGE_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => patch({ rangeType: type })}
                      className={`rounded-xl border px-3 py-1.5 text-[12px] font-medium transition ${
                        form.rangeType === type
                          ? "border-blue-500/60 bg-blue-500/15 text-blue-300"
                          : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Qualification Cycle">
                <div className="flex flex-wrap gap-2">
                  {QUAL_CYCLES.map((cycle) => (
                    <button
                      key={cycle}
                      type="button"
                      onClick={() => patch({ qualCycle: cycle })}
                      className={`rounded-xl border px-3 py-1.5 text-[12px] font-medium transition ${
                        form.qualCycle === cycle
                          ? "border-blue-500/60 bg-blue-500/15 text-blue-300"
                          : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                      }`}
                    >
                      {cycle}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Initial Status">
                <div className="grid grid-cols-2 gap-3">
                  {(["Draft", "Scheduled"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => patch({ status })}
                      className={`rounded-xl border py-2 text-[12px] font-semibold transition ${
                        form.status === status
                          ? status === "Scheduled"
                            ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                            : "border-slate-600 bg-slate-800 text-slate-300"
                          : "border-slate-700 text-slate-500 hover:border-slate-600"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>

                <p className="mt-1.5 text-[11px] text-slate-600">
                  Draft saves without notifying officers. Scheduled marks it
                  active.
                </p>
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div
                className={`flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                  staffingOk
                    ? "border-emerald-500/20 bg-emerald-500/[0.06]"
                    : "border-amber-500/20 bg-amber-500/[0.06]"
                }`}
              >
                <div className="text-[12px]">
                  <span
                    className={`font-semibold ${
                      staffingOk ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {staffingOk ? "Meets Policy" : "Understaffed"}
                  </span>

                  <span className="ml-2 text-slate-500">
                    {totalInstructors} instructor
                    {totalInstructors !== 1 ? "s" : ""} ·{" "}
                    {form.officerIds.length} officers · capacity{" "}
                    {capacity || "—"}
                  </span>
                </div>

                {staffingOk ? (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                ) : (
                  <AlertTriangle size={14} className="text-amber-400" />
                )}
              </div>

              <Field label="Range Master" required>
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {ROSTER_INSTRUCTORS.map((inst) => (
                    <button
                      key={inst.id}
                      type="button"
                      onClick={() => patch({ rangeMasterId: inst.id })}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                        form.rangeMasterId === inst.id
                          ? "border-blue-500/50 bg-blue-500/10"
                          : "border-slate-800 bg-slate-900 hover:border-slate-700"
                      }`}
                    >
                      <Shield
                        size={13}
                        className={
                          form.rangeMasterId === inst.id
                            ? "text-blue-400"
                            : "text-slate-600"
                        }
                      />

                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-white">
                          {inst.name}
                        </p>

                        <p className="text-[11px] text-slate-500">
                          #{inst.badge} · {inst.unit}
                        </p>
                      </div>

                      {form.rangeMasterId === inst.id && (
                        <Check size={13} className="flex-shrink-0 text-blue-400" />
                      )}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Additional Instructors">
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {ROSTER_INSTRUCTORS.filter(
                    (i) => i.id !== form.rangeMasterId,
                  ).map((inst) => {
                    const selected = form.instructorIds.includes(inst.id);

                    return (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={() => toggleInstructor(inst.id)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                          selected
                            ? "border-blue-500/40 bg-blue-500/[0.07]"
                            : "border-slate-800 bg-slate-900 hover:border-slate-700"
                        }`}
                      >
                        <UserCheck
                          size={13}
                          className={selected ? "text-blue-400" : "text-slate-600"}
                        />

                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-white">
                            {inst.name}
                          </p>

                          <p className="text-[11px] text-slate-500">
                            #{inst.badge} · {inst.unit}
                          </p>
                        </div>

                        {selected && (
                          <Check
                            size={13}
                            className="flex-shrink-0 text-blue-400"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Instructor-to-Officer Ratio">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[13px] text-slate-500">
                    1 instructor per
                  </span>

                  <div className="relative">
                    <select
                      value={form.ratio}
                      onChange={(e) =>
                        patch({ ratio: Number.parseInt(e.target.value, 10) })
                      }
                      className="tp-select w-32 pr-8"
                    >
                      {[4, 5, 6, 8, 10].map((n) => (
                        <option key={n} value={n}>
                          {n} officers
                        </option>
                      ))}
                    </select>

                    <ChevronDown
                      size={12}
                      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-600"
                    />
                  </div>
                </div>

                <p className="mt-1 text-[11px] text-slate-600">
                  Range Master counts as an instructor toward ratio.
                </p>
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-slate-500">
                  <span className="font-semibold text-white">
                    {form.officerIds.length}
                  </span>{" "}
                  officer{form.officerIds.length !== 1 ? "s" : ""} selected
                </p>

                {form.officerIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => patch({ officerIds: [] })}
                    className="text-[11px] text-slate-600 hover:text-slate-400"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                  Quick Select
                </p>

                <div className="flex flex-wrap gap-2">
                  {QUICK_GROUPS.map((group) => {
                    const groupIds = ROSTER_OFFICERS.filter(group.filter).map(
                      (o) => o.id,
                    );

                    const allSelected =
                      groupIds.length > 0 &&
                      groupIds.every((id) => form.officerIds.includes(id));

                    return (
                      <button
                        key={group.label}
                        type="button"
                        onClick={() => applyQuickGroup(group.filter)}
                        className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                          allSelected
                            ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                            : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300"
                        }`}
                      >
                        {group.label}
                        <span className="ml-1.5 text-slate-600">
                          ({groupIds.length})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
                />

                <input
                  type="text"
                  value={officerSearch}
                  onChange={(e) => setOfficerSearch(e.target.value)}
                  placeholder="Search by name, badge, or unit…"
                  className="tp-input pl-9"
                />
              </div>

              <div className="space-y-1.5">
                {filteredOfficers.map((officer) => {
                  const selected = form.officerIds.includes(officer.id);

                  return (
                    <button
                      key={officer.id}
                      type="button"
                      onClick={() => toggleOfficer(officer.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                        selected
                          ? "border-blue-500/40 bg-blue-500/[0.07]"
                          : "border-slate-800 bg-slate-900 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-slate-400">
                        {officer.name[0]}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-white">
                          {officer.rank} {officer.name}
                        </p>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                          <span>#{officer.badge}</span>
                          <span>·</span>
                          <span>{officer.unit}</span>
                          {officer.qualDue && (
                            <span className="text-amber-500">Qual Due</span>
                          )}
                          {officer.rifleDue && (
                            <span className="text-orange-500">Rifle Due</span>
                          )}
                        </div>
                      </div>

                      {selected && (
                        <Check size={13} className="flex-shrink-0 text-blue-400" />
                      )}
                    </button>
                  );
                })}
              </div>

              {form.officerIds.length > 0 && totalInstructors > 0 && !staffingOk && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
                  <AlertTriangle
                    size={13}
                    className="mt-0.5 flex-shrink-0 text-amber-400"
                  />

                  <p className="text-[11px] text-amber-300">
                    {form.officerIds.length} officers exceeds capacity of{" "}
                    {capacity} for {totalInstructors} instructor
                    {totalInstructors !== 1 ? "s" : ""}. Add instructors in
                    Step 2 or reduce officer count.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-slate-500">
                  <span className="font-semibold text-white">
                    {form.drillIds.length}
                  </span>{" "}
                  drill{form.drillIds.length !== 1 ? "s" : ""} planned
                </p>

                {form.drillIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => patch({ drillIds: [] })}
                    className="text-[11px] text-slate-600 hover:text-slate-400"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {form.rangeType === "Qualification" && (
                <button
                  type="button"
                  onClick={() => {
                    const qualDrillIds = MOCK_DRILLS.filter(
                      (d) => d.qualificationRelevant,
                    ).map((d) => d.id);

                    patch({
                      drillIds: Array.from(
                        new Set([...form.drillIds, ...qualDrillIds]),
                      ),
                    });
                  }}
                  className="w-full rounded-xl border border-blue-500/30 bg-blue-500/[0.07] px-4 py-2.5 text-left text-[12px] text-blue-400 transition hover:bg-blue-500/10"
                >
                  + Add full qualification course (
                  {MOCK_DRILLS.filter((d) => d.qualificationRelevant).length}{" "}
                  drills)
                </button>
              )}

              <div className="space-y-2">
                {MOCK_DRILLS.map((drill) => {
                  const selected = form.drillIds.includes(drill.id);

                  const catCls =
                    CATEGORY_COLORS[drill.category] ??
                    "bg-slate-500/10 text-slate-400 border-slate-500/20";

                  return (
                    <button
                      key={drill.id}
                      type="button"
                      onClick={() => toggleDrill(drill.id)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-blue-500/40 bg-blue-500/[0.07]"
                          : "border-slate-800 bg-slate-900 hover:border-slate-700"
                      }`}
                    >
                      <div
                        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition ${
                          selected
                            ? "border-blue-500 bg-blue-500"
                            : "border-slate-700 bg-transparent"
                        }`}
                      >
                        {selected && <Check size={11} className="text-white" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-medium text-white">
                            {drill.name}
                          </p>

                          {drill.qualificationRelevant && (
                            <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-400">
                              Qual
                            </span>
                          )}
                        </div>

                        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                          {drill.description}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${catCls}`}
                          >
                            {drill.category}
                          </span>

                          <span className="text-[10px] text-slate-600">
                            {drill.rounds > 0
                              ? `${drill.rounds} rds`
                              : "No rounds"}
                          </span>

                          <span className="text-[10px] text-slate-600">
                            {drill.durationMin} min
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-slate-800 bg-slate-900/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-3 py-2 text-[12px] text-slate-500 transition hover:border-slate-600 hover:text-slate-300"
            >
              Cancel
            </button>

            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-[12px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
              >
                <ChevronLeft size={13} />
                Back
              </button>
            )}
          </div>

          {step < 4 ? (
            <button
              type="button"
              disabled={!canAdvance}
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold transition ${
                canAdvance
                  ? "bg-blue-600 text-white hover:bg-blue-500"
                  : "cursor-not-allowed bg-slate-800 text-slate-600"
              }`}
            >
              Continue
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-500"
            >
              <CheckCircle2 size={14} />
              Create Range Day
            </button>
          )}
        </div>
      </div>

      <style>{`
        .tp-input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgb(51 65 85);
          background: rgb(15 23 42);
          padding: 0.5rem 0.875rem;
          font-size: 0.8125rem;
          color: white;
          outline: none;
          transition: border-color 0.15s;
        }

        .tp-input:focus {
          border-color: rgb(59 130 246);
        }

        .tp-input::placeholder {
          color: rgb(71 85 105);
        }

        .tp-select {
          width: 100%;
          appearance: none;
          border-radius: 0.75rem;
          border: 1px solid rgb(51 65 85);
          background: rgb(15 23 42);
          padding: 0.5rem 0.875rem;
          font-size: 0.8125rem;
          color: white;
          outline: none;
          transition: border-color 0.15s;
          cursor: pointer;
        }

        .tp-select:focus {
          border-color: rgb(59 130 246);
        }

        .tp-select option {
          background: #1e2535;
        }

        input[type="date"]::-webkit-calendar-picker-indicator,
        input[type="time"]::-webkit-calendar-picker-indicator {
          filter: invert(0.4);
          cursor: pointer;
        }
      `}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Range Day Card
// ---------------------------------------------------------------------------

function RangeDayCard({ rd }: { rd: RangeDay }) {
  const staffing = getStaffingStatus(rd);
  const completion = getCompletionPct(rd);
  const drillPct = getDrillCompletionPct(rd);
  const totalInstructors = 1 + rd.instructors.length;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 transition-all duration-200 hover:-translate-y-[1px] hover:border-blue-500/40 hover:bg-slate-800/70">
      <Link href={`/range-days/${rd.id}`} className="block px-4 pb-4 pt-5 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={rd.status} />
              <StaffingBadge status={staffing} />
            </div>

            <h3 className="truncate text-[15px] font-semibold text-slate-100 transition-colors group-hover:text-white">
              {rd.title}
            </h3>
          </div>

          <ChevronRight
            size={16}
            className="mt-0.5 flex-shrink-0 text-slate-600 transition-colors group-hover:text-slate-400"
          />
        </div>
      </Link>

      <div className="grid grid-cols-1 gap-y-2 px-4 pb-4 sm:grid-cols-2 sm:px-5">
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
          <span className="truncate">{rd.location}</span>
        </div>
      </div>

      <div className="mx-4 border-t border-slate-800/80 sm:mx-5" />

      <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
            Instructors
          </p>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Shield size={11} className="flex-shrink-0 text-blue-400" />
              <span className="truncate text-[12px] text-slate-300">
                {rd.rangeMaster.name}
              </span>
              <span className="ml-auto flex-shrink-0 text-[10px] text-slate-600">
                RM
              </span>
            </div>

            {rd.instructors.length > 0 ? (
              rd.instructors.map((inst) => (
                <div key={inst.badgeNo} className="flex items-center gap-2">
                  <UserCheck
                    size={11}
                    className="flex-shrink-0 text-slate-500"
                  />
                  <span className="truncate text-[12px] text-slate-400">
                    {inst.name}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-[11px] italic text-slate-600">
                No additional instructors
              </p>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2">
            <p className="text-[10px] text-slate-600">
              <span className="font-semibold text-slate-400">
                {totalInstructors}
              </span>{" "}
              instructor{totalInstructors !== 1 ? "s" : ""} ·{" "}
              <span className="font-semibold text-slate-400">
                {rd.officersAssigned}
              </span>{" "}
              officers · 1:{rd.requiredRatio} policy
            </p>
          </div>
        </div>

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
                <span className="font-medium text-slate-300">
                  {completion}%
                </span>
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

      <div className="flex flex-wrap gap-1.5 px-4 pb-4 sm:px-5">
        {rd.drills.map((drill) => (
          <CategoryPill key={drill.id} category={drill.category} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/80 px-4 py-3 sm:px-5">
        <Link
          href={`/range-days/${rd.id}`}
          className="rounded-lg border border-slate-800 px-3 py-1.5 text-[11px] font-medium text-slate-400 transition hover:border-blue-500/40 hover:text-slate-200"
        >
          Open
        </Link>

        {(rd.status === "Scheduled" || rd.status === "Completed") && (
          <Link
            href={`/range-days/${rd.id}?tab=scoring`}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
              rd.status === "Scheduled"
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "border border-slate-800 text-slate-500 hover:border-blue-500/40 hover:text-slate-300"
            }`}
          >
            <Crosshair size={11} />
            {rd.status === "Scheduled" ? "Score Range Day" : "View Scores"}
          </Link>
        )}

        {rd.status === "Draft" && (
          <span className="text-[11px] italic text-slate-700">
            Finalize setup before scoring
          </span>
        )}
      </div>

      {staffing === "Understaffed" && rd.status !== "Completed" && (
        <div className="flex items-center gap-2 border-t border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 sm:px-5">
          <AlertTriangle
            size={12}
            className="flex-shrink-0 text-amber-400"
          />

          <p className="text-[11px] text-amber-400">
            Staffing below required 1:{rd.requiredRatio} ratio — additional
            instructors needed.
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

  const filtered =
    active === "All"
      ? MOCK_DRILLS
      : MOCK_DRILLS.filter((d) => d.category === active);

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {["All", ...categories].map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActive(category)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
              active === category
                ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                : "border-slate-800 bg-transparent text-slate-500 hover:border-blue-500/40 hover:text-slate-300"
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {filtered.map((drill) => (
          <div
            key={drill.id}
            className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-blue-500/40"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-slate-100">
                  {drill.name}
                </p>

                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                  {drill.description}
                </p>
              </div>

              {drill.qualificationRelevant && (
                <span className="flex-shrink-0 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-400">
                  Qual
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-800/80 pt-3">
              <CategoryPill category={drill.category} />

              <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <CircleDot size={11} />
                  {drill.rounds} rds
                </span>

                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {drill.durationMin} min
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

function TrainingHistory({ rangeDays }: { rangeDays: RangeDay[] }) {
  const completed = useMemo(
    () =>
      rangeDays
        .filter((r) => r.status === "Completed")
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [rangeDays],
  );

  return (
    <div>
      <div className="space-y-2 lg:hidden">
        {completed.map((rd) => {
          const pct = getCompletionPct(rd);

          return (
            <article
              key={rd.id}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-[14px] font-semibold text-white">
                    {rd.title}
                  </h3>

                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {formatDate(rd.date)}
                  </p>
                </div>

                <StatusBadge status={rd.status} />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                    Location
                  </p>

                  <p className="mt-1 text-[12px] text-slate-300">
                    {rd.location}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-700">
                    Range Master
                  </p>

                  <p className="mt-1 text-[12px] text-slate-300">
                    {rd.rangeMaster.name}
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px]">
                  <span className="text-slate-500">Completion</span>
                  <span className="font-medium text-slate-300">{pct}%</span>
                </div>

                <ProgressBar
                  pct={pct}
                  color={pct === 100 ? "bg-emerald-500" : "bg-blue-500"}
                />

                <p className="mt-1 text-[10px] text-slate-600">
                  {rd.officersCompleted} of {rd.officersAssigned} officers
                </p>
              </div>

              <Link
                href={`/range-days/${rd.id}`}
                className="mt-3 inline-flex rounded-lg border border-slate-800 px-3 py-1.5 text-[11px] text-slate-500 transition hover:border-blue-500/40 hover:text-slate-300"
              >
                View
              </Link>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead className="bg-slate-800/80">
              <tr>
                {[
                  "Event",
                  "Date",
                  "Location",
                  "Range Master",
                  "Officers",
                  "Completion",
                  "",
                ].map((header) => (
                  <th
                    key={header}
                    className="border-b border-slate-800 px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600"
                  >
                    {header}
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
                    className="border-b border-slate-800/80 last:border-b-0 transition-colors hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3 text-[13px] font-medium text-slate-100">
                      {rd.title}
                    </td>

                    <td className="px-4 py-3 text-[12px] text-slate-400">
                      {formatDate(rd.date)}
                    </td>

                    <td className="px-4 py-3 text-[12px] text-slate-400">
                      {rd.location}
                    </td>

                    <td className="px-4 py-3 text-[12px] text-slate-400">
                      {rd.rangeMaster.name}
                    </td>

                    <td className="px-4 py-3 text-[12px] text-slate-400">
                      {rd.officersCompleted}/{rd.officersAssigned}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <ProgressBar
                          pct={pct}
                          color={
                            pct === 100 ? "bg-emerald-500" : "bg-blue-500"
                          }
                        />

                        <span className="w-8 flex-shrink-0 text-right text-[11px] font-medium text-slate-300">
                          {pct}%
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <Link
                        href={`/range-days/${rd.id}`}
                        className="rounded-lg border border-slate-800 px-2.5 py-1 text-[11px] text-slate-500 transition-colors hover:border-blue-500/40 hover:text-slate-300"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance Trends tab
// ---------------------------------------------------------------------------

function PerformanceTrends() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May"];
  const completionData = [88, 91, 85, 95, 0];
  const rangeDaysData = [2, 1, 2, 2, 2];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: "YTD Range Days",
            value: "8",
            sub: "2026",
            icon: CalendarDays,
            color: "text-blue-400",
          },
          {
            label: "Avg. Completion",
            value: "90%",
            sub: "Q1–Q2",
            icon: TrendingUp,
            color: "text-emerald-400",
          },
          {
            label: "Officers Trained",
            value: "42",
            sub: "unique YTD",
            icon: Users,
            color: "text-violet-400",
          },
          {
            label: "Drills Logged",
            value: "27",
            sub: "across all days",
            icon: Target,
            color: "text-amber-400",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <stat.icon size={14} className={stat.color} />

              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                {stat.label}
              </span>
            </div>

            <p className={`text-[22px] font-bold leading-none ${stat.color}`}>
              {stat.value}
            </p>

            <p className="mt-1 text-[11px] text-slate-600">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 2xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <p className="mb-5 text-[13px] font-semibold text-slate-100">
            Officer Completion Rate by Month
          </p>

          <div className="flex items-end gap-3" style={{ height: 120 }}>
            {months.map((month, index) => {
              const val = completionData[index];
              const pct = (val / 100) * 100;
              const isUpcoming = val === 0;

              return (
                <div
                  key={month}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="text-[11px] font-medium text-slate-400">
                    {isUpcoming ? "—" : `${val}%`}
                  </span>

                  <div className="w-full rounded-t-sm" style={{ height: 90 }}>
                    <div
                      className={`w-full rounded-t-sm transition-all ${
                        isUpcoming
                          ? "border border-dashed border-slate-800/80 bg-slate-800/70"
                          : "bg-blue-500/70"
                      }`}
                      style={{
                        height: `${isUpcoming ? 100 : pct}%`,
                        marginTop: `${isUpcoming ? 0 : 100 - pct}%`,
                      }}
                    />
                  </div>

                  <span className="text-[10px] text-slate-600">{month}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
          <p className="mb-4 text-[13px] font-semibold text-slate-100">
            Range Days Conducted per Month
          </p>

          <div className="space-y-2.5">
            {months.map((month, index) => (
              <div key={month} className="flex items-center gap-3">
                <span className="w-7 flex-shrink-0 text-[11px] text-slate-600">
                  {month}
                </span>

                <div className="flex flex-1 items-center gap-2">
                  <div
                    className="flex flex-1 overflow-hidden rounded-full bg-slate-800/70"
                    style={{ height: 8 }}
                  >
                    <div
                      className="rounded-full bg-violet-500/70"
                      style={{ width: `${(rangeDaysData[index] / 3) * 100}%` }}
                    />
                  </div>

                  <span className="w-4 text-right text-[11px] font-medium text-slate-400">
                    {rangeDaysData[index]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs and Stats
// ---------------------------------------------------------------------------

const TABS: {
  id: TabId;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}[] = [
  { id: "range-days", label: "Range Days", icon: Crosshair },
  { id: "drill-library", label: "Drill Library", icon: BookOpen },
  { id: "training-history", label: "Training History", icon: History },
  {
    id: "performance-trends",
    label: "Performance Trends",
    icon: BarChart3,
  },
];

function StatsStrip({ rangeDays }: { rangeDays: RangeDay[] }) {
  const scheduled = rangeDays.filter((r) => r.status === "Scheduled").length;
  const completed = rangeDays.filter((r) => r.status === "Completed").length;
  const draft = rangeDays.filter((r) => r.status === "Draft").length;

  const understaffed = rangeDays.filter(
    (r) => getStaffingStatus(r) === "Understaffed" && r.status !== "Completed",
  ).length;

  const stats = [
    {
      label: "Scheduled",
      value: scheduled,
      sub: "Active range days",
      color: "text-blue-400",
    },
    {
      label: "Completed",
      value: completed,
      sub: "Logged this cycle",
      color: "text-emerald-400",
    },
    {
      label: "Draft",
      value: draft,
      sub: "Setup pending",
      color: "text-slate-300",
    },
    {
      label: "Understaffed",
      value: understaffed,
      sub: "Needs instructors",
      color: understaffed > 0 ? "text-amber-400" : "text-slate-500",
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="group cursor-default rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 transition-all duration-200 hover:-translate-y-px hover:border-blue-500/25 hover:bg-slate-800/70 hover:shadow-[0_2px_12px_rgba(0,0,0,0.3)]"
        >
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600 transition-colors group-hover:text-slate-500">
            {stat.label}
          </p>

          <p className={`mt-1 text-2xl font-bold leading-none ${stat.color}`}>
            {stat.value}
          </p>

          <p className="mt-0.5 text-[10px] text-slate-600">{stat.sub}</p>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RangeDaysPage() {
  const [activeTab, setActiveTab] = useState<TabId>("range-days");
  const [statusFilter, setStatusFilter] = useState<RangeDayStatus | "All">(
    "All",
  );
  const [rangeDays, setRangeDays] = useState<RangeDay[]>(MOCK_RANGE_DAYS);
  const [showDrawer, setShowDrawer] = useState(false);

  function handleCreate(newRD: RangeDay) {
    setRangeDays((prev) => [newRD, ...prev]);
  }

  const visibleRangeDays = useMemo(() => {
    const filtered =
      statusFilter === "All"
        ? rangeDays
        : rangeDays.filter((r) => r.status === statusFilter);

    return [...filtered].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [rangeDays, statusFilter]);

  return (
    <TracePointShell activePage="Range & Training">
      {showDrawer && (
        <CreateRangeDayDrawer
          onClose={() => setShowDrawer(false)}
          onCreate={handleCreate}
        />
      )}

      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-[20px] font-bold leading-tight text-white sm:text-[22px]">
                Range &amp; Training
              </h1>

              <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-slate-500">
                Range days, drills, scores, staffing, and performance history.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-700">
                <span>Updated 2 min ago</span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span>
                  {rangeDays.filter((r) => r.status === "Scheduled").length}{" "}
                  range days scheduled
                </span>
                <span className="hidden text-slate-800 sm:inline">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                  System Healthy
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowDrawer(true)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-blue-500 sm:w-fit"
            >
              <Plus size={14} />
              Create Range Day
            </button>
          </div>
        </header>

        <StatsStrip rangeDays={rangeDays} />

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-1.5">
          <div className="grid grid-cols-1 gap-1 min-[420px]:grid-cols-2 lg:grid-cols-4">
            {TABS.map((tab) => (
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
                <tab.icon
                  size={13}
                  className={
                    activeTab === tab.id ? "text-white" : "text-slate-600"
                  }
                />

                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </section>

        {activeTab === "range-days" && (
          <section className="space-y-4">
            <div className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-slate-600">
                <Filter size={14} />
                Filter
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(["All", "Scheduled", "Draft", "Completed"] as const).map(
                  (status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all duration-200 ${
                        statusFilter === status
                          ? "border-blue-500/50 bg-blue-500/10 text-blue-300"
                          : "border-slate-800 bg-slate-900 text-slate-500 hover:border-blue-500/30 hover:text-slate-300"
                      }`}
                    >
                      {status}
                    </button>
                  ),
                )}
              </div>

              <span className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-center text-[12px] text-slate-600 sm:ml-auto">
                {visibleRangeDays.length} event
                {visibleRangeDays.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {visibleRangeDays.map((rd) => (
                <RangeDayCard key={rd.id} rd={rd} />
              ))}
            </div>
          </section>
        )}

        {activeTab === "drill-library" && <DrillLibrary />}

        {activeTab === "training-history" && (
          <TrainingHistory rangeDays={rangeDays} />
        )}

        {activeTab === "performance-trends" && <PerformanceTrends />}
      </div>
    </TracePointShell>
  );
}