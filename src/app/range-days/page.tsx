"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import TracePointShell from "@/components/TracePointShell";
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
  X,
  Search,
  ChevronLeft,
  ChevronDown,
  Check,
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
// Mock roster — used by CreateRangeDayDrawer
// ---------------------------------------------------------------------------

const ROSTER_INSTRUCTORS = [
  { id: "i1", name: "Sgt. Rivera, M.",  badge: "1142", unit: "Patrol A" },
  { id: "i2", name: "Lt. Brooks, C.",   badge: "0921", unit: "Command"  },
  { id: "i3", name: "Det. Patel, A.",   badge: "2201", unit: "CID"      },
  { id: "i4", name: "Off. Chen, D.",    badge: "3087", unit: "Patrol B" },
  { id: "i5", name: "Det. Okafor, B.", badge: "2418", unit: "CID"      },
  { id: "i6", name: "Off. Torres, L.", badge: "3312", unit: "Patrol C" },
];

const ROSTER_OFFICERS = [
  { id: "o1",  name: "Torres, Lucia",     rank: "Off.", badge: "3312", unit: "Patrol C", qualDue: true,  rifleDue: true  },
  { id: "o2",  name: "Walsh, Robert",     rank: "Off.", badge: "4401", unit: "Patrol B", qualDue: true,  rifleDue: false },
  { id: "o3",  name: "Smith, James",      rank: "Off.", badge: "3102", unit: "Patrol A", qualDue: true,  rifleDue: true  },
  { id: "o4",  name: "Johnson, Mark",     rank: "Off.", badge: "3205", unit: "Patrol B", qualDue: false, rifleDue: false },
  { id: "o5",  name: "Nguyen, Thomas",    rank: "Off.", badge: "3088", unit: "Patrol A", qualDue: true,  rifleDue: false },
  { id: "o6",  name: "Martinez, Karen",   rank: "Off.", badge: "3091", unit: "Patrol C", qualDue: false, rifleDue: false },
  { id: "o7",  name: "Garcia, Elena",     rank: "Sgt.", badge: "2890", unit: "Patrol C", qualDue: false, rifleDue: false },
  { id: "o8",  name: "Brooks, Catherine", rank: "Lt.",  badge: "0921", unit: "Command",  qualDue: false, rifleDue: false },
  { id: "o9",  name: "Rivera, Miguel",    rank: "Sgt.", badge: "1142", unit: "Patrol A", qualDue: false, rifleDue: false },
  { id: "o10", name: "Okafor, Blessing",  rank: "Det.", badge: "2418", unit: "CID",      qualDue: false, rifleDue: false },
  { id: "o11", name: "Patel, Arun",       rank: "Det.", badge: "2201", unit: "CID",      qualDue: false, rifleDue: false },
  { id: "o12", name: "Chen, David",       rank: "Off.", badge: "3087", unit: "Patrol B", qualDue: false, rifleDue: false },
];

const QUICK_GROUPS = [
  { label: "Patrol A",                   filter: (o: typeof ROSTER_OFFICERS[0]) => o.unit === "Patrol A"  },
  { label: "Patrol B",                   filter: (o: typeof ROSTER_OFFICERS[0]) => o.unit === "Patrol B"  },
  { label: "Patrol C",                   filter: (o: typeof ROSTER_OFFICERS[0]) => o.unit === "Patrol C"  },
  { label: "CID",                        filter: (o: typeof ROSTER_OFFICERS[0]) => o.unit === "CID"       },
  { label: "Command",                    filter: (o: typeof ROSTER_OFFICERS[0]) => o.unit === "Command"   },
  { label: "All Sworn",                  filter: (_o: typeof ROSTER_OFFICERS[0]) => true                  },
  { label: "Due This Cycle",             filter: (o: typeof ROSTER_OFFICERS[0]) => o.qualDue              },
  { label: "Rifle Fam. Due",            filter: (o: typeof ROSTER_OFFICERS[0]) => o.rifleDue             },
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

// ---------------------------------------------------------------------------
// CreateRangeDayDrawer — 4-step right-side drawer
// ---------------------------------------------------------------------------

interface CreateRangeDayForm {
  // Step 1
  title:       string;
  date:        string;
  startTime:   string;
  endTime:     string;
  location:    string;
  rangeType:   string;
  qualCycle:   string;
  status:      "Draft" | "Scheduled";
  // Step 2
  rangeMasterId:  string;
  instructorIds:  string[];
  ratio:          number;
  // Step 3
  officerIds:  string[];
  // Step 4
  drillIds:    string[];
}

const EMPTY_FORM: CreateRangeDayForm = {
  title: "", date: "", startTime: "", endTime: "",
  location: "", rangeType: "", qualCycle: "", status: "Draft",
  rangeMasterId: "", instructorIds: [], ratio: 6,
  officerIds: [], drillIds: [],
};

function CreateRangeDayDrawer({
  onClose,
  onCreate,
}: {
  onClose:  () => void;
  onCreate: (rd: RangeDay) => void;
}) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<CreateRangeDayForm>(EMPTY_FORM);
  const [officerSearch, setOfficerSearch] = useState("");
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Patch helper
  const patch = (updates: Partial<CreateRangeDayForm>) =>
    setForm((f) => ({ ...f, ...updates }));

  // Live staffing calculation
  const totalInstructors =
    (form.rangeMasterId ? 1 : 0) + form.instructorIds.length;
  const capacity = totalInstructors * form.ratio;
  const staffingOk = form.officerIds.length <= capacity || form.officerIds.length === 0;
  const staffingStatus: StaffingStatus = staffingOk ? "Meets Policy" : "Understaffed";

  // Officer filtering
  const filteredOfficers = ROSTER_OFFICERS.filter((o) => {
    const q = officerSearch.toLowerCase();
    return !q || `${o.name} ${o.badge} ${o.unit}`.toLowerCase().includes(q);
  });

  function toggleOfficer(id: string) {
    patch({
      officerIds: form.officerIds.includes(id)
        ? form.officerIds.filter((x) => x !== id)
        : [...form.officerIds, id],
    });
  }

  function applyQuickGroup(filter: (o: typeof ROSTER_OFFICERS[0]) => boolean) {
    const ids = ROSTER_OFFICERS.filter(filter).map((o) => o.id);
    // union with existing selection
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

  // Step validation
  const canAdvance = [
    false, // placeholder for index 0
    !!(form.title && form.date && form.startTime && form.endTime && form.location && form.rangeType),
    !!(form.rangeMasterId),
    form.officerIds.length > 0,
    true,
  ][step] ?? true;

  function handleCreate() {
    const rm = ROSTER_INSTRUCTORS.find((i) => i.id === form.rangeMasterId)!;
    const addlInstructors = ROSTER_INSTRUCTORS.filter((i) =>
      form.instructorIds.includes(i.id)
    );
    const selectedDrills = MOCK_DRILLS.filter((d) => form.drillIds.includes(d.id));

    const newRD: RangeDay = {
      id:               `rd-${Date.now()}`,
      title:            form.title,
      date:             form.date,
      time:             `${form.startTime} – ${form.endTime}`,
      location:         form.location,
      status:           form.status,
      rangeMaster:      { name: rm.name, badgeNo: rm.badge },
      instructors:      addlInstructors.map((i) => ({ name: i.name, badgeNo: i.badge })),
      officersAssigned: form.officerIds.length,
      officersCompleted: 0,
      drills:           selectedDrills.map((d) => ({
        id:       d.id,
        name:     d.name,
        category: d.category,
        rounds:   d.rounds,
        completed: false,
      })),
      requiredRatio: form.ratio,
    };
    onCreate(newRD);
    onClose();
  }

  const STEP_LABELS = ["Event Details", "Staffing", "Officers", "Drills"];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l border-slate-800 bg-slate-950 shadow-2xl"
      >
        {/* ── Drawer header ── */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Step {step} of 4
            </p>
            <h2 className="text-[16px] font-bold text-white leading-tight">
              {STEP_LABELS[step - 1]}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-800 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Step progress bar ── */}
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

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── STEP 1: Event Details ── */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Title */}
              <Field label="Range Day Title" required>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => patch({ title: e.target.value })}
                  placeholder="e.g. Q3 Qualification — Pistol"
                  className="tp-input"
                />
              </Field>

              {/* Date */}
              <Field label="Date" required>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => patch({ date: e.target.value })}
                  className="tp-input"
                />
              </Field>

              {/* Time */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start Time" required>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => patch({ startTime: e.target.value })}
                    className="tp-input"
                  />
                </Field>
                <Field label="End Time" required>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => patch({ endTime: e.target.value })}
                    className="tp-input"
                  />
                </Field>
              </div>

              {/* Location */}
              <Field label="Location" required>
                <div className="relative">
                  <select
                    value={form.location}
                    onChange={(e) => patch({ location: e.target.value })}
                    className="tp-select"
                  >
                    <option value="">Select location…</option>
                    {LOCATIONS.map((l) => <option key={l}>{l}</option>)}
                  </select>
                  <ChevronDown size={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-600" />
                </div>
              </Field>

              {/* Range Type */}
              <Field label="Range Type" required>
                <div className="flex flex-wrap gap-2">
                  {RANGE_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => patch({ rangeType: t })}
                      className={`rounded-xl border px-3 py-1.5 text-[12px] font-medium transition ${
                        form.rangeType === t
                          ? "border-blue-500/60 bg-blue-500/15 text-blue-300"
                          : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Qualification Cycle */}
              <Field label="Qualification Cycle">
                <div className="flex flex-wrap gap-2">
                  {QUAL_CYCLES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => patch({ qualCycle: c })}
                      className={`rounded-xl border px-3 py-1.5 text-[12px] font-medium transition ${
                        form.qualCycle === c
                          ? "border-blue-500/60 bg-blue-500/15 text-blue-300"
                          : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Status */}
              <Field label="Initial Status">
                <div className="flex gap-3">
                  {(["Draft", "Scheduled"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => patch({ status: s })}
                      className={`flex-1 rounded-xl border py-2 text-[12px] font-semibold transition ${
                        form.status === s
                          ? s === "Scheduled"
                            ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                            : "border-slate-600 bg-slate-800 text-slate-300"
                          : "border-slate-700 text-slate-500 hover:border-slate-600"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-600">
                  Draft saves without notifying officers. Scheduled marks it active.
                </p>
              </Field>
            </div>
          )}

          {/* ── STEP 2: Staffing ── */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Live staffing indicator */}
              <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                staffingOk
                  ? "border-emerald-500/20 bg-emerald-500/[0.06]"
                  : "border-amber-500/20 bg-amber-500/[0.06]"
              }`}>
                <div className="text-[12px]">
                  <span className={`font-semibold ${staffingOk ? "text-emerald-400" : "text-amber-400"}`}>
                    {staffingOk ? "Meets Policy" : "Understaffed"}
                  </span>
                  <span className="ml-2 text-slate-500">
                    {totalInstructors} instructor{totalInstructors !== 1 ? "s" : ""} · {form.officerIds.length} officers · capacity {capacity || "—"}
                  </span>
                </div>
                {staffingOk
                  ? <CheckCircle2 size={14} className="text-emerald-400" />
                  : <AlertTriangle size={14} className="text-amber-400" />
                }
              </div>

              {/* Range Master */}
              <Field label="Range Master" required>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
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
                      <Shield size={13} className={form.rangeMasterId === inst.id ? "text-blue-400" : "text-slate-600"} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-white">{inst.name}</p>
                        <p className="text-[11px] text-slate-500">#{inst.badge} · {inst.unit}</p>
                      </div>
                      {form.rangeMasterId === inst.id && (
                        <Check size={13} className="flex-shrink-0 text-blue-400" />
                      )}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Additional Instructors */}
              <Field label="Additional Instructors">
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {ROSTER_INSTRUCTORS
                    .filter((i) => i.id !== form.rangeMasterId)
                    .map((inst) => {
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
                          <UserCheck size={13} className={selected ? "text-blue-400" : "text-slate-600"} />
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-white">{inst.name}</p>
                            <p className="text-[11px] text-slate-500">#{inst.badge} · {inst.unit}</p>
                          </div>
                          {selected && <Check size={13} className="flex-shrink-0 text-blue-400" />}
                        </button>
                      );
                    })}
                </div>
              </Field>

              {/* Ratio */}
              <Field label="Instructor-to-Officer Ratio">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] text-slate-500">1 instructor per</span>
                  <div className="relative">
                    <select
                      value={form.ratio}
                      onChange={(e) => patch({ ratio: parseInt(e.target.value) })}
                      className="tp-select w-24 pr-8"
                    >
                      {[4, 5, 6, 8, 10].map((n) => (
                        <option key={n} value={n}>{n} officers</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-600" />
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-slate-600">
                  Range Master counts as an instructor toward ratio.
                </p>
              </Field>
            </div>
          )}

          {/* ── STEP 3: Officers ── */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Selected count */}
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-slate-500">
                  <span className="font-semibold text-white">{form.officerIds.length}</span> officer{form.officerIds.length !== 1 ? "s" : ""} selected
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

              {/* Quick groups */}
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Quick Select</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_GROUPS.map((g) => {
                    const groupIds = ROSTER_OFFICERS.filter(g.filter).map((o) => o.id);
                    const allSelected = groupIds.length > 0 && groupIds.every((id) => form.officerIds.includes(id));
                    return (
                      <button
                        key={g.label}
                        type="button"
                        onClick={() => applyQuickGroup(g.filter)}
                        className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                          allSelected
                            ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                            : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300"
                        }`}
                      >
                        {g.label}
                        <span className="ml-1.5 text-slate-600">({groupIds.length})</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Search */}
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" />
                <input
                  type="text"
                  value={officerSearch}
                  onChange={(e) => setOfficerSearch(e.target.value)}
                  placeholder="Search by name, badge, or unit…"
                  className="tp-input pl-9"
                />
              </div>

              {/* Officer list */}
              <div className="space-y-1.5">
                {filteredOfficers.map((o) => {
                  const selected = form.officerIds.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleOfficer(o.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                        selected
                          ? "border-blue-500/40 bg-blue-500/[0.07]"
                          : "border-slate-800 bg-slate-900 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-slate-400">
                        {o.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-white">{o.rank} {o.name}</p>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500">
                          <span>#{o.badge}</span>
                          <span>·</span>
                          <span>{o.unit}</span>
                          {o.qualDue  && <span className="text-amber-500">Qual Due</span>}
                          {o.rifleDue && <span className="text-orange-500">Rifle Due</span>}
                        </div>
                      </div>
                      {selected && <Check size={13} className="flex-shrink-0 text-blue-400" />}
                    </button>
                  );
                })}
              </div>

              {/* Live staffing warning */}
              {form.officerIds.length > 0 && totalInstructors > 0 && !staffingOk && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-amber-400" />
                  <p className="text-[11px] text-amber-300">
                    {form.officerIds.length} officers exceeds capacity of {capacity} for {totalInstructors} instructor{totalInstructors !== 1 ? "s" : ""}. Add instructors in Step 2 or reduce officer count.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: Drills ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-slate-500">
                  <span className="font-semibold text-white">{form.drillIds.length}</span> drill{form.drillIds.length !== 1 ? "s" : ""} planned
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

              {/* Quick add by range type */}
              {form.rangeType === "Qualification" && (
                <button
                  type="button"
                  onClick={() => {
                    const qualDrillIds = MOCK_DRILLS
                      .filter((d) => d.qualificationRelevant)
                      .map((d) => d.id);
                    patch({ drillIds: Array.from(new Set([...form.drillIds, ...qualDrillIds])) });
                  }}
                  className="w-full rounded-xl border border-blue-500/30 bg-blue-500/[0.07] px-4 py-2.5 text-left text-[12px] text-blue-400 transition hover:bg-blue-500/10"
                >
                  + Add full qualification course ({MOCK_DRILLS.filter(d => d.qualificationRelevant).length} drills)
                </button>
              )}

              {/* Drill library */}
              <div className="space-y-2">
                {MOCK_DRILLS.map((d) => {
                  const selected = form.drillIds.includes(d.id);
                  const catCls = CATEGORY_COLORS[d.category] ?? "bg-slate-500/10 text-slate-400 border-slate-500/20";
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleDrill(d.id)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
                        selected
                          ? "border-blue-500/40 bg-blue-500/[0.07]"
                          : "border-slate-800 bg-slate-900 hover:border-slate-700"
                      }`}
                    >
                      <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition ${
                        selected ? "border-blue-500 bg-blue-500" : "border-slate-700 bg-transparent"
                      }`}>
                        {selected && <Check size={11} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-medium text-white">{d.name}</p>
                          {d.qualificationRelevant && (
                            <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-400">Qual</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{d.description}</p>
                        <div className="mt-1.5 flex items-center gap-3">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${catCls}`}>
                            {d.category}
                          </span>
                          <span className="text-[10px] text-slate-600">{d.rounds > 0 ? `${d.rounds} rds` : "No rounds"}</span>
                          <span className="text-[10px] text-slate-600">{d.durationMin} min</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-800 bg-slate-900/80 px-6 py-4">
          <div className="flex items-center gap-2">
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
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-[12px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
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
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold transition ${
                canAdvance
                  ? "bg-blue-600 text-white hover:bg-blue-500"
                  : "bg-slate-800 text-slate-600 cursor-not-allowed"
              }`}
            >
              Continue
              <ChevronRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-500"
            >
              <CheckCircle2 size={14} />
              Create Range Day
            </button>
          )}
        </div>
      </div>

      {/* Tailwind utility classes used in JSX via string — needed for tp-input / tp-select */}
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
        .tp-input:focus { border-color: rgb(59 130 246); }
        .tp-input::placeholder { color: rgb(71 85 105); }
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
        .tp-select:focus { border-color: rgb(59 130 246); }
        .tp-select option { background: #1e2535; }
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
// Field wrapper helper
// ---------------------------------------------------------------------------

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
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
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
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
    <div className="group relative flex flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 transition-all duration-200 hover:-translate-y-[1px] hover:border-blue-500/40 hover:bg-slate-800/70">

      {/* Card header — entire title area links to detail */}
      <Link href={`/range-days/${rd.id}`} className="block px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={rd.status} />
              <StaffingBadge status={staffing} />
            </div>
            <h3 className="truncate text-[15px] font-semibold text-slate-100 group-hover:text-white transition-colors">{rd.title}</h3>
          </div>
          <ChevronRight size={16} className="mt-0.5 flex-shrink-0 text-slate-600 group-hover:text-slate-400 transition-colors" />
        </div>
      </Link>

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
      <div className="mx-5 border-t border-slate-800/80" />

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
          <div className="mt-3 rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2">
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
      <div className="flex flex-wrap gap-1.5 px-5 pb-4">
        {rd.drills.map((d) => (
          <CategoryPill key={d.id} category={d.category} />
        ))}
      </div>

      {/* Card actions */}
      <div className="flex items-center gap-2 border-t border-slate-800/80 px-5 py-3">
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
          <span className="text-[11px] italic text-slate-700">Finalize setup before scoring</span>
        )}
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
                : "border-slate-800 bg-transparent text-slate-500 hover:border-blue-500/40 hover:text-slate-300"
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
            className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-blue-500/40"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-slate-100">{d.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{d.description}</p>
              </div>
              {d.qualificationRelevant && (
                <span className="flex-shrink-0 rounded-full bg-blue-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-400 border border-blue-500/20">
                  Qual
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 border-t border-slate-800/80 pt-3">
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

function TrainingHistory({ rangeDays }: { rangeDays: RangeDay[] }) {
  const completed = rangeDays.filter((r) => r.status === "Completed")
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <table className="w-full border-collapse text-left">
        <thead className="bg-slate-800/80">
          <tr>
            {["Event", "Date", "Location", "Range Master", "Officers", "Completion", ""].map((h) => (
              <th
                key={h}
                className="border-b border-slate-800 px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600"
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
                className="border-b border-slate-800/80 last:border-b-0 transition-colors hover:bg-slate-800/50"
              >
                <td className="px-4 py-3 text-[13px] font-medium text-slate-100">{rd.title}</td>
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
                  <button className="rounded-lg border border-slate-800 px-2.5 py-1 text-[11px] text-slate-500 transition-colors hover:border-blue-500/40 hover:text-slate-300">
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
          <div key={s.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <p className="mb-5 text-[13px] font-semibold text-slate-100">Officer Completion Rate by Month</p>
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
                    className={`w-full rounded-t-sm transition-all ${isUpcoming ? "bg-slate-800/70 border border-slate-800/80 border-dashed" : "bg-blue-500/70"}`}
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <p className="mb-4 text-[13px] font-semibold text-slate-100">Range Days Conducted per Month</p>
        <div className="space-y-2.5">
          {months.map((m, i) => (
            <div key={m} className="flex items-center gap-3">
              <span className="w-7 flex-shrink-0 text-[11px] text-slate-600">{m}</span>
              <div className="flex flex-1 items-center gap-2">
                <div className="flex flex-1 overflow-hidden rounded-full bg-slate-800/70" style={{ height: 8 }}>
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
// Stat cards
// ---------------------------------------------------------------------------

function StatsStrip({ rangeDays }: { rangeDays: RangeDay[] }) {
  const scheduled  = rangeDays.filter((r) => r.status === "Scheduled").length;
  const completed  = rangeDays.filter((r) => r.status === "Completed").length;
  const draft      = rangeDays.filter((r) => r.status === "Draft").length;
  const understaffed = rangeDays.filter(
    (r) => getStaffingStatus(r) === "Understaffed" && r.status !== "Completed"
  ).length;

  const stats = [
    { label: "Scheduled", value: scheduled, sub: "Active range days", color: "text-blue-400" },
    { label: "Completed", value: completed, sub: "Logged this cycle", color: "text-emerald-400" },
    { label: "Draft", value: draft, sub: "Setup pending", color: "text-slate-300" },
    { label: "Understaffed", value: understaffed, sub: "Needs instructors", color: understaffed > 0 ? "text-amber-400" : "text-slate-500" },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-3xl border border-slate-800 bg-slate-900 p-5 transition-all duration-200 hover:-translate-y-[1px] hover:border-blue-500/40 hover:bg-slate-800/70"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{s.label}</p>
          <p className={`mt-2 text-3xl font-bold leading-none ${s.color}`}>{s.value}</p>
          <p className="mt-2 text-[12px] text-slate-500">{s.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RangeDaysPage() {
  const [activeTab, setActiveTab]   = useState<TabId>("range-days");
  const [statusFilter, setStatusFilter] = useState<RangeDayStatus | "All">("All");
  const [rangeDays, setRangeDays]   = useState<RangeDay[]>(MOCK_RANGE_DAYS);
  const [showDrawer, setShowDrawer] = useState(false);

  function handleCreate(newRD: RangeDay) {
    // Prepend so new card appears at top of the list
    setRangeDays((prev) => [newRD, ...prev]);
  }

  const visibleRangeDays = statusFilter === "All"
    ? rangeDays
    : rangeDays.filter((r) => r.status === statusFilter);

  return (
    <TracePointShell activePage="Range & Training">
      {showDrawer && (
        <CreateRangeDayDrawer
          onClose={() => setShowDrawer(false)}
          onCreate={handleCreate}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900/60 px-5 py-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Range &amp; Training</h1>
            <p className="mt-1 text-sm text-slate-400">
              Range days, drills, scores, and performance history.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-slate-600">
              <span>Updated 2 min ago</span>
              <span>·</span>
              <span>{rangeDays.filter((r) => r.status === "Scheduled").length} range days scheduled</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                System Healthy
              </span>
            </div>
          </div>

          <button
            onClick={() => setShowDrawer(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-[1px] hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-950/40"
          >
            <Plus size={16} />
            Create Range Day
          </button>
        </header>

        {/* Stat cards */}
        <StatsStrip rangeDays={rangeDays} />

        {/* Tabs */}
        <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-1.5">
          <div className="grid gap-1 sm:grid-cols-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? "bg-blue-600/20 text-blue-300 shadow-inner"
                    : "text-slate-500 hover:bg-slate-800/70 hover:text-slate-300"
                }`}
              >
                <tab.icon size={15} className={activeTab === tab.id ? "text-blue-400" : "text-slate-600"} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {activeTab === "range-days" && (
          <div className="space-y-4">
            {/* Filter row */}
            <div className="flex flex-wrap items-center gap-2">
              <Filter size={14} className="text-slate-600" />
              {(["All", "Scheduled", "Draft", "Completed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all duration-200 ${
                    statusFilter === s
                      ? "border-blue-500/50 bg-blue-500/10 text-blue-300"
                      : "border-slate-800 bg-slate-900 text-slate-500 hover:border-blue-500/30 hover:text-slate-300"
                  }`}
                >
                  {s}
                </button>
              ))}
              <span className="ml-auto text-[12px] text-slate-600">
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

        {activeTab === "drill-library" && <DrillLibrary />}
        {activeTab === "training-history" && <TrainingHistory rangeDays={rangeDays} />}
        {activeTab === "performance-trends" && <PerformanceTrends />}
      </div>
    </TracePointShell>
  );
}
