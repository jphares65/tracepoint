export type UserRole =
  | "Officer"
  | "Supervisor"
  | "Instructor"
  | "Armorer"
  | "Admin"
  | "Command";

export type Department = {
  id: string;
  name: string;
};

export type TracePointUser = {
  id: string;
  departmentId: string;
  name: string;
  rank?: string;
  badgeNumber?: string;
  role: UserRole;
  isActive: boolean;
};

export type FirearmStatus =
  | "In Service"
  | "Assigned"
  | "Maintenance"
  | "Inspection Required"
  | "Out of Service"
  | "Retired"
  | "Missing";

export type Firearm = {
  id: string;
  departmentId: string;
  serialNumber: string;
  make: string;
  model: string;
  caliber: string;
  type: "Handgun" | "Rifle" | "Shotgun" | "Less Lethal" | "Other";
  status: FirearmStatus;
  assignedOfficerId?: string;
  roundCount?: number;
  lastInspectionDate?: string;
  nextInspectionDue?: string;
  notes?: string;
};

export type MalfunctionType =
  | "Failure to Feed"
  | "Failure to Eject"
  | "Failure to Fire"
  | "Light Primer Strike"
  | "Magazine Issue"
  | "Optic Failure"
  | "Weapon Light Failure"
  | "Trigger Issue"
  | "Catastrophic Failure"
  | "Other";

export type FirearmMalfunction = {
  id: string;
  departmentId: string;
  firearmId: string;
  officerId?: string;
  rangeDayId?: string;
  drillRunId?: string;
  type: MalfunctionType;
  date: string;
  resolvedOnRange: boolean;
  removedFromService: boolean;
  inspectionRequired: boolean;
  notes?: string;
  reportedByUserId: string;
};

export type FirearmInspection = {
  id: string;
  departmentId: string;
  firearmId: string;
  inspectionDate: string;
  inspectedByUserId: string;
  reason:
    | "Scheduled"
    | "Malfunction"
    | "Pre-Issue"
    | "Post-Repair"
    | "Annual"
    | "Other";
  findings?: string;
  correctiveAction?: string;
  returnedToService: boolean;
  nextInspectionDue?: string;
};

export type ScoringMode =
  | "Scored"
  | "Pass/Fail"
  | "Completion Only"
  | "Notes Only";

export type RangeDayStatus =
  | "Planned"
  | "In Progress"
  | "Completed"
  | "Locked"
  | "Archived";

export type RangeDay = {
  id: string;
  departmentId: string;
  date: string;
  location: string;
  status: RangeDayStatus;
  leadInstructorId: string;
  instructorIds: string[];
  notes?: string;
};

export type RangeDayOfficer = {
  id: string;
  rangeDayId: string;
  officerId: string;
  firearmIds: string[];
  attended: boolean;
  notes?: string;
};

export type RangeDayDrill = {
  id: string;
  rangeDayId: string;
  name: string;
  description?: string;
  scoringMode: ScoringMode;
  passingScore?: number;
  maxScore?: number;
  runCount: number;
  notes?: string;
};

export type DrillRun = {
  id: string;
  rangeDayId: string;
  rangeDayDrillId: string;
  officerId: string;
  firearmId?: string;
  runNumber: number;
  score?: number;
  passed?: boolean;
  completed: boolean;
  notes?: string;
  instructorId: string;
  malfunctionIds?: string[];
};

export type QualificationCourse = {
  id: string;
  departmentId: string;
  name: string;
  firearmType: Firearm["type"];
  activeVersionId: string;
};

export type QualificationCourseVersion = {
  id: string;
  qualificationCourseId: string;
  versionName: string;
  effectiveDate: string;
  passingScore: number;
  maxScore: number;
  description?: string;
  isActive: boolean;
};

export type QualificationResult = {
  id: string;
  departmentId: string;
  officerId: string;
  firearmId?: string;
  qualificationCourseId: string;
  qualificationCourseVersionId: string;
  rangeDayId?: string;
  date: string;
  score: number;
  passed: boolean;
  instructorId: string;
  notes?: string;
};

export type AlertType =
  | "Declining Performance"
  | "Qualification Due"
  | "Qualification Overdue"
  | "Repeated Firearm Malfunction"
  | "Inspection Due"
  | "Inspection Required"
  | "Remedial Training Recommended"
  | "Approval Required";

export type AlertSeverity = "Low" | "Medium" | "High" | "Critical";

export type AlertStatus = "Open" | "Acknowledged" | "Resolved" | "Dismissed";

export type TracePointAlert = {
  id: string;
  departmentId: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  assignedToRole?: UserRole;
  assignedToUserId?: string;
  relatedOfficerId?: string;
  relatedFirearmId?: string;
  relatedRangeDayId?: string;
  relatedQualificationResultId?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type ApprovalStatus =
  | "Draft"
  | "Submitted"
  | "In Review"
  | "Returned"
  | "Approved"
  | "Denied"
  | "Archived";

export type ApprovalAction =
  | "Submitted"
  | "Reviewed"
  | "Returned"
  | "Approved"
  | "Denied"
  | "Archived";

export type ApprovalHistoryEntry = {
  id: string;
  departmentId: string;
  entityType: "Off Duty Firearm" | "Range Day" | "Inspection" | "Other";
  entityId: string;
  action: ApprovalAction;
  fromStatus?: ApprovalStatus;
  toStatus: ApprovalStatus;
  performedByUserId: string;
  performedAt: string;
  comments?: string;
};

export type AuditAction =
  | "Created"
  | "Updated"
  | "Deleted"
  | "Viewed"
  | "Approved"
  | "Denied"
  | "Returned"
  | "Alert Generated"
  | "Status Changed";

export type AuditLogEntry = {
  id: string;
  departmentId: string;
  userId: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  timestamp: string;
  summary: string;
  previousValue?: unknown;
  newValue?: unknown;
};

export {};