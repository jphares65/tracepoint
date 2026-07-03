"use client";

export type TrainingAlertSeverity = "Low" | "Medium" | "High";

export type TrainingAlertStatus =
  | "New"
  | "Acknowledged"
  | "Remediation Assigned"
  | "In Progress"
  | "Resolved"
  | "Escalated"
  | "Dismissed with Reason";

export type RemediationStatus =
  | "Open"
  | "Scheduled"
  | "In Progress"
  | "Completed - Successful"
  | "Completed - Additional Training Needed"
  | "Escalated to Command"
  | "Closed - Administrative";

export type TrainingAlertSource =
  | "Qualification"
  | "Drill Trend"
  | "Instructor Note"
  | "Command Review";

export type TrainingAlert = {
  id: string;
  officerName: string;
  officerAssignment: string;
  source: TrainingAlertSource;
  category: string;
  severity: TrainingAlertSeverity;
  status: TrainingAlertStatus;
  title: string;
  basis: string;
  recommendedAction: string;
  createdAt: string;
  recipients: string[];
  relatedRecords: string[];
  remediationId?: string;
  auditLog: string[];
};

export type RemediationRecord = {
  id: string;
  officerName: string;
  officerAssignment: string;
  linkedAlertId: string;
  triggerSource: TrainingAlertSource;
  deficiencyCategory: string;
  severity: TrainingAlertSeverity;
  assignedInstructor: string;
  dateAssigned: string;
  dueDate: string;
  status: RemediationStatus;
  remediationPlan: string;
  trainingCompleted: string;
  outcome: string;
  notes: string[];
  commandNotified: boolean;
  auditLog: string[];
};

export const TRAINING_ALERTS_STORAGE_KEY =
  "tracepoint.trainingAlerts.v1";

export const REMEDIATIONS_STORAGE_KEY =
  "tracepoint.remediations.v1";

export const DEFAULT_TRAINING_ALERTS: TrainingAlert[] = [
  {
    id: "alert-qualification-smith",
    officerName: "Officer Smith",
    officerAssignment: "Patrol",
    source: "Qualification",
    category: "Qualification Compliance",
    severity: "Medium",
    status: "New",
    title: "Qualification record requires review",
    basis:
      "Saved pilot range data indicates this officer has qualification information requiring instructor review.",
    recommendedAction:
      "Review the officer's qualification history and determine whether follow-up training is needed.",
    createdAt: "2026-07-02",
    recipients: [
      "Range Master",
      "Firearms Instructors",
      "Training Supervisor",
    ],
    relatedRecords: [
      "Qualification History",
      "Range Day Workspace",
    ],
    auditLog: [
      "Default alert aligned to pilot personnel data.",
    ],
  },
  {
    id: "alert-drill-williams",
    officerName: "Sgt. Williams",
    officerAssignment: "Supervision",
    source: "Drill Trend",
    category: "Low-Light Drills",
    severity: "Medium",
    status: "New",
    title: "Drill performance trend requires review",
    basis:
      "Saved pilot range data indicates a drill-performance trend that should be reviewed by training staff.",
    recommendedAction:
      "Review the related drill results and determine whether remediation should be assigned.",
    createdAt: "2026-07-02",
    recipients: [
      "Range Master",
      "Firearms Instructors",
      "Training Supervisor",
    ],
    relatedRecords: [
      "Range Day Drill Results",
      "Instructor Notes",
    ],
    auditLog: [
      "Default alert aligned to pilot personnel data.",
    ],
  },
  {
    id: "alert-instructor-jones",
    officerName: "Instructor Jones",
    officerAssignment: "Firearms Instructor",
    source: "Instructor Note",
    category: "Instructor Review",
    severity: "Low",
    status: "Acknowledged",
    title: "Instructor note pending documentation",
    basis:
      "Instructor notes should be reviewed and finalized as part of the pilot workflow.",
    recommendedAction:
      "Confirm notes are complete and linked to the appropriate range day or drill record.",
    createdAt: "2026-07-02",
    recipients: [
      "Range Master",
      "Firearms Instructors",
    ],
    relatedRecords: [
      "Instructor Notes",
      "Range Day Workspace",
    ],
    auditLog: [
      "Default alert aligned to pilot personnel data.",
    ],
  },
];

export const DEFAULT_REMEDIATIONS: RemediationRecord[] = [
  {
    id: "remediation-reynolds-decision-making",
    officerName: "Officer C. Reynolds",
    officerAssignment: "Patrol Squad 3",
    linkedAlertId: "alert-decision-making-reynolds",
    triggerSource: "Drill Trend",
    deficiencyCategory: "Decision-Making Drills",
    severity: "High",
    assignedInstructor: "Range Master",
    dateAssigned: "2026-06-24",
    dueDate: "Next scheduled range block",
    status: "Scheduled",
    remediationPlan:
      "Complete scenario-based decision-making review, command sequence review, and two documented practical drill runs.",
    trainingCompleted:
      "Pending completion.",
    outcome:
      "Pending instructor review.",
    notes: [
      "Created from repeated decision-making drill trend.",
      "Command staff visibility recommended because severity is high.",
    ],
    commandNotified: true,
    auditLog: [
      "Remediation created from Training Alert.",
      "Assigned to Range Master.",
    ],
  },
];

export function cloneTrainingAlerts() {
  return JSON.parse(
    JSON.stringify(DEFAULT_TRAINING_ALERTS),
  ) as TrainingAlert[];
}

export function cloneRemediations() {
  return JSON.parse(
    JSON.stringify(DEFAULT_REMEDIATIONS),
  ) as RemediationRecord[];
}

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function buildRemediationFromAlert(
  alert: TrainingAlert,
): RemediationRecord {
  return {
    id: `remediation-${alert.id}-${Date.now()}`,
    officerName: alert.officerName,
    officerAssignment: alert.officerAssignment,
    linkedAlertId: alert.id,
    triggerSource: alert.source,
    deficiencyCategory: alert.category,
    severity: alert.severity,
    assignedInstructor: "Unassigned",
    dateAssigned: todayStamp(),
    dueDate: "Not scheduled",
    status: "Open",
    remediationPlan:
      "Review the supporting qualification/drill data, schedule targeted corrective training, document the training completed, and record the final outcome.",
    trainingCompleted: "Not yet completed.",
    outcome: "Pending.",
    notes: [
      `Created from Training Alert: ${alert.title}`,
      alert.basis,
    ],
    commandNotified: alert.severity === "High",
    auditLog: [
      `Remediation created from alert on ${todayStamp()}.`,
    ],
  };
}
