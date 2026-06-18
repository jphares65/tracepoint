import type {
  Firearm,
  FirearmInspection,
  FirearmMalfunction,
  FirearmStatus,
} from "./types";

import {
  getFirearmMalfunctionSummary,
  getRecentMalfunctions,
} from "./alert-utils";

export function getFirearmDisplayName(firearm: Firearm) {
  return `${firearm.make} ${firearm.model} (${firearm.serialNumber})`;
}

export function getAssignedFirearmsForOfficer(
  firearms: Firearm[],
  officerId: string
) {
  return firearms.filter((firearm) => firearm.assignedOfficerId === officerId);
}

export function getFirearmsRequiringInspection(
  firearms: Firearm[],
  malfunctions: FirearmMalfunction[],
  now = new Date().toISOString()
) {
  return firearms.filter((firearm) => {
    const firearmMalfunctions = malfunctions.filter(
      (malfunction) => malfunction.firearmId === firearm.id
    );

    const summary = getFirearmMalfunctionSummary(firearmMalfunctions, now);

    return (
      firearm.status === "Inspection Required" ||
      summary.inspectionRequired
    );
  });
}

export function getFirearmReliabilitySummary(
  firearm: Firearm,
  malfunctions: FirearmMalfunction[],
  inspections: FirearmInspection[] = [],
  now = new Date().toISOString()
) {
  const firearmMalfunctions = malfunctions.filter(
    (malfunction) => malfunction.firearmId === firearm.id
  );

  const firearmInspections = inspections.filter(
    (inspection) => inspection.firearmId === firearm.id
  );

  const malfunctionSummary = getFirearmMalfunctionSummary(
    firearmMalfunctions,
    now
  );

  const lastInspection = firearmInspections
    .slice()
    .sort(
      (a, b) =>
        new Date(b.inspectionDate).getTime() -
        new Date(a.inspectionDate).getTime()
    )[0];

  return {
    firearmId: firearm.id,
    displayName: getFirearmDisplayName(firearm),
    status: firearm.status,
    recentMalfunctionCount: malfunctionSummary.recentCount,
    reviewWindowDays: malfunctionSummary.reviewWindowDays,
    inspectionThreshold: malfunctionSummary.inspectionThreshold,
    reliabilityLabel: malfunctionSummary.reliabilityLabel,
    inspectionRequired: malfunctionSummary.inspectionRequired,
    lastInspectionDate:
      lastInspection?.inspectionDate ?? firearm.lastInspectionDate,
    nextInspectionDue: firearm.nextInspectionDue,
  };
}

export function shouldRemoveFirearmFromService(
  malfunctions: FirearmMalfunction[]
) {
  return malfunctions.some(
    (malfunction) =>
      malfunction.type === "Catastrophic Failure" ||
      malfunction.removedFromService
  );
}

export function calculateUpdatedFirearmStatus(
  firearm: Firearm,
  malfunctions: FirearmMalfunction[],
  now = new Date().toISOString()
): FirearmStatus {
  const firearmMalfunctions = malfunctions.filter(
    (malfunction) => malfunction.firearmId === firearm.id
  );

  const recentMalfunctions = getRecentMalfunctions(firearmMalfunctions, now);

  if (shouldRemoveFirearmFromService(firearmMalfunctions)) {
    return "Out of Service";
  }

  if (recentMalfunctions.length >= 2) {
    return "Inspection Required";
  }

  return firearm.status;
}

export function addMalfunctionToFirearmRecord(
  firearm: Firearm,
  malfunction: FirearmMalfunction,
  allMalfunctions: FirearmMalfunction[],
  now = new Date().toISOString()
) {
  const updatedMalfunctions = [...allMalfunctions, malfunction];

  const updatedStatus = calculateUpdatedFirearmStatus(
    firearm,
    updatedMalfunctions,
    now
  );

  return {
    firearm: {
      ...firearm,
      status: updatedStatus,
    },
    malfunctions: updatedMalfunctions,
  };
}

export function isInspectionOverdue(
  firearm: Firearm,
  now = new Date().toISOString()
) {
  if (!firearm.nextInspectionDue) {
    return false;
  }

  return new Date(firearm.nextInspectionDue).getTime() < new Date(now).getTime();
}

export function getInspectionStatusLabel(
  firearm: Firearm,
  now = new Date().toISOString()
) {
  if (firearm.status === "Inspection Required") {
    return "Inspection Required";
  }

  if (isInspectionOverdue(firearm, now)) {
    return "Overdue";
  }

  if (firearm.nextInspectionDue) {
    return "Scheduled";
  }

  return "Not Scheduled";
}