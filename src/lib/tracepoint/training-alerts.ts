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
    id: "alert-night-qualification-reynolds",
    officerName: "Officer C. Reynolds",
    officerAssignment: "Patrol Squad 3",
    source: "Qualification",
    category: "Night Qualification",
    severity: "High",
    status: "New",
    title: "Missing night qualification",
    basis:
      "Officer has a current day qualification record but no current night qualification record for the active cycle.",
    recommendedAction:
      "Schedule officer for the next low-light range block and create a remediation record if performance issues are observed.",
    createdAt: "2026-06-26",
    recipients: [
      "Range Master",
      "Firearms Instructors",
      "Training Supervisor",
      "Command Staff",
    ],
    relatedRecords: [
      "Qualification History",
      "Officer Training File",
      "Range Calendar",
    ],
    auditLog: [
      "Alert generated from qualification coverage review.",
    ],
  },
  {
    id: "alert-low-light-carter",
    officerName: "Officer B. Carter",
    officerAssignment: "Patrol Squad 2",
    source: "Drill Trend",
    category: "Low-Light Drills",
    severity: "Medium",
    status: "Acknowledged",
    title: "Declining low-light drill performance",
    basis:
      "Low-light drill scores declined across the last three range events while day qualification performance remained stable.",
    recommendedAction:
      "Assign targeted low-light remediation and review flashlight technique, sight picture, and decision-making under reduced light.",
    createdAt: "2026-06-25",
    recipients: [
      "Range Master",
      "Firearms Instructors",
      "Training Supervisor",
    ],
    relatedRecords: [
      "Range Day 2026-04",
      "Range Day 2026-05",
      "Range Day 2026-06",
    ],
    auditLog: [
      "Alert generated from repeated low-light drill trend.",
      "Alert acknowledged by Range Master.",
    ],
  },
  {
    id: "alert-decision-making-reynolds",
    officerName: "Officer C. Reynolds",
    officerAssignment: "Patrol Squad 3",
    source: "Drill Trend",
    category: "Decision-Making Drills",
    severity: "High",
    status: "Remediation Assigned",
    title: "Repeated decision-making deficiency",
    basis:
      "Instructor notes and scoring data show repeated deficiencies in command sequence and scenario-based decision-making.",
    recommendedAction:
      "Assign remedial scenario training and require documented successful completion before closing the alert.",
    createdAt: "2026-06-24",
    recipients: [
      "Range Master",
      "Firearms Instructors",
      "Training Supervisor",
      "Command Staff",
    ],
    relatedRecords: [
      "Scenario Drill Block",
      "Instructor Notes",
      "Officer Training File",
    ],
    remediationId: "remediation-reynolds-decision-making",
    auditLog: [
      "Alert generated from repeated drill deficiency.",
      "Remediation record created and assigned.",
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
