import type {
  Firearm,
  FirearmMalfunction,
  TracePointAlert,
} from "./types";

type MalfunctionAlertOptions = {
  departmentId: string;
  firearm: Firearm;
  malfunctions: FirearmMalfunction[];
  now?: string;
};

const MALFUNCTION_REVIEW_WINDOW_DAYS = 90;
const MALFUNCTION_INSPECTION_THRESHOLD = 2;

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(end - start) / (1000 * 60 * 60 * 24);
}

export function getRecentMalfunctions(
  malfunctions: FirearmMalfunction[],
  now = new Date().toISOString()
) {
  return malfunctions.filter((malfunction) => {
    return daysBetween(malfunction.date, now) <= MALFUNCTION_REVIEW_WINDOW_DAYS;
  });
}

export function shouldCreateFirearmMalfunctionAlert(
  malfunctions: FirearmMalfunction[],
  now = new Date().toISOString()
) {
  const recentMalfunctions = getRecentMalfunctions(malfunctions, now);

  return recentMalfunctions.length >= MALFUNCTION_INSPECTION_THRESHOLD;
}

export function createFirearmMalfunctionAlert({
  departmentId,
  firearm,
  malfunctions,
  now = new Date().toISOString(),
}: MalfunctionAlertOptions): TracePointAlert | null {
  const recentMalfunctions = getRecentMalfunctions(malfunctions, now);

  if (recentMalfunctions.length < MALFUNCTION_INSPECTION_THRESHOLD) {
    return null;
  }

  const mostRecentMalfunction = recentMalfunctions
    .slice()
    .sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )[0];

  return {
    id: `alert-firearm-${firearm.id}-${Date.now()}`,
    departmentId,
    type: "Repeated Firearm Malfunction",
    severity: recentMalfunctions.length >= 3 ? "Critical" : "High",
    status: "Open",
    title: "Armorer Inspection Required",
    message: `${firearm.make} ${firearm.model} (${firearm.serialNumber}) has ${recentMalfunctions.length} recorded malfunctions within ${MALFUNCTION_REVIEW_WINDOW_DAYS} days and requires armorer inspection.`,
    assignedToRole: "Armorer",
    relatedFirearmId: firearm.id,
    relatedRangeDayId: mostRecentMalfunction?.rangeDayId,
    createdAt: now,
  };
}

export function getFirearmReliabilityLabel(
  malfunctions: FirearmMalfunction[],
  now = new Date().toISOString()
) {
  const recentMalfunctions = getRecentMalfunctions(malfunctions, now);

  if (recentMalfunctions.length >= 3) {
    return "Critical";
  }

  if (recentMalfunctions.length >= 2) {
    return "Inspection Required";
  }

  if (recentMalfunctions.length === 1) {
    return "Monitor";
  }

  return "Normal";
}

export function getFirearmMalfunctionSummary(
  malfunctions: FirearmMalfunction[],
  now = new Date().toISOString()
) {
  const recentMalfunctions = getRecentMalfunctions(malfunctions, now);

  return {
    recentCount: recentMalfunctions.length,
    reviewWindowDays: MALFUNCTION_REVIEW_WINDOW_DAYS,
    inspectionThreshold: MALFUNCTION_INSPECTION_THRESHOLD,
    reliabilityLabel: getFirearmReliabilityLabel(malfunctions, now),
    inspectionRequired:
      recentMalfunctions.length >= MALFUNCTION_INSPECTION_THRESHOLD,
  };
}