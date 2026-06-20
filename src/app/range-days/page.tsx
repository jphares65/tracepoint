"use client";

import { useEffect, useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Crosshair,
  FileText,
  MapPin,
  Plus,
  Printer,
  Save,
  Shield,
  Target,
  UserCheck,
  Users,
  Wrench,
} from "lucide-react";

import type {
  FirearmMalfunction,
  MalfunctionType,
} from "@/app/lib/tracepoint/types";

import type {
  DrillRunResult,
  DrillTemplate,
  RangeDay,
  RangeDayDrill,
  RangeRosterEntry,
} from "@/app/lib/tracepoint/range-day-types";

import {
  addLibraryDrillToRangeDay,
  createDrillFromTemplate,
  createDrillLibraryTemplate,
  createRangePacket,
  getAttendanceCount,
  getAttendanceRate,
  getAverageScore,
  getMalfunctionCountForRangeDay,
  getPassRate,
  getPerformanceTrend,
  getRangeDayCompletionSummary,
} from "@/app/lib/tracepoint/range-day-utils";

import {
  CURRENT_USER,
  DEMO_DEPARTMENT,
  MOCK_FIREARMS,
  MOCK_USERS,
} from "@/app/lib/tracepoint/mock-data";

type RangeDayType =
  | "Qualification"
  | "Rifle"
  | "Low Light"
  | "Remedial"
  | "Make-Up"
  | "Training";

type PacketStatus = "Needs Setup" | "In Progress" | "Ready";

type PlannedRangeDay = RangeDay & {
  rangeType: RangeDayType;
  startTime: string;
  endTime: string;
  packetStatus: PacketStatus;
  staffingNotes: string;
  outline: string[];
};

const DRILL_TEMPLATES: DrillTemplate[] = [
  {
    id: "template-qual-1",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Handgun Qualification Course",
    category: "Qualification",
    description: "Formal handgun qualification course.",
    instructions:
      "Run the department-approved handgun qualification course. Record score, pass/fail status, firearm used, and instructor notes.",
    firearmType: "Handgun",
    roundCount: 50,
    estimatedMinutes: 30,
    difficulty: "Intermediate",
    defaultScoringMode: "Scored",
    defaultPassingScore: 80,
    defaultMaxScore: 100,
    defaultRunCount: 1,
    defaultRequired: true,
    tags: ["qualification", "handgun", "annual"],
    status: "Active",
    createdByUserId: CURRENT_USER.id,
    createdAt: "2026-06-18T12:00:00Z",
    notes: "Primary handgun qualification template.",
  },
  {
    id: "template-drill-1",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Failure Drill",
    category: "Marksmanship",
    description: "Two rounds to body, one round to head.",
    instructions:
      "Officer begins from the holster or ready position based on range master direction. Record pass/fail and any observed deficiencies.",
    firearmType: "Handgun",
    roundCount: 3,
    estimatedMinutes: 10,
    difficulty: "Intermediate",
    defaultScoringMode: "Pass/Fail",
    defaultRunCount: 3,
    defaultRequired: false,
    tags: ["handgun", "marksmanship", "failure drill"],
    status: "Active",
    createdByUserId: CURRENT_USER.id,
    createdAt: "2026-06-18T12:00:00Z",
    notes: "Useful as a supplemental performance drill.",
  },
  {
    id: "template-drill-2",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Malfunction Clearance",
    category: "Malfunction Clearance",
    description: "Immediate action and remedial action drill.",
    instructions:
      "Use only expected/training-induced malfunctions for the drill. Separately mark any unanticipated malfunction that may indicate a firearm issue.",
    firearmType: "Any",
    roundCount: 6,
    estimatedMinutes: 15,
    difficulty: "Basic",
    defaultScoringMode: "Completion Only",
    defaultRunCount: 3,
    defaultRequired: false,
    tags: ["malfunction", "weapon handling", "remedial action"],
    status: "Active",
    createdByUserId: CURRENT_USER.id,
    createdAt: "2026-06-18T12:00:00Z",
    notes:
      "Training malfunctions should not automatically create armorer alerts unless marked as unanticipated.",
  },
  {
    id: "template-drill-3",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Low Light Decision Making",
    category: "Low Light",
    description: "Low-light threat identification and engagement.",
    instructions:
      "Instructor documents decision-making, target identification, light discipline, and safety observations.",
    firearmType: "Handgun",
    roundCount: 10,
    estimatedMinutes: 20,
    difficulty: "Advanced",
    defaultScoringMode: "Notes Only",
    defaultRunCount: 2,
    defaultRequired: false,
    tags: ["low light", "decision making", "judgment"],
    status: "Active",
    createdByUserId: CURRENT_USER.id,
    createdAt: "2026-06-18T12:00:00Z",
    notes:
      "Designed for qualitative instructor observations rather than numeric scoring.",
  },
  {
    id: "template-rifle-1",
    departmentId: DEMO_DEPARTMENT.id,
    name: "50-Yard Zero Confirmation",
    category: "Rifle",
    description: "Rifle zero confirmation and grouping.",
    instructions:
      "Confirm zero from a supported position. Record completion, notes, and any firearm concerns.",
    firearmType: "Rifle",
    roundCount: 20,
    estimatedMinutes: 20,
    difficulty: "Basic",
    defaultScoringMode: "Completion Only",
    defaultRunCount: 2,
    defaultRequired: true,
    tags: ["rifle", "zero", "familiarization"],
    status: "Active",
    createdByUserId: CURRENT_USER.id,
    createdAt: "2026-06-18T12:00:00Z",
    notes: "Rifle familiarization / zero confirmation template.",
  },
  {
    id: "template-rifle-2",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Rifle to Pistol Transition",
    category: "Transition",
    description: "Transition from rifle to handgun under instructor direction.",
    instructions:
      "Officer safely transitions from rifle to handgun. Instructor records pass/fail and any weapon-handling concerns.",
    firearmType: "Any",
    roundCount: 10,
    estimatedMinutes: 15,
    difficulty: "Advanced",
    defaultScoringMode: "Pass/Fail",
    defaultRunCount: 3,
    defaultRequired: false,
    tags: ["rifle", "handgun", "transition"],
    status: "Active",
    createdByUserId: CURRENT_USER.id,
    createdAt: "2026-06-18T12:00:00Z",
    notes: "Advanced transition drill.",
  },
];

const INITIAL_RANGE_DAYS: PlannedRangeDay[] = [
  {
    id: "range-1",
    departmentId: DEMO_DEPARTMENT.id,
    title: "Fall 2026 Handgun Qualification",
    date: "2026-10-08",
    startTime: "0800",
    endTime: "1200",
    location: "Flemington Indoor Range",
    status: "Planned",
    rangeType: "Qualification",
    packetStatus: "Ready",
    leadInstructorId: "user-3",
    instructorIds: ["user-3", "user-4"],
    weather: "Indoor",
    staffingNotes: "Lead instructor plus one armorer/range safety support.",
    outline: [
      "Safety briefing",
      "Handgun qualification course",
      "Failure drill",
      "Malfunction clearance drill",
    ],
    notes: "Qualification plus supplemental drills.",
  },
  {
    id: "range-2",
    departmentId: DEMO_DEPARTMENT.id,
    title: "Patrol Rifle Familiarization",
    date: "2026-10-22",
    startTime: "0900",
    endTime: "1300",
    location: "Outdoor Training Range",
    status: "Planned",
    rangeType: "Rifle",
    packetStatus: "In Progress",
    leadInstructorId: "user-3",
    instructorIds: ["user-3"],
    weather: "Outdoor",
    staffingNotes: "Needs one additional instructor or armorer before final packet.",
    outline: [
      "Rifle safety briefing",
      "50-yard zero confirmation",
      "Rifle to pistol transition",
      "Instructor notes and deficiencies",
    ],
    notes: "Rifle zero confirmation, transitions, and barricade work.",
  },
  {
    id: "range-3",
    departmentId: DEMO_DEPARTMENT.id,
    title: "Low Light Decision Making",
    date: "2026-11-05",
    startTime: "1800",
    endTime: "2200",
    location: "Flemington Indoor Range",
    status: "Planned",
    rangeType: "Low Light",
    packetStatus: "Needs Setup",
    leadInstructorId: "user-3",
    instructorIds: ["user-3", "user-4"],
    weather: "Indoor",
    staffingNotes: "Two instructors assigned due to low-light decision-making component.",
    outline: [
      "Low-light safety briefing",
      "Threat identification",
      "Light discipline",
      "Decision-making observations",
    ],
    notes: "Low-light identification, movement, and decision-making drills.",
  },
];

const INITIAL_RANGE_ROSTER: RangeRosterEntry[] = [
  {
    id: "roster-1",
    rangeDayId: "range-1",
    officerId: "user-1",
    assignedFirearmIds: ["gun-1"],
    attended: true,
  },
  {
    id: "roster-2",
    rangeDayId: "range-1",
    officerId: "user-2",
    assignedFirearmIds: ["gun-2"],
    attended: true,
  },
  {
    id: "roster-3",
    rangeDayId: "range-2",
    officerId: "user-1",
    assignedFirearmIds: ["gun-2"],
    attended: false,
  },
  {
    id: "roster-4",
    rangeDayId: "range-2",
    officerId: "user-2",
    assignedFirearmIds: ["gun-2"],
    attended: false,
  },
  {
    id: "roster-5",
    rangeDayId: "range-3",
    officerId: "user-1",
    assignedFirearmIds: ["gun-1"],
    attended: false,
  },
];

const INITIAL_RANGE_DRILLS: RangeDayDrill[] = [
  createDrillFromTemplate(DRILL_TEMPLATES[0], "range-1"),
  createDrillFromTemplate(DRILL_TEMPLATES[1], "range-1"),
  createDrillFromTemplate(DRILL_TEMPLATES[2], "range-1"),
  createDrillFromTemplate(DRILL_TEMPLATES[4], "range-2"),
  createDrillFromTemplate(DRILL_TEMPLATES[5], "range-2"),
  createDrillFromTemplate(DRILL_TEMPLATES[3], "range-3"),
  createDrillFromTemplate(DRILL_TEMPLATES[2], "range-3"),
];

const MALFUNCTION_TYPES: MalfunctionType[] = [
  "Failure to Feed",
  "Failure to Eject",
  "Failure to Fire",
  "Light Primer Strike",
  "Magazine Issue",
  "Optic Failure",
  "Weapon Light Failure",
  "Trigger Issue",
  "Catastrophic Failure",
  "Other",
];

const RANGE_STATUSES: PlannedRangeDay["status"][] = [
  "Planned",
  "In Progress",
  "Completed",
  "Locked",
  "Archived",
];

const PACKET_STATUSES: PacketStatus[] = ["Needs Setup", "In Progress", "Ready"];

const RANGE_DAY_TYPES: RangeDayType[] = [
  "Qualification",
  "Rifle",
  "Low Light",
  "Remedial",
  "Make-Up",
  "Training",
];

const DRILL_CATEGORIES: DrillTemplate["category"][] = [
  "Qualification",
  "Marksmanship",
  "Movement",
  "Low Light",
  "Decision Making",
  "Rifle",
  "Shotgun",
  "Transition",
  "Malfunction Clearance",
  "Active Shooter",
  "Administrative",
  "Remedial",
  "Other",
];

const SCORING_MODES: DrillTemplate["defaultScoringMode"][] = [
  "Scored",
  "Pass/Fail",
  "Completion Only",
  "Notes Only",
];

const FIREARM_TYPES: Array<NonNullable<DrillTemplate["firearmType"]>> = [
  "Any",
  "Handgun",
  "Rifle",
  "Shotgun",
  "Less Lethal",
  "Other",
];

const DRILL_DIFFICULTIES: Array<NonNullable<DrillTemplate["difficulty"]>> = [
  "Basic",
  "Intermediate",
  "Advanced",
  "Instructor Discretion",
];

const RANGE_DAY_WORKSPACE_STORAGE_KEY = "tracepoint.rangeDays.workspace.v1";

type StoredRangeDayWorkspace = {
  rangeDays: PlannedRangeDay[];
  drillLibrary: DrillTemplate[];
  rangeDayDrills: RangeDayDrill[];
  rangeRoster: RangeRosterEntry[];
  results: DrillRunResult[];
  malfunctions: FirearmMalfunction[];
};

function loadStoredRangeDayWorkspace(): Partial<StoredRangeDayWorkspace> | null {
  if (typeof window === "undefined") return null;

  try {
    const storedWorkspace = window.localStorage.getItem(
      RANGE_DAY_WORKSPACE_STORAGE_KEY,
    );

    if (!storedWorkspace) return null;

    return JSON.parse(storedWorkspace) as Partial<StoredRangeDayWorkspace>;
  } catch (error) {
    console.warn("Could not load saved range day workspace.", error);
    return null;
  }
}

function writeStoredRangeDayWorkspace(workspace: StoredRangeDayWorkspace) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      RANGE_DAY_WORKSPACE_STORAGE_KEY,
      JSON.stringify(workspace),
    );
  } catch (error) {
    console.warn("Could not save range day workspace.", error);
  }
}

function normalizeRangeDaysForWorkspace(
  storedRangeDays: PlannedRangeDay[],
): PlannedRangeDay[] {
  return storedRangeDays.map((rangeDay) => {
    const storedInstructorIds = Array.isArray(rangeDay.instructorIds)
      ? rangeDay.instructorIds
      : [];

    const fallbackLeadInstructorId =
      rangeDay.leadInstructorId || storedInstructorIds[0] || CURRENT_USER.id;

    const instructorIds = storedInstructorIds.includes(fallbackLeadInstructorId)
      ? storedInstructorIds
      : [fallbackLeadInstructorId, ...storedInstructorIds];

    return {
      ...rangeDay,
      leadInstructorId: fallbackLeadInstructorId,
      instructorIds,
      staffingNotes: rangeDay.staffingNotes ?? "",
      outline: Array.isArray(rangeDay.outline) ? rangeDay.outline : [],
    };
  });
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return undefined;

  const parsed = Number(value);

  return Number.isNaN(parsed) ? undefined : parsed;
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getUserName(userId: string) {
  return MOCK_USERS.find((user) => user.id === userId)?.name ?? "Unknown User";
}

function getFirearmName(firearmId?: string) {
  if (!firearmId) return "No firearm selected";

  const firearm = MOCK_FIREARMS.find((item) => item.id === firearmId);

  if (!firearm) return "Unknown firearm";

  return `${firearm.make} ${firearm.model} (${firearm.serialNumber})`;
}

function StatusPill({
  label,
  tone = "blue",
}: {
  label: string;
  tone?: "blue" | "green" | "amber" | "red" | "slate";
}) {
  const styles = {
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    slate: "border-slate-700 bg-slate-800/60 text-slate-300",
  };

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${styles[tone]}`}
    >
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

export default function RangeDaysPage() {
  const [rangeDays, setRangeDays] =
    useState<PlannedRangeDay[]>(INITIAL_RANGE_DAYS);

  const [selectedRangeDayId, setSelectedRangeDayId] = useState<string | null>(
    null,
  );

  const [drillLibrary, setDrillLibrary] =
    useState<DrillTemplate[]>(DRILL_TEMPLATES);

  const [rangeDayDrills, setRangeDayDrills] =
    useState<RangeDayDrill[]>(INITIAL_RANGE_DRILLS);

  const [rangeRoster, setRangeRoster] =
    useState<RangeRosterEntry[]>(INITIAL_RANGE_ROSTER);

  const [hasLoadedStoredWorkspace, setHasLoadedStoredWorkspace] =
    useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const [showLibraryPanel, setShowLibraryPanel] = useState(false);
  const [showCreateDrillForm, setShowCreateDrillForm] = useState(false);

  const [newDrillName, setNewDrillName] = useState("");
  const [newDrillCategory, setNewDrillCategory] =
    useState<DrillTemplate["category"]>("Marksmanship");
  const [newDrillDescription, setNewDrillDescription] = useState("");
  const [newDrillInstructions, setNewDrillInstructions] = useState("");
  const [newDrillFirearmType, setNewDrillFirearmType] =
    useState<NonNullable<DrillTemplate["firearmType"]>>("Any");
  const [newDrillRoundCount, setNewDrillRoundCount] = useState("");
  const [newDrillEstimatedMinutes, setNewDrillEstimatedMinutes] = useState("");
  const [newDrillDifficulty, setNewDrillDifficulty] =
    useState<NonNullable<DrillTemplate["difficulty"]>>("Basic");
  const [newDrillScoringMode, setNewDrillScoringMode] =
    useState<DrillTemplate["defaultScoringMode"]>("Pass/Fail");
  const [newDrillPassingScore, setNewDrillPassingScore] = useState("");
  const [newDrillMaxScore, setNewDrillMaxScore] = useState("");
  const [newDrillRunCount, setNewDrillRunCount] = useState("1");
  const [newDrillDefaultRequired, setNewDrillDefaultRequired] = useState(false);
  const [newDrillTags, setNewDrillTags] = useState("");
  const [newDrillNotes, setNewDrillNotes] = useState("");
  const [newRosterOfficerId, setNewRosterOfficerId] = useState("");
  const [newInstructorUserId, setNewInstructorUserId] = useState("");

  const [selectedOfficerId, setSelectedOfficerId] = useState("");
  const [selectedDrillId, setSelectedDrillId] = useState("");
  const [selectedRunNumber, setSelectedRunNumber] = useState(1);
  const [score, setScore] = useState("");
  const [passed, setPassed] = useState<boolean | undefined>(undefined);
  const [completed, setCompleted] = useState(true);
  const [notes, setNotes] = useState("");
  const [malfunctionOccurred, setMalfunctionOccurred] = useState(false);
  const [malfunctionType, setMalfunctionType] =
    useState<MalfunctionType>("Failure to Feed");
  const [malfunctionNotes, setMalfunctionNotes] = useState("");
  const [results, setResults] = useState<DrillRunResult[]>([]);
  const [malfunctions, setMalfunctions] = useState<FirearmMalfunction[]>([]);

  const selectedRangeDay = selectedRangeDayId
    ? rangeDays.find((item) => item.id === selectedRangeDayId) ?? null
    : null;

  const selectedRoster = useMemo(() => {
    if (!selectedRangeDay) return [];

    return rangeRoster.filter(
      (entry) => entry.rangeDayId === selectedRangeDay.id,
    );
  }, [rangeRoster, selectedRangeDay]);

  const availableRosterOfficers = useMemo(() => {
    if (!selectedRangeDay) return [];

    const rosteredOfficerIds = new Set(
      selectedRoster.map((entry) => entry.officerId),
    );

    return MOCK_USERS.filter((user) => !rosteredOfficerIds.has(user.id));
  }, [selectedRangeDay, selectedRoster]);

  const availableInstructorUsers = useMemo(() => {
    if (!selectedRangeDay) return [];

    const assignedInstructorIds = new Set(selectedRangeDay.instructorIds ?? []);

    return MOCK_USERS.filter((user) => !assignedInstructorIds.has(user.id));
  }, [selectedRangeDay]);

  const selectedDrills = useMemo(() => {
    if (!selectedRangeDay) return [];

    return rangeDayDrills.filter(
      (drill) => drill.rangeDayId === selectedRangeDay.id,
    );
  }, [rangeDayDrills, selectedRangeDay]);

  const selectedRangeResults = useMemo(() => {
    if (!selectedRangeDay) return [];

    return results.filter((result) => result.rangeDayId === selectedRangeDay.id);
  }, [results, selectedRangeDay]);

  const selectedDrill =
    selectedDrills.find((drill) => drill.id === selectedDrillId) ??
    selectedDrills[0];

  const selectedRosterEntry = selectedRoster.find(
    (entry) => entry.officerId === selectedOfficerId,
  );

  const selectedFirearmId = selectedRosterEntry?.assignedFirearmIds[0];

  const selectedOfficerResults = useMemo(
    () =>
      selectedRangeResults.filter(
        (result) => result.officerId === selectedOfficerId,
      ),
    [selectedRangeResults, selectedOfficerId],
  );

  const completionSummary = useMemo(
    () =>
      getRangeDayCompletionSummary(
        selectedRoster,
        selectedDrills,
        selectedRangeResults,
      ),
    [selectedRoster, selectedDrills, selectedRangeResults],
  );

  useEffect(() => {
    const storedWorkspace = loadStoredRangeDayWorkspace();

    if (Array.isArray(storedWorkspace?.rangeDays)) {
      setRangeDays(normalizeRangeDaysForWorkspace(storedWorkspace.rangeDays));
    }

    if (Array.isArray(storedWorkspace?.drillLibrary)) {
      setDrillLibrary(storedWorkspace.drillLibrary);
    }

    if (Array.isArray(storedWorkspace?.rangeDayDrills)) {
      setRangeDayDrills(storedWorkspace.rangeDayDrills);
    }

    if (Array.isArray(storedWorkspace?.rangeRoster)) {
      setRangeRoster(storedWorkspace.rangeRoster);
    }

    if (Array.isArray(storedWorkspace?.results)) {
      setResults(storedWorkspace.results);
    }

    if (Array.isArray(storedWorkspace?.malfunctions)) {
      setMalfunctions(storedWorkspace.malfunctions);
    }

    setHasLoadedStoredWorkspace(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedStoredWorkspace) return;

    writeStoredRangeDayWorkspace({
      rangeDays,
      drillLibrary,
      rangeDayDrills,
      rangeRoster,
      results,
      malfunctions,
    });
  }, [
    drillLibrary,
    hasLoadedStoredWorkspace,
    malfunctions,
    rangeDayDrills,
    rangeDays,
    rangeRoster,
    results,
  ]);

  useEffect(() => {
    if (!selectedRangeDay) return;

    if (availableRosterOfficers.length === 0) {
      setNewRosterOfficerId("");
      return;
    }

    const selectedOfficerIsAvailable = availableRosterOfficers.some(
      (user) => user.id === newRosterOfficerId,
    );

    if (!selectedOfficerIsAvailable) {
      setNewRosterOfficerId(availableRosterOfficers[0].id);
    }
  }, [availableRosterOfficers, newRosterOfficerId, selectedRangeDay]);

  useEffect(() => {
    if (!selectedRangeDay) return;

    if (availableInstructorUsers.length === 0) {
      setNewInstructorUserId("");
      return;
    }

    const selectedInstructorIsAvailable = availableInstructorUsers.some(
      (user) => user.id === newInstructorUserId,
    );

    if (!selectedInstructorIsAvailable) {
      setNewInstructorUserId(availableInstructorUsers[0].id);
    }
  }, [availableInstructorUsers, newInstructorUserId, selectedRangeDay]);

  function resetEntryForm(nextRun?: number) {
    setScore("");
    setPassed(undefined);
    setCompleted(true);
    setNotes("");
    setMalfunctionOccurred(false);
    setMalfunctionType("Failure to Feed");
    setMalfunctionNotes("");
    setSelectedRunNumber(nextRun ?? 1);
  }

  function resetNewDrillForm() {
    setNewDrillName("");
    setNewDrillCategory("Marksmanship");
    setNewDrillDescription("");
    setNewDrillInstructions("");
    setNewDrillFirearmType("Any");
    setNewDrillRoundCount("");
    setNewDrillEstimatedMinutes("");
    setNewDrillDifficulty("Basic");
    setNewDrillScoringMode("Pass/Fail");
    setNewDrillPassingScore("");
    setNewDrillMaxScore("");
    setNewDrillRunCount("1");
    setNewDrillDefaultRequired(false);
    setNewDrillTags("");
    setNewDrillNotes("");
  }

  function openRangeDay(rangeDayId: string) {
    const firstRoster = rangeRoster.find(
      (entry) => entry.rangeDayId === rangeDayId,
    );

    const firstDrill = rangeDayDrills.find(
      (drill) => drill.rangeDayId === rangeDayId,
    );

    setSelectedRangeDayId(rangeDayId);
    setSelectedOfficerId(firstRoster?.officerId ?? "");
    setSelectedDrillId(firstDrill?.id ?? "");
    setShowLibraryPanel(false);
    setShowCreateDrillForm(false);
    resetEntryForm(1);
  }

  function goBackToOverview() {
    setSelectedRangeDayId(null);
    setShowLibraryPanel(false);
    setShowCreateDrillForm(false);
    resetEntryForm(1);
  }

  function handleCreateRangeDay() {
    const today = new Date().toISOString().slice(0, 10);
    const newRangeDayId = `range-${Date.now()}`;

    const newRangeDay: PlannedRangeDay = {
      id: newRangeDayId,
      departmentId: DEMO_DEPARTMENT.id,
      title: "New Range Day",
      date: today,
      startTime: "0800",
      endTime: "1200",
      location: "",
      status: "Planned",
      rangeType: "Training",
      packetStatus: "Needs Setup",
      leadInstructorId: CURRENT_USER.id,
      instructorIds: [CURRENT_USER.id],
      weather: "",
      staffingNotes: "",
      outline: [],
      notes: "",
    };

    setRangeDays((current) => [newRangeDay, ...current]);
    setSelectedRangeDayId(newRangeDayId);
    setSelectedOfficerId("");
    setSelectedDrillId("");
    setShowLibraryPanel(false);
    setShowCreateDrillForm(false);
    resetEntryForm(1);
  }

  function updateSelectedRangeDay<Key extends keyof PlannedRangeDay>(
    key: Key,
    value: PlannedRangeDay[Key],
  ) {
    if (!selectedRangeDay) return;

    setRangeDays((current) =>
      current.map((rangeDay) =>
        rangeDay.id === selectedRangeDay.id
          ? {
              ...rangeDay,
              [key]: value,
            }
          : rangeDay,
      ),
    );
  }

  function handleSaveRangeDayWorkspace() {
    writeStoredRangeDayWorkspace({
      rangeDays,
      drillLibrary,
      rangeDayDrills,
      rangeRoster,
      results,
      malfunctions,
    });

    setSaveMessage("Saved locally");

    if (typeof window !== "undefined") {
      window.setTimeout(() => setSaveMessage(""), 2000);
    }
  }

  function handleSetLeadInstructor(userId: string) {
    if (!selectedRangeDay || !userId) return;

    const currentInstructorIds = selectedRangeDay.instructorIds ?? [];

    const instructorIds = currentInstructorIds.includes(userId)
      ? currentInstructorIds
      : [...currentInstructorIds, userId];

    setRangeDays((current) =>
      current.map((rangeDay) =>
        rangeDay.id === selectedRangeDay.id
          ? {
              ...rangeDay,
              leadInstructorId: userId,
              instructorIds,
            }
          : rangeDay,
      ),
    );
  }

  function handleAddInstructorToRangeDay() {
    if (!selectedRangeDay || !newInstructorUserId) return;

    const currentInstructorIds = selectedRangeDay.instructorIds ?? [];

    if (currentInstructorIds.includes(newInstructorUserId)) return;

    setRangeDays((current) =>
      current.map((rangeDay) =>
        rangeDay.id === selectedRangeDay.id
          ? {
              ...rangeDay,
              instructorIds: [...currentInstructorIds, newInstructorUserId],
            }
          : rangeDay,
      ),
    );
  }

  function handleRemoveInstructorFromRangeDay(userId: string) {
    if (!selectedRangeDay) return;

    const remainingInstructorIds = (selectedRangeDay.instructorIds ?? []).filter(
      (instructorId) => instructorId !== userId,
    );

    const nextLeadInstructorId =
      selectedRangeDay.leadInstructorId === userId
        ? remainingInstructorIds[0] ?? CURRENT_USER.id
        : selectedRangeDay.leadInstructorId;

    const nextInstructorIds = remainingInstructorIds.includes(
      nextLeadInstructorId,
    )
      ? remainingInstructorIds
      : [nextLeadInstructorId, ...remainingInstructorIds];

    setRangeDays((current) =>
      current.map((rangeDay) =>
        rangeDay.id === selectedRangeDay.id
          ? {
              ...rangeDay,
              leadInstructorId: nextLeadInstructorId,
              instructorIds: nextInstructorIds,
            }
          : rangeDay,
      ),
    );
  }

  function handleAddOfficerToRoster() {
    if (!selectedRangeDay || !newRosterOfficerId) return;

    const alreadyRostered = selectedRoster.some(
      (entry) => entry.officerId === newRosterOfficerId,
    );

    if (alreadyRostered) return;

    const defaultFirearmId = MOCK_FIREARMS[0]?.id;

    const newRosterEntry: RangeRosterEntry = {
      id: `roster-${Date.now()}`,
      rangeDayId: selectedRangeDay.id,
      officerId: newRosterOfficerId,
      assignedFirearmIds: defaultFirearmId ? [defaultFirearmId] : [],
      attended: false,
    };

    setRangeRoster((current) => [...current, newRosterEntry]);
    setSelectedOfficerId(newRosterOfficerId);
    resetEntryForm(1);
  }

  function handleRemoveOfficerFromRoster(rosterEntryId: string) {
    const entryToRemove = rangeRoster.find((entry) => entry.id === rosterEntryId);

    setRangeRoster((current) =>
      current.filter((entry) => entry.id !== rosterEntryId),
    );

    if (selectedRangeDay && entryToRemove) {
      setResults((current) =>
        current.filter(
          (result) =>
            !(
              result.rangeDayId === selectedRangeDay.id &&
              result.officerId === entryToRemove.officerId
            ),
        ),
      );
    }

    if (entryToRemove?.officerId === selectedOfficerId) {
      const nextRosterEntry = selectedRoster.find(
        (entry) => entry.id !== rosterEntryId,
      );

      setSelectedOfficerId(nextRosterEntry?.officerId ?? "");
      resetEntryForm(1);
    }
  }

  function handleToggleRosterAttendance(rosterEntryId: string) {
    setRangeRoster((current) =>
      current.map((entry) =>
        entry.id === rosterEntryId
          ? {
              ...entry,
              attended: !entry.attended,
            }
          : entry,
      ),
    );
  }

  function handleChangeRosterFirearm(rosterEntryId: string, firearmId: string) {
    setRangeRoster((current) =>
      current.map((entry) =>
        entry.id === rosterEntryId
          ? {
              ...entry,
              assignedFirearmIds: firearmId ? [firearmId] : [],
            }
          : entry,
      ),
    );
  }

  function handleSaveResult() {
    if (!selectedRangeDay || !selectedDrill || !selectedOfficerId) return;

    const malfunctionId =
      malfunctionOccurred && selectedFirearmId
        ? `malfunction-${Date.now()}`
        : undefined;

    const newResult: DrillRunResult = {
      id: `result-${Date.now()}`,
      rangeDayId: selectedRangeDay.id,
      drillId: selectedDrill.id,
      officerId: selectedOfficerId,
      firearmId: selectedFirearmId,
      runNumber: selectedRunNumber,
      completed,
      score:
        selectedDrill.scoringMode === "Scored" && score
          ? Number(score)
          : undefined,
      passed:
        selectedDrill.scoringMode === "Pass/Fail" ||
        selectedDrill.scoringMode === "Scored"
          ? passed
          : undefined,
      instructorId: CURRENT_USER.id,
      notes,
      deficiencyObserved: passed === false,
      remedialTrainingRecommended: passed === false,
      malfunctionIds: malfunctionId ? [malfunctionId] : [],
    };

    setResults((current) => [
      ...current.filter(
        (result) =>
          !(
            result.officerId === selectedOfficerId &&
            result.drillId === selectedDrill.id &&
            result.runNumber === selectedRunNumber
          ),
      ),
      newResult,
    ]);

    if (malfunctionId && selectedFirearmId) {
      const newMalfunction: FirearmMalfunction = {
        id: malfunctionId,
        departmentId: DEMO_DEPARTMENT.id,
        firearmId: selectedFirearmId,
        officerId: selectedOfficerId,
        rangeDayId: selectedRangeDay.id,
        drillRunId: newResult.id,
        type: malfunctionType,
        date: new Date().toISOString(),
        resolvedOnRange: false,
        removedFromService: malfunctionType === "Catastrophic Failure",
        inspectionRequired: true,
        notes: malfunctionNotes,
        reportedByUserId: CURRENT_USER.id,
      };

      setMalfunctions((current) => [...current, newMalfunction]);
    }

    const nextRun =
      selectedRunNumber < selectedDrill.runCount
        ? selectedRunNumber + 1
        : selectedRunNumber;

    resetEntryForm(nextRun);
  }

  function handleGeneratePacket() {
    if (!selectedRangeDay) return;

    const packet = createRangePacket(selectedRangeDay, CURRENT_USER.id);
    console.log("Generated range packet:", packet);
    window.print();
  }

  function handleCreateDrillTemplate() {
    if (!newDrillName.trim()) return;

    const createdTemplate = createDrillLibraryTemplate({
      departmentId: DEMO_DEPARTMENT.id,
      name: newDrillName.trim(),
      category: newDrillCategory,
      description: newDrillDescription.trim() || undefined,
      instructions: newDrillInstructions.trim() || undefined,
      firearmType: newDrillFirearmType,
      roundCount: parseOptionalNumber(newDrillRoundCount),
      estimatedMinutes: parseOptionalNumber(newDrillEstimatedMinutes),
      difficulty: newDrillDifficulty,
      defaultScoringMode: newDrillScoringMode,
      defaultPassingScore:
        newDrillScoringMode === "Scored"
          ? parseOptionalNumber(newDrillPassingScore)
          : undefined,
      defaultMaxScore:
        newDrillScoringMode === "Scored"
          ? parseOptionalNumber(newDrillMaxScore)
          : undefined,
      defaultRunCount: Math.max(Number(newDrillRunCount) || 1, 1),
      defaultRequired: newDrillDefaultRequired,
      tags: newDrillTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      createdByUserId: CURRENT_USER.id,
      notes: newDrillNotes.trim() || undefined,
    });

    setDrillLibrary((current) => [createdTemplate, ...current]);
    resetNewDrillForm();
    setShowCreateDrillForm(false);
  }

  function handleAddTemplateToSelectedRangeDay(templateId: string) {
    if (!selectedRangeDay) return;

    const copiedDrill = addLibraryDrillToRangeDay(
      {
        rangeDayId: selectedRangeDay.id,
        templateId,
      },
      drillLibrary,
    );

    if (!copiedDrill) return;

    setRangeDayDrills((current) => [...current, copiedDrill]);
    setSelectedDrillId(copiedDrill.id);
    resetEntryForm(1);
  }

  if (!selectedRangeDay) {
    const totalDrills = rangeDayDrills.length;
    const totalRoster = rangeRoster.length;
    const readyPackets = rangeDays.filter(
      (rangeDay) => rangeDay.packetStatus === "Ready",
    ).length;

    return (
      <TracePointShell activePage="Range & Training">
        <div className="mx-auto w-full max-w-[1600px] space-y-5">
          <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-[22px] font-bold text-white">
                  Range &amp; Training
                </h1>
                <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
                  Review scheduled range days, staffing, planned drills, packet
                  status, and readiness before opening a specific range day.
                </p>
              </div>

              <button
                type="button"
                onClick={handleCreateRangeDay}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500"
              >
                <Plus size={14} />
                New Range Day
              </button>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label="Scheduled"
              value={rangeDays.length}
              sub="Range days"
            />
            <StatCard
              label="Roster Slots"
              value={totalRoster}
              sub="Officers assigned"
            />
            <StatCard
              label="Planned Drills"
              value={totalDrills}
              sub="Across all days"
            />
            <StatCard
              label="Packets Ready"
              value={readyPackets}
              sub="Ready to print"
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {rangeDays.map((rangeDay) => {
              const dayRoster = rangeRoster.filter(
                (entry) => entry.rangeDayId === rangeDay.id,
              );

              const dayDrills = rangeDayDrills.filter(
                (drill) => drill.rangeDayId === rangeDay.id,
              );

              const dayResults = results.filter(
                (result) => result.rangeDayId === rangeDay.id,
              );

              const daySummary = getRangeDayCompletionSummary(
                dayRoster,
                dayDrills,
                dayResults,
              );

              const malfunctionCount = getMalfunctionCountForRangeDay(dayResults);

              return (
                <button
                  key={rangeDay.id}
                  type="button"
                  onClick={() => openRangeDay(rangeDay.id)}
                  className="group flex h-full flex-col rounded-3xl border border-slate-800 bg-slate-900 p-4 text-left transition hover:-translate-y-[1px] hover:border-blue-500/40 hover:bg-slate-800/70"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="mb-2 flex flex-wrap gap-2">
                        <StatusPill label={rangeDay.status} />
                        <StatusPill label={rangeDay.rangeType} tone="slate" />
                        <StatusPill
                          label={rangeDay.packetStatus}
                          tone={
                            rangeDay.packetStatus === "Ready"
                              ? "green"
                              : rangeDay.packetStatus === "In Progress"
                                ? "amber"
                                : "red"
                          }
                        />
                      </div>

                      <h2 className="text-[16px] font-bold text-white">
                        {rangeDay.title}
                      </h2>
                      <p className="mt-1 text-[12px] text-slate-500">
                        {rangeDay.notes}
                      </p>
                    </div>

                    <ChevronRight
                      size={18}
                      className="mt-1 text-slate-600 transition group-hover:text-blue-300"
                    />
                  </div>

                  <div className="space-y-2 text-[12px] text-slate-400">
                    <p className="flex items-center gap-2">
                      <CalendarDays size={13} className="text-slate-600" />
                      {formatDate(rangeDay.date)} · {rangeDay.startTime}-
                      {rangeDay.endTime}
                    </p>

                    <p className="flex items-center gap-2">
                      <MapPin size={13} className="text-slate-600" />
                      {rangeDay.location}
                    </p>

                    <p className="flex items-center gap-2">
                      <Shield size={13} className="text-slate-600" />
                      Lead: {getUserName(rangeDay.leadInstructorId)}
                    </p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Day Outline
                    </p>
                    <ul className="space-y-1 text-[11px] text-slate-400">
                      {rangeDay.outline.slice(0, 4).map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Staffing
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {rangeDay.staffingNotes}
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-800 pt-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Roster
                      </p>
                      <p className="mt-1 text-[14px] font-bold text-white">
                        {dayRoster.length}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Drills
                      </p>
                      <p className="mt-1 text-[14px] font-bold text-white">
                        {dayDrills.length}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Attend
                      </p>
                      <p className="mt-1 text-[14px] font-bold text-white">
                        {getAttendanceRate(dayRoster)}%
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-600">
                        Done
                      </p>
                      <p className="mt-1 text-[14px] font-bold text-white">
                        {daySummary.completionRate}%
                      </p>
                    </div>
                  </div>

                  {malfunctionCount > 0 && (
                    <div className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-300">
                      <AlertTriangle size={13} />
                      {malfunctionCount} malfunction record
                      {malfunctionCount !== 1 ? "s" : ""}
                    </div>
                  )}
                </button>
              );
            })}
          </section>
        </div>
      </TracePointShell>
    );
  }

  return (
    <TracePointShell activePage="Range & Training">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <button
                type="button"
                onClick={goBackToOverview}
                className="mb-3 inline-flex items-center gap-2 text-[12px] font-semibold text-slate-500 hover:text-white"
              >
                <ArrowLeft size={14} />
                Back to Range Day Overview
              </button>

              <div className="mb-2 flex flex-wrap gap-2">
                <StatusPill label={selectedRangeDay.status} />
                <StatusPill label={selectedRangeDay.rangeType} tone="slate" />
                <StatusPill
                  label={selectedRangeDay.packetStatus}
                  tone={
                    selectedRangeDay.packetStatus === "Ready"
                      ? "green"
                      : selectedRangeDay.packetStatus === "In Progress"
                        ? "amber"
                        : "red"
                  }
                />
              </div>

              <h1 className="text-[22px] font-bold text-white">
                {selectedRangeDay.title}
              </h1>
              <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
                Edit this range day, manage staffing and drills, print the packet,
                score live, and log firearm malfunctions.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGeneratePacket}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                <Printer size={14} />
                Print Packet
              </button>

              <button
                type="button"
                onClick={handleSaveRangeDayWorkspace}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500"
              >
                <Save size={14} />
                {saveMessage || "Save Range Day"}
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <StatCard
            label="Roster"
            value={selectedRoster.length}
            sub="Officers assigned"
          />
          <StatCard
            label="Attendance"
            value={`${getAttendanceRate(selectedRoster)}%`}
            sub={`${getAttendanceCount(selectedRoster)} present`}
          />
          <StatCard
            label="Drills"
            value={selectedDrills.length}
            sub="Planned events"
          />
          <StatCard
            label="Completion"
            value={`${completionSummary.completionRate}%`}
            sub={`${completionSummary.completedRuns}/${completionSummary.expectedRuns} runs`}
          />
          <StatCard
            label="Malfunctions"
            value={getMalfunctionCountForRangeDay(selectedRangeResults)}
            sub="Linked to firearms"
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-[420px_1fr]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-4 text-[15px] font-bold text-white">
                Editable Range Day Card
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Title
                  </label>
                  <input
                    value={selectedRangeDay.title}
                    onChange={(event) =>
                      updateSelectedRangeDay("title", event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Date
                    </label>
                    <input
                      type="date"
                      value={selectedRangeDay.date}
                      onChange={(event) =>
                        updateSelectedRangeDay("date", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Status
                    </label>
                    <select
                      value={selectedRangeDay.status}
                      onChange={(event) =>
                        updateSelectedRangeDay(
                          "status",
                          event.target.value as PlannedRangeDay["status"],
                        )
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                    >
                      {RANGE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Start
                    </label>
                    <input
                      value={selectedRangeDay.startTime}
                      onChange={(event) =>
                        updateSelectedRangeDay("startTime", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      End
                    </label>
                    <input
                      value={selectedRangeDay.endTime}
                      onChange={(event) =>
                        updateSelectedRangeDay("endTime", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Location
                  </label>
                  <input
                    value={selectedRangeDay.location}
                    onChange={(event) =>
                      updateSelectedRangeDay("location", event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Type
                  </label>
                  <select
                    value={selectedRangeDay.rangeType}
                    onChange={(event) =>
                      updateSelectedRangeDay(
                        "rangeType",
                        event.target.value as RangeDayType,
                      )
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {RANGE_DAY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Packet Status
                  </label>
                  <select
                    value={selectedRangeDay.packetStatus}
                    onChange={(event) =>
                      updateSelectedRangeDay(
                        "packetStatus",
                        event.target.value as PacketStatus,
                      )
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {PACKET_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Staffing Notes
                  </label>
                  <textarea
                    value={selectedRangeDay.staffingNotes}
                    onChange={(event) =>
                      updateSelectedRangeDay("staffingNotes", event.target.value)
                    }
                    rows={3}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Notes
                  </label>
                  <textarea
                    value={selectedRangeDay.notes ?? ""}
                    onChange={(event) =>
                      updateSelectedRangeDay("notes", event.target.value)
                    }
                    rows={3}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                <Users size={15} className="text-blue-400" />
                Staffing
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Lead Instructor
                  </label>
                  <select
                    value={selectedRangeDay.leadInstructorId}
                    onChange={(event) => handleSetLeadInstructor(event.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {MOCK_USERS.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Add Instructor
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <select
                      value={newInstructorUserId}
                      onChange={(event) =>
                        setNewInstructorUserId(event.target.value)
                      }
                      disabled={availableInstructorUsers.length === 0}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none disabled:cursor-not-allowed disabled:text-slate-600 focus:border-blue-500"
                    >
                      {availableInstructorUsers.length === 0 ? (
                        <option value="">All users are assigned</option>
                      ) : (
                        availableInstructorUsers.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name}
                          </option>
                        ))
                      )}
                    </select>

                    <button
                      type="button"
                      onClick={handleAddInstructorToRangeDay}
                      disabled={availableInstructorUsers.length === 0}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
                    >
                      <Plus size={14} />
                      Add
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {(selectedRangeDay.instructorIds ?? []).map((instructorId) => {
                    const isLead = instructorId === selectedRangeDay.leadInstructorId;

                    return (
                      <div
                        key={instructorId}
                        className="rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-[13px] font-semibold text-white">
                              {getUserName(instructorId)}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">
                              {isLead ? "Lead instructor" : "Assigned instructor"}
                            </p>
                          </div>

                          {isLead && <StatusPill label="Lead" tone="green" />}
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleSetLeadInstructor(instructorId)}
                            disabled={isLead}
                            className="rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-semibold text-slate-400 hover:border-slate-600 hover:text-slate-200 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
                          >
                            {isLead ? "Current Lead" : "Make Lead"}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveInstructorFromRangeDay(instructorId)
                            }
                            disabled={(selectedRangeDay.instructorIds ?? []).length <= 1}
                            className="rounded-xl border border-red-500/30 px-3 py-2 text-[11px] font-semibold text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600 disabled:hover:bg-transparent"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-[12px] text-slate-500">
                  {selectedRangeDay.staffingNotes ||
                    "Use the staffing notes field above for range safety, armorer, or coverage notes."}
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                <Users size={15} className="text-blue-400" />
                Roster
              </h3>

              <div className="mb-3 grid gap-2">
                <select
                  value={newRosterOfficerId}
                  onChange={(event) => setNewRosterOfficerId(event.target.value)}
                  disabled={availableRosterOfficers.length === 0}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none disabled:cursor-not-allowed disabled:text-slate-600 focus:border-blue-500"
                >
                  {availableRosterOfficers.length === 0 ? (
                    <option value="">All officers are rostered</option>
                  ) : (
                    availableRosterOfficers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))
                  )}
                </select>

                <button
                  type="button"
                  onClick={handleAddOfficerToRoster}
                  disabled={availableRosterOfficers.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
                >
                  <Plus size={14} />
                  Add Officer
                </button>
              </div>

              <div className="space-y-2">
                {selectedRoster.length === 0 && (
                  <p className="rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-[12px] text-slate-500">
                    No officers assigned yet. Add officers above to build the
                    range day roster.
                  </p>
                )}

                {selectedRoster.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-2xl border px-3 py-3 transition ${
                      selectedOfficerId === entry.officerId
                        ? "border-blue-500/50 bg-blue-500/10"
                        : "border-slate-800 bg-slate-950/40"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOfficerId(entry.officerId);
                        resetEntryForm(1);
                      }}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <div>
                        <p className="text-[13px] font-semibold text-white">
                          {getUserName(entry.officerId)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {entry.attended ? "Marked present" : "Not marked present"}
                        </p>
                      </div>

                      {entry.attended && (
                        <CheckCircle2 size={14} className="text-emerald-400" />
                      )}
                    </button>

                    <div className="mt-3 space-y-2">
                      <select
                        value={entry.assignedFirearmIds[0] ?? ""}
                        onChange={(event) =>
                          handleChangeRosterFirearm(entry.id, event.target.value)
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[12px] text-white outline-none focus:border-blue-500"
                      >
                        <option value="">No firearm selected</option>
                        {MOCK_FIREARMS.map((firearm) => (
                          <option key={firearm.id} value={firearm.id}>
                            {getFirearmName(firearm.id)}
                          </option>
                        ))}
                      </select>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleRosterAttendance(entry.id)}
                          className={`rounded-xl border px-3 py-2 text-[11px] font-semibold ${
                            entry.attended
                              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                              : "border-slate-700 text-slate-400 hover:border-slate-600"
                          }`}
                        >
                          {entry.attended ? "Present" : "Mark Present"}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveOfficerFromRoster(entry.id)}
                          className="rounded-xl border border-red-500/30 px-3 py-2 text-[11px] font-semibold text-red-300 hover:bg-red-500/10"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-[14px] font-bold text-white">
                  <Target size={15} className="text-blue-400" />
                  Planned Drills
                </h3>

                <button
                  type="button"
                  onClick={() => setShowLibraryPanel((current) => !current)}
                  className="rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
                >
                  {showLibraryPanel ? "Hide Library" : "Add Drill"}
                </button>
              </div>

              <div className="space-y-2">
                {selectedDrills.map((drill) => (
                  <button
                    key={drill.id}
                    type="button"
                    onClick={() => {
                      setSelectedDrillId(drill.id);
                      resetEntryForm(1);
                    }}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      selectedDrill?.id === drill.id
                        ? "border-blue-500/50 bg-blue-500/10"
                        : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-semibold text-white">
                          {drill.name}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {drill.description}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                        {drill.runCount} run{drill.runCount !== 1 ? "s" : ""}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusPill label={drill.category} />
                      <StatusPill label={drill.scoringMode} tone="slate" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            {showLibraryPanel && (
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-[17px] font-bold text-white">
                      Add Drill From Library
                    </h2>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Add reusable library drills to this range day. Each added
                      drill is copied as a snapshot.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowCreateDrillForm((current) => !current)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500"
                  >
                    <Plus size={14} />
                    {showCreateDrillForm ? "Close Form" : "Create Drill"}
                  </button>
                </div>

                {showCreateDrillForm && (
                  <div className="mt-5 rounded-3xl border border-blue-500/30 bg-blue-500/[0.06] p-4">
                    <h3 className="mb-4 text-[15px] font-bold text-white">
                      Create New Drill Template
                    </h3>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Drill Name
                        </label>
                        <input
                          type="text"
                          value={newDrillName}
                          onChange={(event) =>
                            setNewDrillName(event.target.value)
                          }
                          placeholder="Example: 7 Yard Failure Drill"
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Category
                        </label>
                        <select
                          value={newDrillCategory}
                          onChange={(event) =>
                            setNewDrillCategory(
                              event.target.value as DrillTemplate["category"],
                            )
                          }
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        >
                          {DRILL_CATEGORIES.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Firearm Type
                        </label>
                        <select
                          value={newDrillFirearmType}
                          onChange={(event) =>
                            setNewDrillFirearmType(
                              event.target.value as NonNullable<
                                DrillTemplate["firearmType"]
                              >,
                            )
                          }
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        >
                          {FIREARM_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Difficulty
                        </label>
                        <select
                          value={newDrillDifficulty}
                          onChange={(event) =>
                            setNewDrillDifficulty(
                              event.target.value as NonNullable<
                                DrillTemplate["difficulty"]
                              >,
                            )
                          }
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        >
                          {DRILL_DIFFICULTIES.map((difficulty) => (
                            <option key={difficulty} value={difficulty}>
                              {difficulty}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Scoring Mode
                        </label>
                        <select
                          value={newDrillScoringMode}
                          onChange={(event) =>
                            setNewDrillScoringMode(
                              event.target
                                .value as DrillTemplate["defaultScoringMode"],
                            )
                          }
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        >
                          {SCORING_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {mode}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Default Run Count
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={newDrillRunCount}
                          onChange={(event) =>
                            setNewDrillRunCount(event.target.value)
                          }
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        />
                      </div>

                      {newDrillScoringMode === "Scored" && (
                        <>
                          <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                              Passing Score
                            </label>
                            <input
                              type="number"
                              value={newDrillPassingScore}
                              onChange={(event) =>
                                setNewDrillPassingScore(event.target.value)
                              }
                              placeholder="Example: 80"
                              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                              Max Score
                            </label>
                            <input
                              type="number"
                              value={newDrillMaxScore}
                              onChange={(event) =>
                                setNewDrillMaxScore(event.target.value)
                              }
                              placeholder="Example: 100"
                              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                            />
                          </div>
                        </>
                      )}

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Round Count
                        </label>
                        <input
                          type="number"
                          value={newDrillRoundCount}
                          onChange={(event) =>
                            setNewDrillRoundCount(event.target.value)
                          }
                          placeholder="Optional"
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Estimated Minutes
                        </label>
                        <input
                          type="number"
                          value={newDrillEstimatedMinutes}
                          onChange={(event) =>
                            setNewDrillEstimatedMinutes(event.target.value)
                          }
                          placeholder="Optional"
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Description
                        </label>
                        <textarea
                          value={newDrillDescription}
                          onChange={(event) =>
                            setNewDrillDescription(event.target.value)
                          }
                          rows={2}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        />
                      </div>

                      <div className="lg:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Instructions
                        </label>
                        <textarea
                          value={newDrillInstructions}
                          onChange={(event) =>
                            setNewDrillInstructions(event.target.value)
                          }
                          rows={3}
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Tags
                        </label>
                        <input
                          value={newDrillTags}
                          onChange={(event) =>
                            setNewDrillTags(event.target.value)
                          }
                          placeholder="handgun, low light, remedial"
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                          Notes
                        </label>
                        <input
                          value={newDrillNotes}
                          onChange={(event) =>
                            setNewDrillNotes(event.target.value)
                          }
                          placeholder="Optional internal note"
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          setNewDrillDefaultRequired((current) => !current)
                        }
                        className={`rounded-xl border px-3 py-2 text-[12px] font-semibold ${
                          newDrillDefaultRequired
                            ? "border-blue-500/50 bg-blue-500/10 text-blue-300"
                            : "border-slate-700 text-slate-400"
                        }`}
                      >
                        {newDrillDefaultRequired
                          ? "Default: Required"
                          : "Default: Optional"}
                      </button>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            resetNewDrillForm();
                            setShowCreateDrillForm(false);
                          }}
                          className="rounded-xl border border-slate-700 px-4 py-2 text-[12px] font-semibold text-slate-400 hover:border-slate-600 hover:text-slate-200"
                        >
                          Cancel
                        </button>

                        <button
                          type="button"
                          onClick={handleCreateDrillTemplate}
                          className="rounded-xl bg-blue-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-blue-500"
                        >
                          Save Drill Template
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {drillLibrary.map((template) => (
                    <div
                      key={template.id}
                      className="rounded-3xl border border-slate-800 bg-slate-950/40 p-4"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-[14px] font-bold text-white">
                            {template.name}
                          </h3>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {template.description ?? "No description entered."}
                          </p>
                        </div>

                        <Target size={15} className="text-blue-400" />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <StatusPill label={template.category} />
                        <StatusPill
                          label={template.defaultScoringMode}
                          tone="slate"
                        />
                        <StatusPill
                          label={`${template.defaultRunCount} run${
                            template.defaultRunCount !== 1 ? "s" : ""
                          }`}
                          tone="slate"
                        />
                      </div>

                      <button
                        type="button"
                        disabled={template.status !== "Active"}
                        onClick={() =>
                          handleAddTemplateToSelectedRangeDay(template.id)
                        }
                        className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold transition ${
                          template.status === "Active"
                            ? "bg-blue-600 text-white hover:bg-blue-500"
                            : "cursor-not-allowed bg-slate-800 text-slate-600"
                        }`}
                      >
                        <Plus size={14} />
                        Add to This Range Day
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-[16px] font-bold text-white">
                    Live Drill Scoring
                  </h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Score live on a device or enter handwritten packet results
                    later.
                  </p>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-400">
                  <UserCheck size={14} className="text-blue-400" />
                  {getUserName(CURRENT_USER.id)}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Officer
                  </label>
                  <select
                    value={selectedOfficerId}
                    onChange={(event) => {
                      setSelectedOfficerId(event.target.value);
                      resetEntryForm(1);
                    }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {selectedRoster.map((entry) => (
                      <option key={entry.officerId} value={entry.officerId}>
                        {getUserName(entry.officerId)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Drill
                  </label>
                  <select
                    value={selectedDrill?.id ?? ""}
                    onChange={(event) => {
                      setSelectedDrillId(event.target.value);
                      resetEntryForm(1);
                    }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {selectedDrills.map((drill) => (
                      <option key={drill.id} value={drill.id}>
                        {drill.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Run Number
                  </label>
                  <select
                    value={selectedRunNumber}
                    onChange={(event) =>
                      setSelectedRunNumber(Number(event.target.value))
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {Array.from(
                      { length: selectedDrill?.runCount ?? 1 },
                      (_, index) => index + 1,
                    ).map((run) => (
                      <option key={run} value={run}>
                        Run {run}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Firearm
                  </label>
                  <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-[13px] text-slate-300">
                    {getFirearmName(selectedFirearmId)}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusPill
                    label={selectedDrill?.scoringMode ?? "Scoring"}
                  />
                  <StatusPill
                    label={selectedDrill?.category ?? "Category"}
                    tone="slate"
                  />
                </div>

                {selectedDrill?.scoringMode === "Scored" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                        Score
                      </label>
                      <input
                        type="number"
                        value={score}
                        onChange={(event) => {
                          const value = event.target.value;
                          setScore(value);

                          if (selectedDrill.passingScore && value) {
                            setPassed(
                              Number(value) >= selectedDrill.passingScore,
                            );
                          }
                        }}
                        placeholder="Enter score"
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-[12px] text-slate-400">
                      Passing: {selectedDrill.passingScore ?? "—"} / Max:{" "}
                      {selectedDrill.maxScore ?? "—"}
                    </div>
                  </div>
                )}

                {(selectedDrill?.scoringMode === "Pass/Fail" ||
                  selectedDrill?.scoringMode === "Scored") && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPassed(true)}
                      className={`rounded-xl border px-3 py-2 text-[13px] font-semibold ${
                        passed === true
                          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                          : "border-slate-700 text-slate-400"
                      }`}
                    >
                      Pass
                    </button>

                    <button
                      type="button"
                      onClick={() => setPassed(false)}
                      className={`rounded-xl border px-3 py-2 text-[13px] font-semibold ${
                        passed === false
                          ? "border-red-500/50 bg-red-500/10 text-red-300"
                          : "border-slate-700 text-slate-400"
                      }`}
                    >
                      Fail
                    </button>
                  </div>
                )}

                {(selectedDrill?.scoringMode === "Completion Only" ||
                  selectedDrill?.scoringMode === "Notes Only") && (
                  <button
                    type="button"
                    onClick={() => setCompleted((current) => !current)}
                    className={`mt-3 w-full rounded-xl border px-3 py-2 text-[13px] font-semibold ${
                      completed
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                        : "border-slate-700 text-slate-400"
                    }`}
                  >
                    {completed ? "Completed" : "Not Completed"}
                  </button>
                )}

                <div className="mt-3">
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Instructor notes, observed deficiencies, corrections, or comments..."
                    rows={3}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  />
                </div>

                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-3">
                  <button
                    type="button"
                    onClick={() =>
                      setMalfunctionOccurred((current) => !current)
                    }
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-[13px] font-semibold ${
                      malfunctionOccurred
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                        : "border-slate-700 text-slate-400"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Wrench size={14} />
                      Unanticipated Malfunction
                    </span>
                    {malfunctionOccurred ? "Yes" : "No"}
                  </button>

                  {malfunctionOccurred && (
                    <div className="mt-3 grid gap-3">
                      <select
                        value={malfunctionType}
                        onChange={(event) =>
                          setMalfunctionType(
                            event.target.value as MalfunctionType,
                          )
                        }
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                      >
                        {MALFUNCTION_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>

                      <textarea
                        value={malfunctionNotes}
                        onChange={(event) =>
                          setMalfunctionNotes(event.target.value)
                        }
                        placeholder="Describe malfunction and any range-level correction..."
                        rows={2}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                      />

                      <p className="flex items-start gap-2 text-[11px] text-amber-300">
                        <AlertTriangle
                          size={13}
                          className="mt-0.5 flex-shrink-0"
                        />
                        This will link the malfunction to the firearm record for
                        armorer review, even if resolved on the range.
                      </p>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSaveResult}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-500"
                >
                  <Save size={14} />
                  Save Drill Run
                </button>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                  <ClipboardList size={15} className="text-blue-400" />
                  Officer Performance Summary
                </h3>

                <div className="space-y-2 text-[12px] text-slate-400">
                  <p>Officer: {getUserName(selectedOfficerId)}</p>
                  <p>
                    Average Score:{" "}
                    {getAverageScore(selectedOfficerResults) ??
                      "No scored runs"}
                  </p>
                  <p>
                    Pass Rate:{" "}
                    {typeof getPassRate(selectedOfficerResults) === "number"
                      ? `${getPassRate(selectedOfficerResults)}%`
                      : "No pass/fail runs"}
                  </p>
                  <p>Trend: {getPerformanceTrend(selectedOfficerResults)}</p>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                  <FileText size={15} className="text-blue-400" />
                  Saved Drill Runs
                </h3>

                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {selectedRangeResults.length === 0 ? (
                    <p className="text-[12px] text-slate-500">
                      No drill runs entered yet.
                    </p>
                  ) : (
                    selectedRangeResults.map((result) => {
                      const drill = selectedDrills.find(
                        (item) => item.id === result.drillId,
                      );

                      return (
                        <div
                          key={result.id}
                          className="rounded-2xl border border-slate-800 bg-slate-950/50 px-3 py-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[12px] font-semibold text-white">
                                {getUserName(result.officerId)}
                              </p>
                              <p className="text-[11px] text-slate-500">
                                {drill?.name} · Run {result.runNumber}
                              </p>
                            </div>

                            {result.malfunctionIds?.length ? (
                              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                                Malfunction
                              </span>
                            ) : null}
                          </div>

                          <p className="mt-2 text-[11px] text-slate-400">
                            Score: {result.score ?? "—"} · Passed:{" "}
                            {typeof result.passed === "boolean"
                              ? result.passed
                                ? "Yes"
                                : "No"
                              : "—"}{" "}
                            · Completed: {result.completed ? "Yes" : "No"}
                          </p>

                          {result.notes && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {result.notes}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {malfunctions.filter(
              (malfunction) => malfunction.rangeDayId === selectedRangeDay.id,
            ).length > 0 && (
              <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-amber-300">
                  <Wrench size={15} />
                  Firearm Malfunctions Logged
                </h3>

                <div className="space-y-2">
                  {malfunctions
                    .filter(
                      (malfunction) =>
                        malfunction.rangeDayId === selectedRangeDay.id,
                    )
                    .map((malfunction) => (
                      <div
                        key={malfunction.id}
                        className="rounded-2xl border border-amber-500/20 bg-slate-950/40 px-3 py-3"
                      >
                        <p className="text-[12px] font-semibold text-white">
                          {getFirearmName(malfunction.firearmId)}
                        </p>
                        <p className="text-[11px] text-amber-300">
                          {malfunction.type} · Armorer inspection required
                        </p>
                        {malfunction.notes && (
                          <p className="mt-1 text-[11px] text-slate-400">
                            {malfunction.notes}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </TracePointShell>
  );
}