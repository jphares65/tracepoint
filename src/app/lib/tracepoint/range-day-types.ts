import type { ScoringMode } from "./types";

export type RangeDayStatus =
  | "Planned"
  | "In Progress"
  | "Completed"
  | "Locked"
  | "Archived";

export type DrillCategory =
  | "Qualification"
  | "Marksmanship"
  | "Movement"
  | "Low Light"
  | "Decision Making"
  | "Rifle"
  | "Shotgun"
  | "Transition"
  | "Malfunction Clearance"
  | "Active Shooter"
  | "Other";

export type RangeDay = {
  id: string;
  departmentId: string;
  title: string;
  date: string;
  location: string;
  status: RangeDayStatus;
  leadInstructorId: string;
  instructorIds: string[];
  weather?: string;
  notes?: string;
};

export type RangeRosterEntry = {
  id: string;
  rangeDayId: string;
  officerId: string;
  assignedFirearmIds: string[];
  attended: boolean;
  attendanceTime?: string;
  notes?: string;
};

export type RangeDayDrill = {
  id: string;
  rangeDayId: string;
  name: string;
  category: DrillCategory;
  description?: string;
  scoringMode: ScoringMode;
  passingScore?: number;
  maxScore?: number;
  runCount: number;
  required: boolean;
  notes?: string;
};

export type DrillRunResult = {
  id: string;
  rangeDayId: string;
  drillId: string;
  officerId: string;
  firearmId?: string;

  runNumber: number;

  completed: boolean;

  score?: number;
  passed?: boolean;

  instructorId: string;

  notes?: string;

  deficiencyObserved?: boolean;
  remedialTrainingRecommended?: boolean;

  malfunctionIds?: string[];
};

export type InstructorObservation = {
  id: string;
  rangeDayId: string;
  officerId: string;
  instructorId: string;

  category:
    | "Safety"
    | "Marksmanship"
    | "Movement"
    | "Decision Making"
    | "Weapon Handling"
    | "Other";

  observation: string;

  positiveObservation: boolean;

  remedialTrainingRecommended: boolean;

  createdAt: string;
};

export type RemedialTrainingRecommendation = {
  id: string;

  officerId: string;

  rangeDayId: string;

  createdByInstructorId: string;

  reason: string;

  assignedDate: string;

  completed: boolean;

  completedDate?: string;

  notes?: string;
};

export type RangePacket = {
  id: string;

  rangeDayId: string;

  generatedByUserId: string;

  generatedAt: string;

  includesRoster: boolean;

  includesQualificationSheets: boolean;

  includesDrillSheets: boolean;

  includesRemedialSection: boolean;

  includesInstructorNotes: boolean;
};

export type DrillTemplate = {
  id: string;

  departmentId: string;

  name: string;

  category: DrillCategory;

  description?: string;

  defaultScoringMode: ScoringMode;

  defaultPassingScore?: number;

  defaultMaxScore?: number;

  defaultRunCount: number;

  active: boolean;
};

export type OfficerPerformanceMetric = {
  officerId: string;

  category: DrillCategory;

  averageScore?: number;

  passRate?: number;

  totalRuns: number;

  trend: "Improving" | "Stable" | "Declining";

  lastUpdated: string;
};