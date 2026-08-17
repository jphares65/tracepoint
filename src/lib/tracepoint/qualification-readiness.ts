export type QualificationReadinessStatus =
  | "Current"
  | "Due Soon"
  | "Overdue"
  | "Missing Day"
  | "Missing Night"
  | "Failed"
  | "No Record";

export type QualificationReadinessEvent = {
  date: string;
  runLabel: string;
};

export type QualificationReadinessResult = {
  status: QualificationReadinessStatus;
  statusReason: string;
  daysSinceLastQualification?: number;
};

function getDateValue(date?: string) {
  if (!date) return 0;

  const value = new Date(`${date}T00:00:00`).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function getDaysSince(date?: string) {
  const value = getDateValue(date);
  if (!value) return undefined;

  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();

  return Math.max(
    Math.floor((today - value) / 86400000),
    0,
  );
}

function formatDate(date?: string) {
  if (!date) return "No date";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function evaluateQualificationReadiness({
  lastDayQualification,
  lastNightQualification,
  failedQualifications,
  qualificationValidDays,
  qualificationDueSoonDays,
}: {
  lastDayQualification?: QualificationReadinessEvent;
  lastNightQualification?: QualificationReadinessEvent;
  failedQualifications: QualificationReadinessEvent[];
  qualificationValidDays: number;
  qualificationDueSoonDays: number;
}): QualificationReadinessResult {
  const newestFailure = failedQualifications[0];

  const newestPassed = [lastDayQualification, lastNightQualification]
    .filter(
      (event): event is QualificationReadinessEvent => Boolean(event),
    )
    .sort(
      (a, b) => getDateValue(b.date) - getDateValue(a.date),
    )[0];

  if (
    newestFailure &&
    getDateValue(newestFailure.date) >=
      getDateValue(newestPassed?.date)
  ) {
    return {
      status: "Failed",
      statusReason: `Most recent qualification issue: ${newestFailure.runLabel} on ${formatDate(newestFailure.date)}.`,
      daysSinceLastQualification: getDaysSince(newestFailure.date),
    };
  }

  if (!lastDayQualification && !lastNightQualification) {
    return {
      status: "No Record",
      statusReason:
        "No recorded qualification result found in saved range days.",
    };
  }

  if (!lastNightQualification) {
    return {
      status: "Missing Night",
      statusReason:
        "Day qualification exists, but no night qualification is recorded.",
      daysSinceLastQualification: getDaysSince(
        lastDayQualification?.date,
      ),
    };
  }

  if (!lastDayQualification) {
    return {
      status: "Missing Day",
      statusReason:
        "Night qualification exists, but no day qualification is recorded.",
      daysSinceLastQualification: getDaysSince(
        lastNightQualification.date,
      ),
    };
  }

  const oldestRequiredDate =
    getDateValue(lastDayQualification.date) <
    getDateValue(lastNightQualification.date)
      ? lastDayQualification.date
      : lastNightQualification.date;

  const daysSinceOldestRequired =
    getDaysSince(oldestRequiredDate);

  if (daysSinceOldestRequired === undefined) {
    return {
      status: "No Record",
      statusReason:
        "Qualification dates could not be evaluated.",
    };
  }

  if (daysSinceOldestRequired > qualificationValidDays) {
    return {
      status: "Overdue",
      statusReason: `Oldest required qualification is ${daysSinceOldestRequired} days old.`,
      daysSinceLastQualification: daysSinceOldestRequired,
    };
  }

  const dueSoonThreshold = Math.max(
    0,
    qualificationValidDays - qualificationDueSoonDays,
  );

  if (daysSinceOldestRequired >= dueSoonThreshold) {
    return {
      status: "Due Soon",
      statusReason: `Qualification is approaching the ${qualificationValidDays}-day validity limit.`,
      daysSinceLastQualification: daysSinceOldestRequired,
    };
  }

  return {
    status: "Current",
    statusReason:
      "Day and night qualification records are present and within the current cycle.",
    daysSinceLastQualification: daysSinceOldestRequired,
  };
}
