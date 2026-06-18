import type {
  Department,
  Firearm,
  TracePointUser,
  TracePointAlert,
} from "./types";

export const DEMO_DEPARTMENT: Department = {
  id: "dept-readington",
  name: "Readington Township Police Department",
};

export const MOCK_USERS: TracePointUser[] = [
  {
    id: "user-1",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Officer Smith",
    badgeNumber: "101",
    rank: "Patrol Officer",
    role: "Officer",
    isActive: true,
  },
  {
    id: "user-2",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Sgt. Williams",
    badgeNumber: "201",
    rank: "Sergeant",
    role: "Supervisor",
    isActive: true,
  },
  {
    id: "user-3",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Instructor Jones",
    badgeNumber: "301",
    rank: "Officer",
    role: "Instructor",
    isActive: true,
  },
  {
    id: "user-4",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Armorer Brown",
    badgeNumber: "401",
    rank: "Officer",
    role: "Armorer",
    isActive: true,
  },
  {
    id: "user-5",
    departmentId: DEMO_DEPARTMENT.id,
    name: "Chief Davis",
    badgeNumber: "001",
    rank: "Chief",
    role: "Command",
    isActive: true,
  },
  {
    id: "user-6",
    departmentId: DEMO_DEPARTMENT.id,
    name: "System Administrator",
    role: "Admin",
    isActive: true,
  },
];

export const CURRENT_USER = MOCK_USERS[3]; // Armorer

export const MOCK_FIREARMS: Firearm[] = [
  {
    id: "gun-1",
    departmentId: DEMO_DEPARTMENT.id,
    serialNumber: "RTPD1001",
    make: "Glock",
    model: "17 Gen 5",
    caliber: "9mm",
    type: "Handgun",
    status: "Assigned",
    assignedOfficerId: "user-1",
    roundCount: 6200,
    lastInspectionDate: "2026-05-01",
    nextInspectionDue: "2026-11-01",
  },
  {
    id: "gun-2",
    departmentId: DEMO_DEPARTMENT.id,
    serialNumber: "RTPD1002",
    make: "Colt",
    model: "M4 Patrol Rifle",
    caliber: "5.56",
    type: "Rifle",
    status: "In Service",
    roundCount: 9800,
    lastInspectionDate: "2026-04-15",
    nextInspectionDue: "2026-10-15",
  },
];

export const MOCK_ALERTS: TracePointAlert[] = [
  {
    id: "alert-1",
    departmentId: DEMO_DEPARTMENT.id,
    type: "Repeated Firearm Malfunction",
    severity: "High",
    status: "Open",
    title: "Inspection Required",
    message:
      "Firearm RTPD1001 has exceeded the malfunction threshold and requires armorer inspection.",
    relatedFirearmId: "gun-1",
    assignedToRole: "Armorer",
    createdAt: "2026-06-18T12:00:00Z",
  },
];