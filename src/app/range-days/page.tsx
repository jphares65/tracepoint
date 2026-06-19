"use client";

import { useMemo, useState } from "react";
import TracePointShell from "@/app/components/TracePointShell";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
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

import type { FirearmMalfunction, MalfunctionType } from "@/app/lib/tracepoint/types";
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

import { CURRENT_USER, DEMO_DEPARTMENT, MOCK_FIREARMS, MOCK_USERS } from "@/app/lib/tracepoint/mock-data";

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
    notes: "Training malfunctions should not automatically create armorer alerts unless marked as unanticipated.",
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
    notes: "Designed for qualitative instructor observations rather than numeric scoring.",
  },
];

const RANGE_DAYS: RangeDay[] = [
  {
    id: "range-1",
    departmentId: DEMO_DEPARTMENT.id,
    title: "Fall 2026 Handgun Qualification",
    date: "2026-10-08",
    location: "Flemington Indoor Range",
    status: "Planned",
    leadInstructorId: "user-3",
    instructorIds: ["user-3", "user-4"],
    weather: "Indoor",
    notes: "Qualification plus supplemental drills.",
  },
];

const RANGE_ROSTER: RangeRosterEntry[] = [
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
];

const RANGE_DRILLS: RangeDayDrill[] = [
  ...DRILL_TEMPLATES.map((template) =>
    createDrillFromTemplate(template, "range-1"),
  ),

  createDrillFromTemplate(
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
    "range-2",
  ),

  createDrillFromTemplate(
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
    "range-2",
  ),

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

function parseOptionalNumber(value: string) {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isNaN(parsed) ? undefined : parsed;
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

function StatusPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-300">
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
  const [selectedRangeDayId] = useState("range-1");

const [drillLibrary, setDrillLibrary] =
  useState<DrillTemplate[]>(DRILL_TEMPLATES);

const [rangeDayDrills, setRangeDayDrills] =
  useState<RangeDayDrill[]>(RANGE_DRILLS);

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

const [selectedOfficerId, setSelectedOfficerId] = useState(
  RANGE_ROSTER[0]?.officerId ?? "",
);

const [selectedDrillId, setSelectedDrillId] = useState(
  RANGE_DRILLS[0]?.id ?? "",
);

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
  const rangeDay = RANGE_DAYS.find((item) => item.id === selectedRangeDayId) ?? RANGE_DAYS[0];
  const roster = RANGE_ROSTER.filter((entry) => entry.rangeDayId === rangeDay.id);
  const drills = rangeDayDrills.filter(
  (drill) => drill.rangeDayId === rangeDay.id,
);
  const selectedDrill = drills.find((drill) => drill.id === selectedDrillId) ?? drills[0];
  const selectedRosterEntry = roster.find((entry) => entry.officerId === selectedOfficerId);
  const selectedFirearmId = selectedRosterEntry?.assignedFirearmIds[0];

  const completionSummary = useMemo(
    () => getRangeDayCompletionSummary(roster, drills, results),
    [roster, drills, results],
  );

  const selectedOfficerResults = useMemo(
    () => results.filter((result) => result.officerId === selectedOfficerId),
    [results, selectedOfficerId],
  );

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

  function handleSaveResult() {
    if (!selectedDrill || !selectedOfficerId) return;

    const malfunctionId =
      malfunctionOccurred && selectedFirearmId
        ? `malfunction-${Date.now()}`
        : undefined;

    const newResult: DrillRunResult = {
      id: `result-${Date.now()}`,
      rangeDayId: rangeDay.id,
      drillId: selectedDrill.id,
      officerId: selectedOfficerId,
      firearmId: selectedFirearmId,
      runNumber: selectedRunNumber,
      completed,
      score: selectedDrill.scoringMode === "Scored" && score ? Number(score) : undefined,
      passed:
        selectedDrill.scoringMode === "Pass/Fail" || selectedDrill.scoringMode === "Scored"
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
        rangeDayId: rangeDay.id,
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
      selectedRunNumber < selectedDrill.runCount ? selectedRunNumber + 1 : selectedRunNumber;

    resetEntryForm(nextRun);
  }

  function handleGeneratePacket() {
    const packet = createRangePacket(rangeDay, CURRENT_USER.id);
    console.log("Generated range packet:", packet);
    window.print();
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

function handleCreateDrillTemplate() {
  if (!newDrillName.trim()) {
    return;
  }

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

function handleAddTemplateToCurrentRangeDay(templateId: string) {
  const copiedDrill = addLibraryDrillToRangeDay(
    {
      rangeDayId: rangeDay.id,
      templateId,
    },
    drillLibrary,
  );

  if (!copiedDrill) {
    return;
  }

  setRangeDayDrills((current) => [...current, copiedDrill]);
  setSelectedDrillId(copiedDrill.id);
  resetEntryForm(1);
}
  return (
    <TracePointShell activePage="Range & Training">
      <div className="mx-auto w-full max-w-[1600px] space-y-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-[22px] font-bold text-white">Range &amp; Training</h1>
              <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
                Plan range days, generate paper packets, score drills live, track repeated runs,
                record malfunctions, and identify performance concerns.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleGeneratePacket}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
              >
                <Printer size={14} />
                Print Range Packet
              </button>

              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500"
              >
                <Plus size={14} />
                New Range Day
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          <StatCard label="Roster" value={roster.length} sub="Officers assigned" />
          <StatCard label="Attendance" value={`${getAttendanceRate(roster)}%`} sub={`${getAttendanceCount(roster)} present`} />
          <StatCard label="Drills" value={drills.length} sub="Planned events" />
          <StatCard label="Completion" value={`${completionSummary.completionRate}%`} sub={`${completionSummary.completedRuns}/${completionSummary.expectedRuns} runs`} />
          <StatCard label="Malfunctions" value={getMalfunctionCountForRangeDay(results)} sub="Linked to firearms" />
        </section>
<section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 className="text-[18px] font-bold text-white">Drill Library</h2>
      <p className="mt-1 text-[12px] text-slate-500">
        Create reusable drill templates and add them to the current range day.
        Each added drill is copied into the range day as a historical snapshot.
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
            onChange={(event) => setNewDrillName(event.target.value)}
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
                event.target.value as NonNullable<DrillTemplate["firearmType"]>,
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
                event.target.value as NonNullable<DrillTemplate["difficulty"]>,
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
                event.target.value as DrillTemplate["defaultScoringMode"],
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
            onChange={(event) => setNewDrillRunCount(event.target.value)}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Round Count
          </label>
          <input
            type="number"
            value={newDrillRoundCount}
            onChange={(event) => setNewDrillRoundCount(event.target.value)}
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
                onChange={(event) => setNewDrillMaxScore(event.target.value)}
                placeholder="Example: 100"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
              />
            </div>
          </>
        )}

        <div className="lg:col-span-2">
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Description
          </label>
          <textarea
            value={newDrillDescription}
            onChange={(event) => setNewDrillDescription(event.target.value)}
            placeholder="Short description of the drill..."
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
            onChange={(event) => setNewDrillInstructions(event.target.value)}
            placeholder="Detailed range master instructions..."
            rows={3}
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Tags
          </label>
          <input
            type="text"
            value={newDrillTags}
            onChange={(event) => setNewDrillTags(event.target.value)}
            placeholder="handgun, low light, remedial"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Notes
          </label>
          <input
            type="text"
            value={newDrillNotes}
            onChange={(event) => setNewDrillNotes(event.target.value)}
            placeholder="Optional internal note"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setNewDrillDefaultRequired((current) => !current)}
          className={`rounded-xl border px-3 py-2 text-[12px] font-semibold ${
            newDrillDefaultRequired
              ? "border-blue-500/50 bg-blue-500/10 text-blue-300"
              : "border-slate-700 text-slate-400"
          }`}
        >
          {newDrillDefaultRequired ? "Default: Required" : "Default: Optional"}
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

  <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
    {drillLibrary.map((template) => (
      <div
        key={template.id}
        className="rounded-3xl border border-slate-800 bg-slate-950/40 p-4"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-bold text-white">
              {template.name}
            </h3>
            <p className="mt-1 text-[12px] text-slate-500">
              {template.description ?? "No description entered."}
            </p>
          </div>

          <Target size={16} className="text-blue-400" />
        </div>

        <div className="flex flex-wrap gap-2">
          <StatusPill label={template.category} />
          <StatusPill label={template.defaultScoringMode} />
          <StatusPill
            label={`${template.defaultRunCount} run${
              template.defaultRunCount !== 1 ? "s" : ""
            }`}
          />
          <StatusPill
            label={template.defaultRequired ? "Required" : "Optional"}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
          <p>Firearm: {template.firearmType ?? "Any"}</p>
          <p>Difficulty: {template.difficulty ?? "—"}</p>
          <p>Rounds: {template.roundCount ?? "—"}</p>
          <p>Time: {template.estimatedMinutes ?? "—"} min</p>
        </div>

        {template.instructions && (
          <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-[11px] leading-relaxed text-slate-500">
            {template.instructions}
          </p>
        )}

        <button
          type="button"
          disabled={template.status !== "Active"}
          onClick={() => handleAddTemplateToCurrentRangeDay(template.id)}
          className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-[12px] font-semibold transition ${
            template.status === "Active"
              ? "bg-blue-600 text-white hover:bg-blue-500"
              : "cursor-not-allowed bg-slate-800 text-slate-600"
          }`}
        >
          <Plus size={14} />
          Add to Current Range Day
        </button>
      </div>
    ))}
  </div>
</section>
        <section className="grid gap-5 xl:grid-cols-[420px_1fr]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <StatusPill label={rangeDay.status} />
                    <StatusPill label={rangeDay.weather ?? "Weather"} />
                  </div>

                  <h2 className="text-[16px] font-bold text-white">{rangeDay.title}</h2>
                  <p className="mt-1 text-[12px] text-slate-500">{rangeDay.notes}</p>
                </div>

                <Crosshair className="text-blue-400" size={20} />
              </div>

              <div className="space-y-2 text-[12px] text-slate-400">
                <p className="flex items-center gap-2">
                  <CalendarDays size={13} className="text-slate-600" />
                  {rangeDay.date}
                </p>
                <p className="flex items-center gap-2">
                  <MapPin size={13} className="text-slate-600" />
                  {rangeDay.location}
                </p>
                <p className="flex items-center gap-2">
                  <Shield size={13} className="text-slate-600" />
                  Lead Instructor: {getUserName(rangeDay.leadInstructorId)}
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                <Users size={15} className="text-blue-400" />
                Roster
              </h3>

              <div className="space-y-2">
                {roster.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setSelectedOfficerId(entry.officerId);
                      resetEntryForm(1);
                    }}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      selectedOfficerId === entry.officerId
                        ? "border-blue-500/50 bg-blue-500/10"
                        : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-white">
                        {getUserName(entry.officerId)}
                      </p>
                      {entry.attended && <CheckCircle2 size={14} className="text-emerald-400" />}
                    </div>

                    <p className="mt-1 text-[11px] text-slate-500">
                      {entry.assignedFirearmIds.map(getFirearmName).join(", ")}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                <Target size={15} className="text-blue-400" />
                Planned Drills
              </h3>

              <div className="space-y-2">
                {drills.map((drill) => (
                  <button
                    key={drill.id}
                    type="button"
                    onClick={() => {
                      setSelectedDrillId(drill.id);
                      resetEntryForm(1);
                    }}
                    className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                      selectedDrillId === drill.id
                        ? "border-blue-500/50 bg-blue-500/10"
                        : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[13px] font-semibold text-white">{drill.name}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{drill.description}</p>
                      </div>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                        {drill.runCount} run{drill.runCount !== 1 ? "s" : ""}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusPill label={drill.category} />
                      <StatusPill label={drill.scoringMode} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-[16px] font-bold text-white">Live Drill Scoring</h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Score live on a device or enter handwritten packet results later.
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
                    {roster.map((entry) => (
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
                    value={selectedDrillId}
                    onChange={(event) => {
                      setSelectedDrillId(event.target.value);
                      resetEntryForm(1);
                    }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {drills.map((drill) => (
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
                    onChange={(event) => setSelectedRunNumber(Number(event.target.value))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {Array.from({ length: selectedDrill?.runCount ?? 1 }, (_, index) => index + 1).map(
                      (run) => (
                        <option key={run} value={run}>
                          Run {run}
                        </option>
                      ),
                    )}
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
                  <StatusPill label={selectedDrill?.scoringMode ?? "Scoring"} />
                  <StatusPill label={selectedDrill?.category ?? "Category"} />
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
                            setPassed(Number(value) >= selectedDrill.passingScore);
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
                    onClick={() => setMalfunctionOccurred((current) => !current)}
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
                        onChange={(event) => setMalfunctionType(event.target.value as MalfunctionType)}
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
                        onChange={(event) => setMalfunctionNotes(event.target.value)}
                        placeholder="Describe malfunction and any range-level correction..."
                        rows={2}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                      />

                      <p className="flex items-start gap-2 text-[11px] text-amber-300">
                        <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                        This will link the malfunction to the firearm record for armorer review,
                        even if resolved on the range.
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
                  <p>Average Score: {getAverageScore(selectedOfficerResults) ?? "No scored runs"}</p>
                  <p>Pass Rate: {getPassRate(selectedOfficerResults) ?? "No pass/fail runs"}%</p>
                  <p>Trend: {getPerformanceTrend(selectedOfficerResults)}</p>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                  <FileText size={15} className="text-blue-400" />
                  Saved Drill Runs
                </h3>

                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {results.length === 0 ? (
                    <p className="text-[12px] text-slate-500">No drill runs entered yet.</p>
                  ) : (
                    results.map((result) => {
                      const drill = drills.find((item) => item.id === result.drillId);

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
                            <p className="mt-1 text-[11px] text-slate-500">{result.notes}</p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {malfunctions.length > 0 && (
              <div className="rounded-3xl border border-amber-500/20 bg-amber-500/[0.06] p-4">
                <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-amber-300">
                  <Wrench size={15} />
                  Firearm Malfunctions Logged
                </h3>

                <div className="space-y-2">
                  {malfunctions.map((malfunction) => (
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
                        <p className="mt-1 text-[11px] text-slate-400">{malfunction.notes}</p>
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