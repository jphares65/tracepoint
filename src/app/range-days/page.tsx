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


type ScoringFormat =
  | "Qualification"
  | "Points"
  | "Time"
  | "Pass/Fail"
  | "Completion"
  | "Hit Count"
  | "Notes Only";

type ExtendedDrillTemplate = DrillTemplate & {
  scoringFormat?: ScoringFormat;
  defaultPassingTimeSeconds?: number;
  defaultMinimumHits?: number;
};

type ExtendedRangeDayDrill = RangeDayDrill & {
  scoringFormat?: ScoringFormat;
  passingTimeSeconds?: number;
  minimumHits?: number;
};

type ExtendedDrillRunResult = DrillRunResult & {
  scoringFormatSnapshot?: ScoringFormat;
  timeSeconds?: number;
  hitCount?: number;
  finalPassed?: boolean;
};

type BatchScoreRow = {
  officerId: string;
  metricValue: string;
  passed?: boolean;
  completed?: boolean;
  notes: string;
  malfunctionOccurred: boolean;
  malfunctionType: MalfunctionType;
  malfunctionNotes: string;
};

type DrillLifecycleSummary = {
  timesPerformed: number;
  lastPerformedDate?: string;
  lastPerformedDateLabel: string;
  daysSinceLastPerformed?: number;
  recommended: boolean;
  recommendationReason?: string;
};

type DrillTemplateWithLifecycle = ExtendedDrillTemplate & {
  lifecycle: DrillLifecycleSummary;
};

const DRILL_RECOMMENDATION_STALE_DAYS = 90;

const DRILL_TEMPLATES: ExtendedDrillTemplate[] = [
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
    defaultRunCount: 2,
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

const INITIAL_RANGE_DRILLS: ExtendedRangeDayDrill[] = [
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

type RangeDayStatusFilter = "All Active" | PlannedRangeDay["status"];
type RangeDayTypeFilter = "All Types" | RangeDayType;

type RangeDayDetailTab = "overview" | "roster" | "drills" | "scoring" | "results";

const RANGE_DAY_DETAIL_TABS: Array<{
  id: RangeDayDetailTab;
  label: string;
  description: string;
}> = [
  { id: "overview", label: "Overview", description: "Day details and staffing" },
  { id: "roster", label: "Roster", description: "Officers and firearms" },
  { id: "drills", label: "Drills", description: "Planned drill library" },
  { id: "scoring", label: "Scoring", description: "Live entry board" },
  { id: "results", label: "Results", description: "Saved runs and issues" },
];

const RANGE_DAY_STATUS_FILTERS: RangeDayStatusFilter[] = [
  "All Active",
  ...RANGE_STATUSES,
];

const RANGE_DAY_TYPE_FILTERS: RangeDayTypeFilter[] = [
  "All Types",
  ...RANGE_DAY_TYPES,
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

const SCORING_FORMATS: ScoringFormat[] = [
  "Qualification",
  "Points",
  "Time",
  "Pass/Fail",
  "Completion",
  "Hit Count",
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

function isQualificationNameOrCategory(name?: string, category?: string) {
  return (
    category === "Qualification" ||
    Boolean(name?.toLowerCase().includes("qualification"))
  );
}

function isQualificationDrill(drill?: RangeDayDrill | null) {
  if (!drill) return false;

  return isQualificationNameOrCategory(drill.name, drill.category);
}

function getScoringFormat(
  drill?: ExtendedRangeDayDrill | ExtendedDrillTemplate | null,
): ScoringFormat {
  if (!drill) return "Pass/Fail";

  if (drill.scoringFormat) return drill.scoringFormat;

  if (isQualificationNameOrCategory(drill.name, drill.category)) {
    return "Qualification";
  }

  const legacyMode =
    "scoringMode" in drill ? drill.scoringMode : drill.defaultScoringMode;

  if (legacyMode === "Scored") return "Points";
  if (legacyMode === "Completion Only") return "Completion";
  if (legacyMode === "Notes Only") return "Notes Only";

  return "Pass/Fail";
}

function getLegacyScoringMode(
  scoringFormat: ScoringFormat,
): DrillTemplate["defaultScoringMode"] {
  if (
    scoringFormat === "Qualification" ||
    scoringFormat === "Points" ||
    scoringFormat === "Time" ||
    scoringFormat === "Hit Count"
  ) {
    return "Scored";
  }

  if (scoringFormat === "Completion") return "Completion Only";
  if (scoringFormat === "Notes Only") return "Notes Only";

  return "Pass/Fail";
}

function getAutomaticPassValue(
  drill: ExtendedRangeDayDrill,
  scoringFormat: ScoringFormat,
  metricValue: string,
  completed?: boolean,
) {
  const numericValue = Number(metricValue);

  if (
    (scoringFormat === "Qualification" || scoringFormat === "Points") &&
    metricValue.trim() &&
    typeof drill.passingScore === "number"
  ) {
    return numericValue >= drill.passingScore;
  }

  if (
    scoringFormat === "Time" &&
    metricValue.trim() &&
    typeof drill.passingTimeSeconds === "number"
  ) {
    return numericValue <= drill.passingTimeSeconds;
  }

  if (
    scoringFormat === "Hit Count" &&
    metricValue.trim() &&
    typeof drill.minimumHits === "number"
  ) {
    return numericValue >= drill.minimumHits;
  }

  if (scoringFormat === "Completion" && typeof completed === "boolean") {
    return completed;
  }

  return undefined;
}

function formatResultMetric(
  result?: ExtendedDrillRunResult,
  drill?: ExtendedRangeDayDrill,
) {
  if (!result) return "";

  const scoringFormat =
    result.scoringFormatSnapshot ?? getScoringFormat(drill);

  if (scoringFormat === "Time") {
    return typeof result.timeSeconds === "number"
      ? `${result.timeSeconds} sec`
      : "";
  }

  if (scoringFormat === "Hit Count") {
    return typeof result.hitCount === "number"
      ? `${result.hitCount} hits`
      : "";
  }

  if (scoringFormat === "Completion") {
    return typeof result.completed === "boolean"
      ? result.completed
        ? "Completed"
        : "Incomplete"
      : "";
  }

  if (scoringFormat === "Pass/Fail") {
    return typeof result.passed === "boolean"
      ? result.passed
        ? "Pass"
        : "Fail"
      : "";
  }

  return typeof result.score === "number" ? String(result.score) : "";
}

function getEffectiveRunCount(drill?: RangeDayDrill | null) {
  if (!drill) return 1;

  return isQualificationDrill(drill)
    ? Math.max(drill.runCount ?? 1, 2)
    : drill.runCount ?? 1;
}

function getRunLabel(drill: RangeDayDrill | undefined, runNumber: number) {
  if (isQualificationDrill(drill)) {
    if (runNumber === 1) return "Day Qualification";
    if (runNumber === 2) return "Night Qualification";
  }

  return `Run ${runNumber}`;
}

function getDefaultOutlineForRangeType(rangeType: RangeDayType) {
  const outlines: Record<RangeDayType, string[]> = {
    Qualification: [
      "Safety briefing and attendance confirmation",
      "Day handgun qualification course",
      "Night handgun qualification course",
      "Remedial instruction / make-up plan if needed",
    ],
    Rifle: [
      "Rifle safety briefing",
      "Zero confirmation",
      "Rifle familiarization / transition drills",
      "Instructor notes and deficiencies",
    ],
    "Low Light": [
      "Low-light safety briefing",
      "Threat identification",
      "Light discipline",
      "Decision-making observations",
    ],
    Remedial: [
      "Safety briefing",
      "Review prior deficiency",
      "Remedial drill repetitions",
      "Instructor evaluation and follow-up notes",
    ],
    "Make-Up": [
      "Safety briefing and attendance confirmation",
      "Required qualification / training events",
      "Instructor notes",
      "Documentation review",
    ],
    Training: [
      "Safety briefing and attendance confirmation",
      "Planned training drills",
      "Instructor observations",
      "Deficiency / remedial notes if needed",
    ],
  };

  return outlines[rangeType];
}

function getRangeDayOutlineForDisplay(rangeDay: PlannedRangeDay) {
  return Array.isArray(rangeDay.outline) && rangeDay.outline.length > 0
    ? rangeDay.outline
    : getDefaultOutlineForRangeType(rangeDay.rangeType);
}

function formatOutlineText(outline: string[]) {
  return outline.join("\n");
}

function parseOutlineText(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDrillLibraryForWorkspace(
  storedDrillLibrary: DrillTemplate[],
): DrillTemplate[] {
  return storedDrillLibrary.map((template) =>
    isQualificationNameOrCategory(template.name, template.category)
      ? {
          ...template,
          defaultRunCount: Math.max(template.defaultRunCount ?? 1, 2),
        }
      : template,
  );
}

function normalizeRangeDayDrillsForWorkspace(
  storedRangeDayDrills: RangeDayDrill[],
): RangeDayDrill[] {
  return storedRangeDayDrills.map((drill) =>
    isQualificationNameOrCategory(drill.name, drill.category)
      ? {
          ...drill,
          runCount: Math.max(drill.runCount ?? 1, 2),
        }
      : drill,
  );
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
      outline:
        Array.isArray(rangeDay.outline) && rangeDay.outline.length > 0
          ? rangeDay.outline
          : getDefaultOutlineForRangeType(rangeDay.rangeType),
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

function getRangeDateValue(date?: string) {
  if (!date) return 0;

  const parsed = new Date(`${date}T00:00:00`).getTime();

  return Number.isNaN(parsed) ? 0 : parsed;
}

function getShortDateLabel(date?: string) {
  if (!date) return "Never";

  const parsed = new Date(`${date}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) return "Never";

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getDrillTemplateReferenceId(drill: RangeDayDrill) {
  const record = drill as Record<string, unknown>;

  const possibleReference =
    record.templateId ??
    record.drillTemplateId ??
    record.sourceTemplateId ??
    record.libraryTemplateId;

  return typeof possibleReference === "string" ? possibleReference : undefined;
}

function getNormalizedText(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function doesRangeDayDrillMatchTemplate(
  drill: RangeDayDrill,
  template: DrillTemplate,
) {
  const templateReferenceId = getDrillTemplateReferenceId(drill);

  if (templateReferenceId && templateReferenceId === template.id) {
    return true;
  }

  return (
    getNormalizedText(drill.name) === getNormalizedText(template.name) &&
    getNormalizedText(drill.category) === getNormalizedText(template.category)
  );
}

function buildDrillLifecycleLibrary({
  drillLibrary,
  rangeDayDrills,
  rangeDays,
  results,
  referenceDate,
}: {
  drillLibrary: ExtendedDrillTemplate[];
  rangeDayDrills: ExtendedRangeDayDrill[];
  rangeDays: PlannedRangeDay[];
  results: ExtendedDrillRunResult[];
  referenceDate?: string;
}): DrillTemplateWithLifecycle[] {
  const rangeDayById = new Map(
    rangeDays.map((rangeDay) => [rangeDay.id, rangeDay]),
  );

  const referenceDateValue =
    getRangeDateValue(referenceDate) || new Date().getTime();

  return drillLibrary
    .map<DrillTemplateWithLifecycle>((template) => {
      const matchingDrills = rangeDayDrills.filter((drill) =>
        doesRangeDayDrillMatchTemplate(drill, template),
      );

      const matchingDrillIds = new Set(
        matchingDrills.map((drill) => drill.id),
      );

      const performedRunKeys = new Set<string>();
      let lastPerformedDate = "";
      let lastPerformedDateValue = 0;

      results.forEach((result) => {
        if (!matchingDrillIds.has(result.drillId)) return;

        const rangeDay = rangeDayById.get(result.rangeDayId);
        const dateValue = getRangeDateValue(rangeDay?.date);

        if (!dateValue) return;

        performedRunKeys.add(
          `${result.rangeDayId}:${result.drillId}:${result.runNumber ?? 1}`,
        );

        if (dateValue > lastPerformedDateValue) {
          lastPerformedDateValue = dateValue;
          lastPerformedDate = rangeDay?.date ?? "";
        }
      });

      const timesPerformed = performedRunKeys.size;
      const daysSinceLastPerformed =
        lastPerformedDateValue > 0
          ? Math.max(
              0,
              Math.floor(
                (referenceDateValue - lastPerformedDateValue) /
                  (1000 * 60 * 60 * 24),
              ),
            )
          : undefined;

      const recommendationReason =
        timesPerformed === 0
          ? "Never performed"
          : typeof daysSinceLastPerformed === "number" &&
              daysSinceLastPerformed >= DRILL_RECOMMENDATION_STALE_DAYS
            ? `Not used in ${daysSinceLastPerformed} days`
            : undefined;

      return {
        ...template,
        lifecycle: {
          timesPerformed,
          lastPerformedDate: lastPerformedDate || undefined,
          lastPerformedDateLabel: getShortDateLabel(lastPerformedDate),
          daysSinceLastPerformed,
          recommended: Boolean(recommendationReason),
          recommendationReason,
        },
      };
    })
    .sort((left, right) => {
      if (left.lifecycle.recommended !== right.lifecycle.recommended) {
        return left.lifecycle.recommended ? -1 : 1;
      }

      if (left.lifecycle.recommended && right.lifecycle.recommended) {
        const leftDate = getRangeDateValue(left.lifecycle.lastPerformedDate);
        const rightDate = getRangeDateValue(right.lifecycle.lastPerformedDate);

        if (leftDate !== rightDate) return leftDate - rightDate;
      }

      return left.name.localeCompare(right.name);
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


type PrintableRangePacketProps = {
  rangeDay: PlannedRangeDay;
  roster: RangeRosterEntry[];
  drills: ExtendedRangeDayDrill[];
  results: ExtendedDrillRunResult[];
  malfunctions: FirearmMalfunction[];
};

function formatPacketStatus(value: boolean | undefined) {
  if (typeof value !== "boolean") return "";

  return value ? "Pass" : "Fail";
}

function PrintableRangePacket({
  rangeDay,
  roster,
  drills,
  results,
  malfunctions,
}: PrintableRangePacketProps) {
  const outline = getRangeDayOutlineForDisplay(rangeDay);
  const rangeMalfunctions = malfunctions.filter(
    (malfunction) => malfunction.rangeDayId === rangeDay.id,
  );

  function getResultForRun(
    officerId: string,
    drillId: string,
    runNumber: number,
  ) {
    return results.find(
      (result) =>
        result.officerId === officerId &&
        result.drillId === drillId &&
        result.runNumber === runNumber,
    );
  }

  const scoreRows = roster.flatMap((entry) =>
    drills.flatMap((drill) =>
      Array.from({ length: getEffectiveRunCount(drill) }, (_, index) => {
        const runNumber = index + 1;
        const result = getResultForRun(entry.officerId, drill.id, runNumber);

        return {
          id: `${entry.id}-${drill.id}-${runNumber}`,
          entry,
          drill,
          runNumber,
          result,
        };
      }),
    ),
  );

  return (
    <section className="printable-range-packet">
      <div className="packet-page">
        <div className="packet-header">
          <div>
            <p className="packet-eyebrow">TracePoint Range Packet</p>
            <h1>{rangeDay.title}</h1>
            <p className="packet-subtitle">{(DEMO_DEPARTMENT as { name?: string }).name ?? "Demo Department"}</p>
          </div>
          <div className="packet-meta-box">
            <p>Packet Status</p>
            <strong>{rangeDay.packetStatus}</strong>
          </div>
        </div>

        <div className="packet-grid packet-summary-grid">
          <div>
            <p className="packet-label">Date</p>
            <p>{formatDate(rangeDay.date)}</p>
          </div>
          <div>
            <p className="packet-label">Time</p>
            <p>
              {rangeDay.startTime}-{rangeDay.endTime}
            </p>
          </div>
          <div>
            <p className="packet-label">Location</p>
            <p>{rangeDay.location || "Not entered"}</p>
          </div>
          <div>
            <p className="packet-label">Type</p>
            <p>{rangeDay.rangeType}</p>
          </div>
        </div>

        <div className="packet-section packet-two-column">
          <div>
            <h2>Staffing</h2>
            <p>
              <strong>Lead Instructor:</strong>{" "}
              {getUserName(rangeDay.leadInstructorId)}
            </p>
            <p>
              <strong>Assigned Instructors:</strong>{" "}
              {rangeDay.instructorIds.length > 0
                ? rangeDay.instructorIds.map(getUserName).join(", ")
                : "None assigned"}
            </p>
            <p>
              <strong>Staffing Notes:</strong>{" "}
              {rangeDay.staffingNotes || "None entered"}
            </p>
          </div>

          <div>
            <h2>Day Syllabus</h2>
            <ol className="packet-outline">
              {outline.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        </div>

        <div className="packet-section">
          <h2>Officer Roster / Firearm Assignment</h2>
          <table className="packet-table">
            <thead>
              <tr>
                <th>Officer</th>
                <th>Attendance</th>
                <th>Assigned Firearm</th>
                <th>Officer Initials</th>
              </tr>
            </thead>
            <tbody>
              {roster.length === 0 ? (
                <tr>
                  <td colSpan={4}>No officers assigned.</td>
                </tr>
              ) : (
                roster.map((entry) => (
                  <tr key={entry.id}>
                    <td>{getUserName(entry.officerId)}</td>
                    <td>{entry.attended ? "Present" : "Not marked"}</td>
                    <td>{getFirearmName(entry.assignedFirearmIds[0])}</td>
                    <td />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="packet-section">
          <h2>Planned Drills</h2>
          <table className="packet-table">
            <thead>
              <tr>
                <th>Drill</th>
                <th>Category</th>
                <th>Scoring</th>
                <th>Runs</th>
                <th>Rounds</th>
              </tr>
            </thead>
            <tbody>
              {drills.length === 0 ? (
                <tr>
                  <td colSpan={5}>No drills assigned.</td>
                </tr>
              ) : (
                drills.map((drill) => (
                  <tr key={drill.id}>
                    <td>
                      <strong>{drill.name}</strong>
                      {drill.description ? <span> — {drill.description}</span> : null}
                    </td>
                    <td>{drill.category}</td>
                    <td>{getScoringFormat(drill)}</td>
                    <td>{getEffectiveRunCount(drill)}</td>
                    <td>{drill.roundCount ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="packet-section packet-page-break-safe">
          <h2>Score Sheet / Results</h2>
          <table className="packet-table packet-score-table">
            <thead>
              <tr>
                <th>Officer</th>
                <th>Firearm</th>
                <th>Drill</th>
                <th>Run</th>
                <th>Score</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Instructor Initials</th>
              </tr>
            </thead>
            <tbody>
              {scoreRows.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    Add officers and drills to generate score-sheet rows.
                  </td>
                </tr>
              ) : (
                scoreRows.map(({ id, entry, drill, runNumber, result }) => (
                  <tr key={id}>
                    <td>{getUserName(entry.officerId)}</td>
                    <td>{getFirearmName(entry.assignedFirearmIds[0])}</td>
                    <td>{drill.name}</td>
                    <td>{getRunLabel(drill, runNumber)}</td>
                    <td>{formatResultMetric(result, drill)}</td>
                    <td>
                      {formatPacketStatus(result?.passed) ||
                        (result?.completed ? "Completed" : "")}
                    </td>
                    <td>{result?.notes ?? ""}</td>
                    <td />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="packet-section">
          <h2>Firearm Malfunctions / Deficiencies</h2>
          <table className="packet-table">
            <thead>
              <tr>
                <th>Officer</th>
                <th>Firearm</th>
                <th>Type</th>
                <th>Inspection Required</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rangeMalfunctions.length === 0 ? (
                <tr>
                  <td colSpan={5}>No firearm malfunctions logged.</td>
                </tr>
              ) : (
                rangeMalfunctions.map((malfunction) => (
                  <tr key={malfunction.id}>
                    <td>{getUserName(malfunction.officerId ?? "")}</td>
                    <td>{getFirearmName(malfunction.firearmId)}</td>
                    <td>{malfunction.type}</td>
                    <td>{malfunction.inspectionRequired ? "Yes" : "No"}</td>
                    <td>{malfunction.notes ?? ""}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="packet-section packet-signatures">
          <div>
            <p className="packet-label">Lead Instructor Signature</p>
            <div className="packet-signature-line" />
          </div>
          <div>
            <p className="packet-label">Date</p>
            <div className="packet-signature-line" />
          </div>
          <div>
            <p className="packet-label">Command / Training Review</p>
            <div className="packet-signature-line" />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function RangeDaysPage() {
  const [rangeDays, setRangeDays] =
    useState<PlannedRangeDay[]>(INITIAL_RANGE_DAYS);

  const [selectedRangeDayId, setSelectedRangeDayId] = useState<string | null>(
    null,
  );

  const [activeRangeDayTab, setActiveRangeDayTab] =
    useState<RangeDayDetailTab>("overview");

  const [drillLibrary, setDrillLibrary] =
    useState<ExtendedDrillTemplate[]>(DRILL_TEMPLATES);

  const [rangeDayDrills, setRangeDayDrills] =
    useState<ExtendedRangeDayDrill[]>(INITIAL_RANGE_DRILLS);

  const [rangeRoster, setRangeRoster] =
    useState<RangeRosterEntry[]>(INITIAL_RANGE_ROSTER);

  const [hasLoadedStoredWorkspace, setHasLoadedStoredWorkspace] =
    useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [rangeDaySearchQuery, setRangeDaySearchQuery] = useState("");
  const [rangeDayStatusFilter, setRangeDayStatusFilter] =
    useState<RangeDayStatusFilter>("All Active");
  const [rangeDayTypeFilter, setRangeDayTypeFilter] =
    useState<RangeDayTypeFilter>("All Types");

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
    useState<ScoringFormat>("Pass/Fail");
  const [newDrillPassingScore, setNewDrillPassingScore] = useState("");
  const [newDrillMaxScore, setNewDrillMaxScore] = useState("");
  const [newDrillPassingTimeSeconds, setNewDrillPassingTimeSeconds] = useState("");
  const [newDrillMinimumHits, setNewDrillMinimumHits] = useState("");
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
  const [results, setResults] = useState<ExtendedDrillRunResult[]>([]);
  const [batchScoreRows, setBatchScoreRows] = useState<Record<string, BatchScoreRow>>({});
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

  const attendingRoster = useMemo(
    () => selectedRoster.filter((entry) => entry.attended),
    [selectedRoster],
  );

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

  const selectedEffectiveRunCount = getEffectiveRunCount(selectedDrill);

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

  const drillLibraryWithLifecycle = useMemo(
    () =>
      buildDrillLifecycleLibrary({
        drillLibrary,
        rangeDayDrills,
        rangeDays,
        results,
        referenceDate: selectedRangeDay?.date,
      }),
    [drillLibrary, rangeDayDrills, rangeDays, results, selectedRangeDay?.date],
  );

  const activeRangeDayCount = useMemo(
    () => rangeDays.filter((rangeDay) => rangeDay.status !== "Archived").length,
    [rangeDays],
  );

  const archivedRangeDayCount = useMemo(
    () => rangeDays.filter((rangeDay) => rangeDay.status === "Archived").length,
    [rangeDays],
  );

  const filteredRangeDays = useMemo(() => {
    const normalizedSearch = rangeDaySearchQuery.trim().toLowerCase();

    return rangeDays.filter((rangeDay) => {
      if (
        rangeDayStatusFilter === "All Active" &&
        rangeDay.status === "Archived"
      ) {
        return false;
      }

      if (
        rangeDayStatusFilter !== "All Active" &&
        rangeDay.status !== rangeDayStatusFilter
      ) {
        return false;
      }

      if (
        rangeDayTypeFilter !== "All Types" &&
        rangeDay.rangeType !== rangeDayTypeFilter
      ) {
        return false;
      }

      if (!normalizedSearch) return true;

      const dayRoster = rangeRoster.filter(
        (entry) => entry.rangeDayId === rangeDay.id,
      );

      const searchableText = [
        rangeDay.title,
        rangeDay.date,
        rangeDay.startTime,
        rangeDay.endTime,
        rangeDay.location,
        rangeDay.status,
        rangeDay.rangeType,
        rangeDay.packetStatus,
        rangeDay.staffingNotes,
        rangeDay.notes ?? "",
        rangeDay.weather ?? "",
        getUserName(rangeDay.leadInstructorId),
        ...(rangeDay.instructorIds ?? []).map(getUserName),
        ...getRangeDayOutlineForDisplay(rangeDay),
        ...dayRoster.map((entry) => getUserName(entry.officerId)),
        ...dayRoster.flatMap((entry) =>
          entry.assignedFirearmIds.map(getFirearmName),
        ),
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedSearch);
    });
  }, [
    rangeDaySearchQuery,
    rangeDayStatusFilter,
    rangeDayTypeFilter,
    rangeDays,
    rangeRoster,
  ]);

  useEffect(() => {
    const storedWorkspace = loadStoredRangeDayWorkspace();

    if (Array.isArray(storedWorkspace?.rangeDays)) {
      setRangeDays(normalizeRangeDaysForWorkspace(storedWorkspace.rangeDays));
    }

    if (Array.isArray(storedWorkspace?.drillLibrary)) {
      setDrillLibrary(
        normalizeDrillLibraryForWorkspace(storedWorkspace.drillLibrary),
      );
    }

    if (Array.isArray(storedWorkspace?.rangeDayDrills)) {
      setRangeDayDrills(
        normalizeRangeDayDrillsForWorkspace(storedWorkspace.rangeDayDrills),
      );
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

  useEffect(() => {
    if (!selectedRangeDay || !selectedDrill) {
      setBatchScoreRows({});
      return;
    }

    const scoringFormat = getScoringFormat(selectedDrill);
    const nextRows: Record<string, BatchScoreRow> = {};

    attendingRoster.forEach((entry) => {
      const existingResult = selectedRangeResults.find(
        (result) =>
          result.officerId === entry.officerId &&
          result.drillId === selectedDrill.id &&
          result.runNumber === selectedRunNumber,
      );

      let metricValue = "";

      if (existingResult) {
        if (scoringFormat === "Time") {
          metricValue =
            typeof existingResult.timeSeconds === "number"
              ? String(existingResult.timeSeconds)
              : "";
        } else if (scoringFormat === "Hit Count") {
          metricValue =
            typeof existingResult.hitCount === "number"
              ? String(existingResult.hitCount)
              : "";
        } else if (
          scoringFormat === "Qualification" ||
          scoringFormat === "Points"
        ) {
          metricValue =
            typeof existingResult.score === "number"
              ? String(existingResult.score)
              : "";
        }
      }

      nextRows[entry.officerId] = {
        officerId: entry.officerId,
        metricValue,
        passed:
          existingResult?.finalPassed ?? existingResult?.passed ?? undefined,
        completed:
          typeof existingResult?.completed === "boolean"
            ? existingResult.completed
            : undefined,
        notes: existingResult?.notes ?? "",
        malfunctionOccurred: Boolean(existingResult?.malfunctionIds?.length),
        malfunctionType: "Failure to Feed",
        malfunctionNotes: "",
      };
    });

    setBatchScoreRows(nextRows);
  }, [
    attendingRoster,
    selectedDrill,
    selectedRangeDay,
    selectedRangeResults,
    selectedRunNumber,
  ]);

  useEffect(() => {
    if (selectedRunNumber > selectedEffectiveRunCount) {
      setSelectedRunNumber(selectedEffectiveRunCount);
    }
  }, [selectedEffectiveRunCount, selectedRunNumber]);

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
    setNewDrillPassingTimeSeconds("");
    setNewDrillMinimumHits("");
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
    setActiveRangeDayTab("overview");
    setSelectedOfficerId(firstRoster?.officerId ?? "");
    setSelectedDrillId(firstDrill?.id ?? "");
    setShowLibraryPanel(false);
    setShowCreateDrillForm(false);
    resetEntryForm(1);
  }

  function goBackToOverview() {
    setSelectedRangeDayId(null);
    setActiveRangeDayTab("overview");
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
      outline: getDefaultOutlineForRangeType("Training"),
      notes: "",
    };

    setRangeDays((current) => [newRangeDay, ...current]);
    setSelectedRangeDayId(newRangeDayId);
    setActiveRangeDayTab("overview");
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

  function handleChangeRangeDayType(nextRangeType: RangeDayType) {
    if (!selectedRangeDay) return;

    setRangeDays((current) =>
      current.map((rangeDay) =>
        rangeDay.id === selectedRangeDay.id
          ? {
              ...rangeDay,
              rangeType: nextRangeType,
              outline:
                rangeDay.outline.length > 0
                  ? rangeDay.outline
                  : getDefaultOutlineForRangeType(nextRangeType),
            }
          : rangeDay,
      ),
    );
  }

  function handleChangeRangeDayStatus(
    rangeDayId: string,
    nextStatus: PlannedRangeDay["status"],
  ) {
    setRangeDays((current) =>
      current.map((rangeDay) =>
        rangeDay.id === rangeDayId
          ? {
              ...rangeDay,
              status: nextStatus,
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

  function updateBatchScoreRow(
    officerId: string,
    patch: Partial<BatchScoreRow>,
  ) {
    setBatchScoreRows((current) => {
      const existing = current[officerId] ?? {
        officerId,
        metricValue: "",
        notes: "",
        malfunctionOccurred: false,
        malfunctionType: "Failure to Feed" as MalfunctionType,
        malfunctionNotes: "",
      };

      return {
        ...current,
        [officerId]: {
          ...existing,
          ...patch,
        },
      };
    });
  }

  function handleMetricChange(officerId: string, value: string) {
    if (!selectedDrill) return;

    const currentRow = batchScoreRows[officerId];
    const automaticPass = getAutomaticPassValue(
      selectedDrill,
      getScoringFormat(selectedDrill),
      value,
      currentRow?.completed,
    );

    updateBatchScoreRow(officerId, {
      metricValue: value,
      ...(typeof automaticPass === "boolean"
        ? { passed: automaticPass }
        : {}),
    });
  }

  function handleSaveBatchResults() {
    if (!selectedRangeDay || !selectedDrill) return;

    const scoringFormat = getScoringFormat(selectedDrill);
    const rosterToScore = attendingRoster;

    if (rosterToScore.length === 0) {
      setSaveMessage("Mark at least one rostered officer present before scoring.");
      return;
    }

    const existingResultsBeingReplaced = results.filter(
      (result) =>
        result.rangeDayId === selectedRangeDay.id &&
        result.drillId === selectedDrill.id &&
        result.runNumber === selectedRunNumber &&
        rosterToScore.some((entry) => entry.officerId === result.officerId),
    );

    const replacedResultIds = new Set(
      existingResultsBeingReplaced.map((result) => result.id),
    );

    const newMalfunctions: FirearmMalfunction[] = [];
    const now = Date.now();

    const savedResults = rosterToScore.flatMap((entry, index) => {
      const row = batchScoreRows[entry.officerId];
      if (!row) return [];

      const metricEntered = row.metricValue.trim().length > 0;
      const hasEntry =
        metricEntered ||
        typeof row.passed === "boolean" ||
        typeof row.completed === "boolean" ||
        Boolean(row.notes.trim()) ||
        row.malfunctionOccurred;

      if (!hasEntry) return [];

      const firearmId = entry.assignedFirearmIds[0];
      const resultId = `result-${now}-${index}`;
      const automaticPass = getAutomaticPassValue(
        selectedDrill,
        scoringFormat,
        row.metricValue,
        row.completed,
      );
      const finalPassed =
        typeof row.passed === "boolean" ? row.passed : automaticPass;
      const malfunctionId =
        row.malfunctionOccurred && firearmId
          ? `malfunction-${now}-${index}`
          : undefined;

      const numericMetric = metricEntered ? Number(row.metricValue) : undefined;

      const result: ExtendedDrillRunResult = {
        id: resultId,
        rangeDayId: selectedRangeDay.id,
        drillId: selectedDrill.id,
        officerId: entry.officerId,
        firearmId,
        runNumber: selectedRunNumber,
        completed:
          scoringFormat === "Completion"
            ? row.completed ?? false
            : true,
        score:
          (scoringFormat === "Qualification" || scoringFormat === "Points") &&
          typeof numericMetric === "number" &&
          !Number.isNaN(numericMetric)
            ? numericMetric
            : undefined,
        timeSeconds:
          scoringFormat === "Time" &&
          typeof numericMetric === "number" &&
          !Number.isNaN(numericMetric)
            ? numericMetric
            : undefined,
        hitCount:
          scoringFormat === "Hit Count" &&
          typeof numericMetric === "number" &&
          !Number.isNaN(numericMetric)
            ? numericMetric
            : undefined,
        scoringFormatSnapshot: scoringFormat,
        passed:
          scoringFormat === "Notes Only" ? undefined : finalPassed,
        finalPassed:
          scoringFormat === "Notes Only" ? undefined : finalPassed,
        instructorId: CURRENT_USER.id,
        notes: row.notes.trim(),
        deficiencyObserved: finalPassed === false,
        remedialTrainingRecommended: finalPassed === false,
        malfunctionIds: malfunctionId ? [malfunctionId] : [],
      };

      if (malfunctionId && firearmId) {
        newMalfunctions.push({
          id: malfunctionId,
          departmentId: DEMO_DEPARTMENT.id,
          firearmId,
          officerId: entry.officerId,
          rangeDayId: selectedRangeDay.id,
          drillRunId: resultId,
          type: row.malfunctionType,
          date: new Date().toISOString(),
          resolvedOnRange: false,
          removedFromService: row.malfunctionType === "Catastrophic Failure",
          inspectionRequired: true,
          notes: row.malfunctionNotes.trim(),
          reportedByUserId: CURRENT_USER.id,
        });
      }

      return [result];
    });

    setResults((current) => [
      ...current.filter(
        (result) =>
          !(
            result.rangeDayId === selectedRangeDay.id &&
            result.drillId === selectedDrill.id &&
            result.runNumber === selectedRunNumber &&
            rosterToScore.some(
              (entry) => entry.officerId === result.officerId,
            )
          ),
      ),
      ...savedResults,
    ]);

    setMalfunctions((current) => [
      ...current.filter(
        (malfunction) =>
          !malfunction.drillRunId ||
          !replacedResultIds.has(malfunction.drillRunId),
      ),
      ...newMalfunctions,
    ]);

    setSaveMessage(
      `${savedResults.length} officer result${
        savedResults.length === 1 ? "" : "s"
      } saved for ${getRunLabel(selectedDrill, selectedRunNumber)}.`,
    );
  }

  function handleGeneratePacket() {
    if (!selectedRangeDay) return;

    const packet = createRangePacket(selectedRangeDay, CURRENT_USER.id);
    console.log("Generated range packet:", packet);

    writeStoredRangeDayWorkspace({
      rangeDays,
      drillLibrary,
      rangeDayDrills,
      rangeRoster,
      results,
      malfunctions,
    });

    window.requestAnimationFrame(() => window.print());
  }

  function handleCreateDrillTemplate() {
    if (!newDrillName.trim()) return;

    const baseTemplate = createDrillLibraryTemplate({
      departmentId: DEMO_DEPARTMENT.id,
      name: newDrillName.trim(),
      category: newDrillCategory,
      description: newDrillDescription.trim() || undefined,
      instructions: newDrillInstructions.trim() || undefined,
      firearmType: newDrillFirearmType,
      roundCount: parseOptionalNumber(newDrillRoundCount),
      estimatedMinutes: parseOptionalNumber(newDrillEstimatedMinutes),
      difficulty: newDrillDifficulty,
      defaultScoringMode: getLegacyScoringMode(newDrillScoringMode),
      defaultPassingScore:
        newDrillScoringMode === "Qualification" ||
        newDrillScoringMode === "Points"
          ? parseOptionalNumber(newDrillPassingScore)
          : undefined,
      defaultMaxScore:
        newDrillScoringMode === "Qualification" ||
        newDrillScoringMode === "Points"
          ? parseOptionalNumber(newDrillMaxScore)
          : undefined,
      defaultRunCount:
        newDrillScoringMode === "Qualification" ||
        newDrillCategory === "Qualification"
          ? Math.max(Number(newDrillRunCount) || 1, 2)
          : Math.max(Number(newDrillRunCount) || 1, 1),
      defaultRequired: newDrillDefaultRequired,
      tags: newDrillTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      createdByUserId: CURRENT_USER.id,
      notes: newDrillNotes.trim() || undefined,
    });

    const createdTemplate: ExtendedDrillTemplate = {
      ...baseTemplate,
      scoringFormat: newDrillScoringMode,
      defaultPassingTimeSeconds:
        newDrillScoringMode === "Time"
          ? parseOptionalNumber(newDrillPassingTimeSeconds)
          : undefined,
      defaultMinimumHits:
        newDrillScoringMode === "Hit Count"
          ? parseOptionalNumber(newDrillMinimumHits)
          : undefined,
    };

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

    const sourceTemplate = drillLibrary.find(
      (template) => template.id === templateId,
    );

    const normalizedCopiedDrill: ExtendedRangeDayDrill = {
      ...copiedDrill,
      runCount: isQualificationDrill(copiedDrill)
        ? Math.max(copiedDrill.runCount ?? 1, 2)
        : copiedDrill.runCount,
      scoringFormat: sourceTemplate
        ? getScoringFormat(sourceTemplate)
        : getScoringFormat(copiedDrill),
      passingTimeSeconds: sourceTemplate?.defaultPassingTimeSeconds,
      minimumHits: sourceTemplate?.defaultMinimumHits,
    };

    setRangeDayDrills((current) => [...current, normalizedCopiedDrill]);
    setSelectedDrillId(normalizedCopiedDrill.id);
    resetEntryForm(1);
  }

  if (!selectedRangeDay) {
    const visibleRangeDayIds = new Set(
      filteredRangeDays.map((rangeDay) => rangeDay.id),
    );

    const totalDrills = rangeDayDrills.filter((drill) =>
      visibleRangeDayIds.has(drill.rangeDayId),
    ).length;

    const totalRoster = rangeRoster.filter((entry) =>
      visibleRangeDayIds.has(entry.rangeDayId),
    ).length;

    const readyPackets = filteredRangeDays.filter(
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
              value={filteredRangeDays.length}
              sub={`${activeRangeDayCount} active · ${archivedRangeDayCount} archived`}
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

          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                  Search Range Days
                </label>
                <input
                  type="search"
                  value={rangeDaySearchQuery}
                  onChange={(event) => setRangeDaySearchQuery(event.target.value)}
                  placeholder="Search title, location, instructor, officer, firearm, type..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none placeholder:text-slate-600 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                  Status
                </label>
                <select
                  value={rangeDayStatusFilter}
                  onChange={(event) =>
                    setRangeDayStatusFilter(
                      event.target.value as RangeDayStatusFilter,
                    )
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                >
                  {RANGE_DAY_STATUS_FILTERS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                  Type
                </label>
                <select
                  value={rangeDayTypeFilter}
                  onChange={(event) =>
                    setRangeDayTypeFilter(event.target.value as RangeDayTypeFilter)
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                >
                  {RANGE_DAY_TYPE_FILTERS.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-2 border-t border-slate-800 pt-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Showing {filteredRangeDays.length} of {rangeDays.length} range day
                {rangeDays.length !== 1 ? "s" : ""}. Archived range days are
                hidden by default.
              </p>

              {(rangeDaySearchQuery ||
                rangeDayStatusFilter !== "All Active" ||
                rangeDayTypeFilter !== "All Types") && (
                <button
                  type="button"
                  onClick={() => {
                    setRangeDaySearchQuery("");
                    setRangeDayStatusFilter("All Active");
                    setRangeDayTypeFilter("All Types");
                  }}
                  className="self-start rounded-xl border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-400 hover:border-blue-500/40 hover:text-white sm:self-auto"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {filteredRangeDays.map((rangeDay) => {
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
                <div
                  key={rangeDay.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openRangeDay(rangeDay.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openRangeDay(rangeDay.id);
                    }
                  }}
                  className="group flex h-full cursor-pointer flex-col rounded-3xl border border-slate-800 bg-slate-900 p-4 text-left transition hover:-translate-y-[1px] hover:border-blue-500/40 hover:bg-slate-800/70 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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

                    <div className="flex flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleChangeRangeDayStatus(
                            rangeDay.id,
                            rangeDay.status === "Archived" ? "Planned" : "Archived",
                          );
                        }}
                        className={`rounded-xl border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition ${
                          rangeDay.status === "Archived"
                            ? "border-blue-500/30 bg-blue-500/10 text-blue-300 hover:border-blue-400/60"
                            : "border-slate-700 bg-slate-950/50 text-slate-500 hover:border-amber-500/40 hover:text-amber-300"
                        }`}
                      >
                        {rangeDay.status === "Archived" ? "Restore" : "Archive"}
                      </button>

                      <ChevronRight
                        size={18}
                        className="text-slate-600 transition group-hover:text-blue-300"
                      />
                    </div>
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
                      {getRangeDayOutlineForDisplay(rangeDay).slice(0, 4).map((item) => (
                        <li key={item} className="flex gap-2">
                          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Staffing
                    </p>
                    <div className="space-y-1 text-[11px] text-slate-400">
                      <p>
                        <span className="font-semibold text-slate-300">Lead:</span>{" "}
                        {getUserName(rangeDay.leadInstructorId)}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-300">Instructors:</span>{" "}
                        {rangeDay.instructorIds.length > 0
                          ? rangeDay.instructorIds.map(getUserName).join(", ")
                          : "None assigned"}
                      </p>
                      {rangeDay.staffingNotes && (
                        <p className="pt-1 text-slate-500">{rangeDay.staffingNotes}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Assigned Officers
                    </p>
                    {dayRoster.length > 0 ? (
                      <div className="space-y-1.5 text-[11px] text-slate-400">
                        {dayRoster.slice(0, 5).map((entry) => (
                          <div
                            key={entry.id}
                            className="flex items-start justify-between gap-2"
                          >
                            <span className="font-semibold text-slate-300">
                              {getUserName(entry.officerId)}
                            </span>
                            <span className="text-right text-slate-500">
                              {entry.assignedFirearmIds.length > 0
                                ? entry.assignedFirearmIds
                                    .map(getFirearmName)
                                    .join(", ")
                                : "No firearm"}
                            </span>
                          </div>
                        ))}
                        {dayRoster.length > 5 && (
                          <p className="pt-1 text-slate-500">
                            +{dayRoster.length - 5} more officer
                            {dayRoster.length - 5 !== 1 ? "s" : ""}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500">
                        No officers assigned yet.
                      </p>
                    )}
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
                </div>
              );
            })}

            {filteredRangeDays.length === 0 && (
              <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/60 p-8 text-center lg:col-span-2 2xl:col-span-3">
                <p className="text-[15px] font-semibold text-white">
                  No range days match those filters.
                </p>
                <p className="mt-1 text-[12px] text-slate-500">
                  Clear the search, change the status/type filter, or create a new
                  range day.
                </p>
              </div>
            )}
          </section>
        </div>
      </TracePointShell>
    );
  }

  return (
    <>
      <style>{`
        .printable-range-packet {
          display: none;
        }

        @media print {
          @page {
            size: letter;
            margin: 0.4in;
          }

          html,
          body {
            background: white !important;
          }

          .range-day-screen {
            display: none !important;
          }

          .printable-range-packet {
            display: block !important;
            color: #0f172a;
            background: white;
          }

          .packet-page {
            font-family: Arial, Helvetica, sans-serif;
            font-size: 10px;
            line-height: 1.35;
          }

          .packet-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 24px;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 12px;
            margin-bottom: 14px;
          }

          .packet-eyebrow {
            margin: 0 0 3px;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: #334155;
          }

          .packet-header h1 {
            margin: 0;
            font-size: 22px;
            line-height: 1.1;
          }

          .packet-subtitle {
            margin: 4px 0 0;
            font-size: 11px;
            color: #475569;
          }

          .packet-meta-box {
            min-width: 130px;
            border: 1px solid #0f172a;
            padding: 8px;
            text-align: center;
          }

          .packet-meta-box p {
            margin: 0;
            font-size: 8px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          .packet-meta-box strong {
            display: block;
            margin-top: 4px;
            font-size: 12px;
          }

          .packet-grid {
            display: grid;
            gap: 8px;
          }

          .packet-summary-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            margin-bottom: 14px;
          }

          .packet-summary-grid > div,
          .packet-section {
            border: 1px solid #cbd5e1;
            padding: 8px;
          }

          .packet-two-column {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            border: 0;
            padding: 0;
            margin-bottom: 14px;
          }

          .packet-two-column > div {
            border: 1px solid #cbd5e1;
            padding: 8px;
          }

          .packet-section {
            margin-bottom: 14px;
            page-break-inside: avoid;
          }

          .packet-page-break-safe {
            page-break-inside: auto;
          }

          .packet-section h2 {
            margin: 0 0 8px;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }

          .packet-section p {
            margin: 3px 0;
          }

          .packet-label {
            margin: 0 0 3px !important;
            font-size: 8px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #475569;
          }

          .packet-outline {
            margin: 0;
            padding-left: 18px;
          }

          .packet-outline li {
            margin-bottom: 3px;
          }

          .packet-table {
            width: 100%;
            border-collapse: collapse;
          }

          .packet-table th,
          .packet-table td {
            border: 1px solid #cbd5e1;
            padding: 5px;
            vertical-align: top;
            text-align: left;
          }

          .packet-table th {
            background: #e2e8f0;
            font-size: 8px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }

          .packet-score-table td {
            min-height: 22px;
          }

          .packet-signatures {
            display: grid;
            grid-template-columns: 1fr 120px 1fr;
            gap: 18px;
            border: 0;
            padding: 0;
            margin-top: 22px;
          }

          .packet-signature-line {
            height: 28px;
            border-bottom: 1px solid #0f172a;
          }
        }
      `}</style>

      <div className="range-day-screen">
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

        <section className="space-y-5">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-2">
            <div className="grid gap-2 md:grid-cols-5">
              {RANGE_DAY_DETAIL_TABS.map((tab) => {
                const active = activeRangeDayTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveRangeDayTab(tab.id)}
                    className={`rounded-2xl px-3 py-3 text-left transition ${
                      active
                        ? "border border-blue-500/40 bg-blue-500/10 text-white"
                        : "border border-transparent text-slate-500 hover:border-slate-800 hover:bg-slate-950/40 hover:text-slate-300"
                    }`}
                  >
                    <p className="text-[12px] font-bold">{tab.label}</p>
                    <p className="mt-0.5 hidden text-[10px] leading-4 md:block">
                      {tab.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {activeRangeDayTab === "overview" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[16px] font-bold text-white">
                      Range Day Details
                    </h2>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Core details shown on the overview card and printed packet.
                    </p>
                  </div>
                  <StatusPill label={selectedRangeDay.packetStatus} tone={selectedRangeDay.packetStatus === "Ready" ? "green" : selectedRangeDay.packetStatus === "In Progress" ? "amber" : "red"} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="lg:col-span-2">
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
                        handleChangeRangeDayType(event.target.value as RangeDayType)
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

                  <div className="lg:col-span-2">
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      Syllabus / Day Outline
                    </label>
                    <textarea
                      value={formatOutlineText(
                        getRangeDayOutlineForDisplay(selectedRangeDay),
                      )}
                      onChange={(event) =>
                        updateSelectedRangeDay(
                          "outline",
                          parseOutlineText(event.target.value),
                        )
                      }
                      rows={5}
                      placeholder="Enter one syllabus item per line"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                    />
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

              <div className="space-y-5">
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
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
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                  <h3 className="mb-3 text-[14px] font-bold text-white">
                    Quick Actions
                  </h3>
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveRangeDayTab("roster")}
                      className="rounded-xl border border-slate-700 px-3 py-2 text-left text-[12px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
                    >
                      Manage roster and firearm assignments
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveRangeDayTab("drills")}
                      className="rounded-xl border border-slate-700 px-3 py-2 text-left text-[12px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
                    >
                      Add or review planned drills
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveRangeDayTab("scoring")}
                      className="rounded-xl border border-slate-700 px-3 py-2 text-left text-[12px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
                    >
                      Open scoring board
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeRangeDayTab === "roster" && (
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Roster & Firearms
                  </h2>
                  <p className="mt-1 text-[12px] text-slate-500">
                    Add officers, mark attendance, and assign firearms without scrolling through the entire range day.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-[260px_auto]">
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
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
                  >
                    <Plus size={14} />
                    Add Officer
                  </button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {selectedRoster.length === 0 && (
                  <p className="rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-[12px] text-slate-500">
                    No officers assigned yet. Add officers above to build the range day roster.
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
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <div>
                        <p className="text-[13px] font-semibold text-white">
                          {getUserName(entry.officerId)}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {getFirearmName(entry.assignedFirearmIds[0])}
                        </p>
                      </div>

                      {entry.attended ? (
                        <CheckCircle2 size={14} className="text-emerald-400" />
                      ) : (
                        <StatusPill label="Not Present" tone="slate" />
                      )}
                    </button>

                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
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
                ))}
              </div>
            </div>
          )}

          {activeRangeDayTab === "drills" && (
            <div className="space-y-5">
              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-[17px] font-bold text-white">
                      Planned Drills
                    </h2>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Select the drills that make up this range day. Drill library recommendations are based on recent use.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowLibraryPanel((current) => !current)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-[13px] font-semibold text-slate-300 hover:border-blue-500/40 hover:text-white"
                  >
                    <Plus size={14} />
                    {showLibraryPanel ? "Hide Library" : "Add Drill"}
                  </button>
                </div>

                <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {selectedDrills.length === 0 ? (
                    <p className="rounded-2xl border border-slate-800 bg-slate-950/40 px-3 py-3 text-[12px] text-slate-500">
                      No drills added yet. Use Add Drill to build the range day.
                    </p>
                  ) : (
                    selectedDrills.map((drill) => (
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
                            {getEffectiveRunCount(drill)} run{getEffectiveRunCount(drill) !== 1 ? "s" : ""}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <StatusPill label={drill.category} />
                          <StatusPill label={getScoringFormat(drill)} tone="slate" />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {showLibraryPanel && (
                <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-[17px] font-bold text-white">
                        Add Drill From Library
                      </h2>
                      <p className="mt-1 text-[12px] text-slate-500">
                        Recommended drills appear first based on usage history and staleness.
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

                      <div className="grid gap-4 lg:grid-cols-4">
                        <div className="lg:col-span-2">
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
                            Scoring
                          </label>
                          <select
                            value={newDrillScoringMode}
                            onChange={(event) =>
                              setNewDrillScoringMode(
                                event.target.value as ScoringFormat,
                              )
                            }
                            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                          >
                            {SCORING_FORMATS.map((format) => (
                              <option key={format} value={format}>
                                {format}
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
                            Runs
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

                        <div className="lg:col-span-4">
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

                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {drillLibraryWithLifecycle.map((template) => (
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
                          {template.lifecycle.recommended ? (
                            <StatusPill label="Recommended" tone="amber" />
                          ) : null}
                          <StatusPill label={template.category} />
                          <StatusPill
                            label={template.defaultScoringMode}
                            tone="slate"
                          />
                          <StatusPill
                            label={`Used ${template.lifecycle.timesPerformed}x`}
                            tone="slate"
                          />
                          <StatusPill
                            label={`Last: ${template.lifecycle.lastPerformedDateLabel}`}
                            tone={
                              template.lifecycle.recommended ? "amber" : "slate"
                            }
                          />
                        </div>

                        {template.lifecycle.recommendationReason ? (
                          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-[11px] text-amber-200">
                            <AlertTriangle
                              size={13}
                              className="mt-0.5 flex-shrink-0"
                            />
                            <span>
                              Recommended: {template.lifecycle.recommendationReason}
                            </span>
                          </div>
                        ) : null}

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
            </div>
          )}

          {activeRangeDayTab === "scoring" && (
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-[17px] font-bold text-white">
                    Range-Day Scoring Board
                  </h2>
                  <p className="mt-1 max-w-3xl text-[12px] text-slate-500">
                    Keep every attending officer on one screen. Select the drill and run once, enter the full line, then save the group.
                  </p>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-[12px] text-slate-400">
                  <UserCheck size={14} className="text-blue-400" />
                  {attendingRoster.length} attending officer{attendingRoster.length === 1 ? "" : "s"}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                    Drill
                  </label>
                  <select
                    value={selectedDrill?.id ?? ""}
                    onChange={(event) => {
                      setSelectedDrillId(event.target.value);
                      setSelectedRunNumber(1);
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
                    Run / Course
                  </label>
                  <select
                    value={selectedRunNumber}
                    onChange={(event) =>
                      setSelectedRunNumber(Number(event.target.value))
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-[13px] text-white outline-none focus:border-blue-500"
                  >
                    {Array.from(
                      { length: selectedEffectiveRunCount },
                      (_, index) => index + 1,
                    ).map((run) => (
                      <option key={run} value={run}>
                        {getRunLabel(selectedDrill, run)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedDrill && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusPill label={getScoringFormat(selectedDrill)} />
                  <StatusPill label={selectedDrill.category} tone="slate" />
                  <StatusPill label={getRunLabel(selectedDrill, selectedRunNumber)} tone="green" />
                </div>
              )}

              {selectedDrill && (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-800">
                  <div className="min-w-[920px] divide-y divide-slate-800">
                    <div className="grid grid-cols-[210px_130px_120px_120px_1fr_150px] gap-3 bg-slate-950/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                      <span>Officer</span>
                      <span>Metric</span>
                      <span>Status</span>
                      <span>Completed</span>
                      <span>Notes</span>
                      <span>Malfunction</span>
                    </div>

                    {attendingRoster.length === 0 ? (
                      <div className="px-3 py-6 text-center text-[12px] text-slate-500">
                        Mark at least one rostered officer present before scoring.
                      </div>
                    ) : (
                      attendingRoster.map((entry) => {
                        const row = batchScoreRows[entry.officerId] ?? {
                          officerId: entry.officerId,
                          metricValue: "",
                          notes: "",
                          malfunctionOccurred: false,
                          malfunctionType: "Failure to Feed" as MalfunctionType,
                          malfunctionNotes: "",
                        };

                        const scoringFormat = getScoringFormat(selectedDrill);

                        return (
                          <div
                            key={entry.officerId}
                            className="grid grid-cols-[210px_130px_120px_120px_1fr_150px] gap-3 px-3 py-3 text-[12px]"
                          >
                            <div>
                              <p className="font-semibold text-white">
                                {getUserName(entry.officerId)}
                              </p>
                              <p className="mt-0.5 text-[10px] text-slate-500">
                                {getFirearmName(entry.assignedFirearmIds[0])}
                              </p>
                            </div>

                            <input
                              value={row.metricValue}
                              onChange={(event) =>
                                handleMetricChange(entry.officerId, event.target.value)
                              }
                              placeholder={
                                scoringFormat === "Time"
                                  ? "Seconds"
                                  : scoringFormat === "Hit Count"
                                    ? "Hits"
                                    : scoringFormat === "Completion" ||
                                        scoringFormat === "Pass/Fail" ||
                                        scoringFormat === "Notes Only"
                                      ? "—"
                                      : "Score"
                              }
                              disabled={
                                scoringFormat === "Completion" ||
                                scoringFormat === "Pass/Fail" ||
                                scoringFormat === "Notes Only"
                              }
                              className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-[11px] text-white outline-none disabled:cursor-not-allowed disabled:text-slate-600 focus:border-blue-500"
                            />

                            <select
                              value={
                                typeof row.passed === "boolean"
                                  ? row.passed
                                    ? "pass"
                                    : "fail"
                                  : ""
                              }
                              onChange={(event) =>
                                updateBatchScoreRow(entry.officerId, {
                                  passed:
                                    event.target.value === ""
                                      ? undefined
                                      : event.target.value === "pass",
                                })
                              }
                              disabled={scoringFormat === "Notes Only"}
                              className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-[11px] text-white outline-none disabled:cursor-not-allowed disabled:text-slate-600 focus:border-blue-500"
                            >
                              <option value="">Auto</option>
                              <option value="pass">Pass</option>
                              <option value="fail">Fail</option>
                            </select>

                            <button
                              type="button"
                              onClick={() =>
                                updateBatchScoreRow(entry.officerId, {
                                  completed: !(row.completed ?? true),
                                })
                              }
                              className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${
                                row.completed ?? true
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                  : "border-slate-700 text-slate-400"
                              }`}
                            >
                              {row.completed ?? true ? "Complete" : "Incomplete"}
                            </button>

                            <input
                              value={row.notes}
                              onChange={(event) =>
                                updateBatchScoreRow(entry.officerId, {
                                  notes: event.target.value,
                                })
                              }
                              placeholder="Instructor notes"
                              className="rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-[11px] text-white outline-none focus:border-blue-500"
                            />

                            <button
                              type="button"
                              onClick={() =>
                                updateBatchScoreRow(entry.officerId, {
                                  malfunctionOccurred: !row.malfunctionOccurred,
                                })
                              }
                              className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${
                                row.malfunctionOccurred
                                  ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                                  : "border-slate-700 text-slate-400"
                              }`}
                            >
                              {row.malfunctionOccurred ? "Logged" : "No"}
                            </button>

                            {row.malfunctionOccurred ? (
                              <div className="col-span-6 grid gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 sm:grid-cols-[220px_1fr]">
                                <select
                                  value={row.malfunctionType}
                                  onChange={(event) =>
                                    updateBatchScoreRow(entry.officerId, {
                                      malfunctionType:
                                        event.target.value as MalfunctionType,
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-[11px] text-white outline-none focus:border-blue-500"
                                >
                                  {MALFUNCTION_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                      {type}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={row.malfunctionNotes}
                                  onChange={(event) =>
                                    updateBatchScoreRow(entry.officerId, {
                                      malfunctionNotes: event.target.value,
                                    })
                                  }
                                  placeholder="Malfunction notes"
                                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 text-[11px] text-white outline-none focus:border-blue-500"
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] text-slate-500">
                  Scores are saved as one drill/run batch while retaining individual officer records.
                </p>

                <button
                  type="button"
                  onClick={handleSaveBatchResults}
                  disabled={!selectedDrill || attendingRoster.length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600"
                >
                  <Save size={14} />
                  Save All — {getRunLabel(selectedDrill, selectedRunNumber)}
                </button>
              </div>
            </div>
          )}

          {activeRangeDayTab === "results" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div className="space-y-5">
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                  <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                    <ClipboardList size={15} className="text-blue-400" />
                    Officer Performance Summary
                  </h3>

                  <div className="space-y-2 text-[12px] text-slate-400">
                    <p>Officer: {getUserName(selectedOfficerId)}</p>
                    <p>
                      Average Score: {getAverageScore(selectedOfficerResults) ?? "No scored runs"}
                    </p>
                    <p>
                      Pass Rate: {typeof getPassRate(selectedOfficerResults) === "number" ? `${getPassRate(selectedOfficerResults)}%` : "No pass/fail runs"}
                    </p>
                    <p>Trend: {getPerformanceTrend(selectedOfficerResults)}</p>
                  </div>
                </div>

                {malfunctions.filter(
                  (malfunction) => malfunction.rangeDayId === selectedRangeDay.id,
                ).length > 0 ? (
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
                ) : (
                  <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 text-[12px] text-slate-500">
                    No firearm malfunctions logged for this range day.
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
                <h3 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-white">
                  <FileText size={15} className="text-blue-400" />
                  Saved Drill Runs
                </h3>

                <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
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
                                {drill?.name} · {getRunLabel(drill, result.runNumber)}
                              </p>
                            </div>

                            {result.malfunctionIds?.length ? (
                              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                                Malfunction
                              </span>
                            ) : null}
                          </div>

                          <p className="mt-2 text-[11px] text-slate-400">
                            Result: {formatResultMetric(result, drill) || "—"} · Passed: {typeof result.passed === "boolean" ? result.passed ? "Yes" : "No" : "—"} · Completed: {result.completed ? "Yes" : "No"}
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
          )}
        </section>
      </div>
        </TracePointShell>
      </div>

      <PrintableRangePacket
        rangeDay={selectedRangeDay}
        roster={selectedRoster}
        drills={selectedDrills}
        results={selectedRangeResults}
        malfunctions={malfunctions}
      />
    </>
  );
}
