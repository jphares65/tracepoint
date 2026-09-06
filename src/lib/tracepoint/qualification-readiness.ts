export type QualificationReadinessStatus =
  | "Current"
  | "Due Soon"
  | "Overdue"
  | "Missing Day"
  | "Missing Night"
  | "Failed"
  | "No Record";

export type QualificationComponent = "day" | "night";

export type QualificationReadinessEvent = {
  date: string;
  runLabel: string;
  component?: QualificationComponent;
  expiresOn?: string | null;
};

export type QualificationReadinessResult = {
  status: QualificationReadinessStatus;
  statusReason: string;
  daysSinceLastQualification?: number;
};

export type CanonicalQualificationAttempt = QualificationReadinessEvent & {
  id: string;
  officerUserId: string;
  completed: boolean;
  passed?: boolean;
  score?: number;
  firearmId?: string;
  firearmType?: string;
  standardId?: string;
  standardName?: string;
  recordOrigin: "range_workspace" | "qualification_result";
};

export type QualificationStandardSummary = {
  id?: string;
  name: string;
  firearmType?: string;
  components?: Array<{ name: string; isRequired?: boolean }>;
};

export type CanonicalQualificationScope = {
  firearmType?: string;
  firearmId?: string;
  standardId?: string;
  standardName?: string;
  requiredComponents?: readonly QualificationComponent[];
};

export type CanonicalQualificationReadiness = QualificationReadinessResult & {
  attempts: CanonicalQualificationAttempt[];
  matchingAttempts: CanonicalQualificationAttempt[];
  excluded: {
    incomplete: number;
    wrongFirearm: number;
    wrongStandard: number;
  };
  scopeKey: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function get(record: unknown, ...keys: string[]) {
  if (!record || typeof record !== "object") return undefined;
  const row = record as Record<string, unknown>;
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

function records(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalized(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function getDateValue(date?: string | null) {
  if (!date) return 0;
  const value = new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getDaysSince(date?: string, today = new Date()) {
  const value = getDateValue(date);
  if (!value) return undefined;
  return Math.max(Math.floor((startOfLocalDay(today) - value) / 86400000), 0);
}

function formatDate(date?: string) {
  if (!date) return "No date";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function componentFrom(...values: unknown[]): QualificationComponent | undefined {
  const value = normalized(values.filter(Boolean).join(" "));
  if (/\b(night|low light|lowlight)\b/.test(value)) return "night";
  if (/\b(day|daylight)\b/.test(value)) return "day";
  return undefined;
}

function qualificationStandardFor(
  standardName: string,
  standards: QualificationStandardSummary[],
) {
  const name = normalized(standardName);
  if (!name) return undefined;
  return standards.find((standard) => {
    const candidate = normalized(standard.name);
    return candidate && (name === candidate || name.startsWith(`${candidate} `));
  });
}

function mapWorkspaceAttempts(
  workspacePayload: unknown,
  officerId: string,
  standards: QualificationStandardSummary[],
) {
  const payload = workspacePayload && typeof workspacePayload === "object"
    ? workspacePayload as Record<string, unknown>
    : {};
  const workspace = payload.workspace && typeof payload.workspace === "object"
    ? payload.workspace as Record<string, unknown>
    : payload;
  const rangeDays = records(get(workspace, "rangeDays", "range_days"));
  const drills = records(get(workspace, "rangeDayDrills", "range_day_drills"));
  const results = records(get(workspace, "results"));
  const rangeDaysById = new Map(rangeDays.map((row) => [text(get(row, "id")), row]));
  const drillsById = new Map(drills.map((row) => [text(get(row, "id")), row]));

  return results.flatMap<CanonicalQualificationAttempt>((result) => {
    if (text(get(result, "officerId", "officer_id")) !== officerId) return [];
    const drill = drillsById.get(text(get(result, "drillId", "drill_id")));
    const category = normalized(get(drill, "category"));
    const drillName = text(get(drill, "name"));
    const scoring = normalized(get(result, "scoringFormatSnapshot", "scoring_format_snapshot"));
    const standardSnapshot = get(result, "departmentStandardSnapshot", "department_standard_snapshot");
    const snapshotName = text(get(standardSnapshot, "departmentStandardName", "department_standard_name"));
    const isQualification = category === "qualification"
      || normalized(drillName).includes("qualification")
      || scoring === "qualification"
      || Boolean(snapshotName);
    if (!isQualification) return [];

    const rangeDay = rangeDaysById.get(text(get(result, "rangeDayId", "range_day_id")));
    const date = text(get(rangeDay, "date", "range_date"));
    if (!date) return [];
    const runNumber = Number(get(result, "runNumber", "run_number") ?? 0);
    const component = componentFrom(
      get(result, "lightingCondition", "lighting_condition"),
      snapshotName,
      drillName,
    ) ?? (runNumber === 2 ? "night" : runNumber === 1 ? "day" : undefined);
    const standard = qualificationStandardFor(snapshotName, standards);
    const departmentStandardPassed = booleanValue(
      get(result, "departmentStandardPassed", "department_standard_passed"),
    );
    const recordedPass = booleanValue(get(result, "finalPassed", "final_passed"))
      ?? booleanValue(get(result, "passed"));
    const passed = departmentStandardPassed === false ? false : recordedPass;

    return [{
      id: text(get(result, "id")) || `${officerId}:${date}:${runNumber}`,
      officerUserId: officerId,
      date,
      runLabel: component === "night" ? "Night Qualification" : component === "day" ? "Day Qualification" : "Qualification",
      component,
      completed: get(result, "completed") === true,
      passed,
      score: numberValue(get(result, "score")),
      firearmId: text(get(result, "firearmId", "firearm_id")) || undefined,
      firearmType: text(get(drill, "firearmType", "firearm_type")) || undefined,
      standardId: standard?.id,
      standardName: standard?.name || snapshotName || text(get(drill, "departmentStandardName", "department_standard_name")) || undefined,
      recordOrigin: "range_workspace",
    }];
  });
}

function mapStoredAttempts(results: unknown, officerUserId: string) {
  return records(results).flatMap<CanonicalQualificationAttempt>((result) => {
    if (text(get(result, "officerUserId", "officer_user_id")) !== officerUserId) return [];
    const date = text(get(result, "qualificationDate", "qualification_date"));
    if (!date) return [];
    const lighting = get(result, "lightingCondition", "lighting_condition");
    const component = componentFrom(lighting);
    const nestedCourse = get(result, "qualificationCourse", "qualification_course", "qualification_courses");
    const historicalType = text(get(result, "qualificationType", "historicalQualificationType", "historical_qualification_type"));

    return [{
      id: text(get(result, "id")) || `${officerUserId}:${date}:${text(lighting)}`,
      officerUserId,
      date,
      runLabel: component === "night" ? "Night Qualification" : component === "day" ? "Day Qualification" : "Qualification",
      component,
      expiresOn: text(get(result, "expiresOn", "expires_on")) || undefined,
      completed: true,
      passed: booleanValue(get(result, "passed")),
      score: numberValue(get(result, "score")),
      firearmId: text(get(result, "firearmId", "firearm_id")) || undefined,
      firearmType: historicalType || text(get(nestedCourse, "firearmType", "firearm_type")) || undefined,
      standardId: text(get(result, "qualificationCourseId", "qualification_course_id")) || undefined,
      standardName: text(get(result, "historicalCourseName", "historical_course_name")) || text(get(nestedCourse, "name")) || undefined,
      recordOrigin: "qualification_result",
    }];
  });
}

function eventIsExpired(event: QualificationReadinessEvent, validDays: number, today: Date) {
  const expiresAt = getDateValue(event.expiresOn);
  if (expiresAt) return expiresAt < startOfLocalDay(today);
  const age = getDaysSince(event.date, today);
  return age === undefined || age > validDays;
}

function eventIsDueSoon(event: QualificationReadinessEvent, validDays: number, dueSoonDays: number, today: Date) {
  const expiresAt = getDateValue(event.expiresOn);
  if (expiresAt) return expiresAt <= startOfLocalDay(today) + Math.max(0, dueSoonDays) * 86400000;
  const age = getDaysSince(event.date, today);
  return age !== undefined && age >= Math.max(0, validDays - dueSoonDays);
}

export function evaluateQualificationReadiness({
  lastDayQualification,
  lastNightQualification,
  failedQualifications,
  qualificationValidDays,
  qualificationDueSoonDays,
  requiredComponents = ["day", "night"],
  today = new Date(),
}: {
  lastDayQualification?: QualificationReadinessEvent;
  lastNightQualification?: QualificationReadinessEvent;
  failedQualifications: QualificationReadinessEvent[];
  qualificationValidDays: number;
  qualificationDueSoonDays: number;
  requiredComponents?: readonly QualificationComponent[];
  today?: Date;
}): QualificationReadinessResult {
  const passes = { day: lastDayQualification, night: lastNightQualification };
  const newestActionableFailure = [...failedQualifications]
    .sort((a, b) => getDateValue(b.date) - getDateValue(a.date))
    .find((failure) => {
      const relevantPass = failure.component
        ? passes[failure.component]
        : [lastDayQualification, lastNightQualification]
            .filter((event): event is QualificationReadinessEvent => Boolean(event))
            .sort((a, b) => getDateValue(b.date) - getDateValue(a.date))[0];
      return getDateValue(failure.date) >= getDateValue(relevantPass?.date);
    });
  if (newestActionableFailure) {
    return {
      status: "Failed",
      statusReason: `Most recent qualification issue: ${newestActionableFailure.runLabel} on ${formatDate(newestActionableFailure.date)}.`,
      daysSinceLastQualification: getDaysSince(newestActionableFailure.date, today),
    };
  }

  const needsDay = requiredComponents.includes("day");
  const needsNight = requiredComponents.includes("night");
  if (needsDay && !lastDayQualification && needsNight && !lastNightQualification) {
    return { status: "No Record", statusReason: "No completed passing qualification result matches the required standard, firearm, and component scope." };
  }
  if (needsNight && !lastNightQualification) {
    return { status: "Missing Night", statusReason: "A matching day qualification exists, but the required night component is incomplete or missing.", daysSinceLastQualification: getDaysSince(lastDayQualification?.date, today) };
  }
  if (needsDay && !lastDayQualification) {
    return { status: "Missing Day", statusReason: "A matching night qualification exists, but the required day component is incomplete or missing.", daysSinceLastQualification: getDaysSince(lastNightQualification?.date, today) };
  }

  const requiredPasses = requiredComponents
    .map((component) => passes[component])
    .filter((event): event is QualificationReadinessEvent => Boolean(event));
  if (!requiredPasses.length) {
    return { status: "No Record", statusReason: "No completed passing qualification result matches the required scope." };
  }
  const oldestRequired = [...requiredPasses].sort((a, b) => getDateValue(a.date) - getDateValue(b.date))[0];
  const daysSinceOldestRequired = getDaysSince(oldestRequired.date, today);
  const expiredRequired = requiredPasses.find((event) =>
    eventIsExpired(event, qualificationValidDays, today),
  );
  if (expiredRequired) {
    return {
      status: "Overdue",
      statusReason: expiredRequired.expiresOn
        ? `A required qualification component expired on ${formatDate(expiredRequired.expiresOn)}.`
        : `Oldest required qualification is ${daysSinceOldestRequired} days old.`,
      daysSinceLastQualification: daysSinceOldestRequired,
    };
  }
  if (requiredPasses.some((event) => eventIsDueSoon(event, qualificationValidDays, qualificationDueSoonDays, today))) {
    return { status: "Due Soon", statusReason: `Qualification is approaching the ${qualificationValidDays}-day validity limit.`, daysSinceLastQualification: daysSinceOldestRequired };
  }
  return { status: "Current", statusReason: "All required qualification components match the configured standard and firearm scope and are current.", daysSinceLastQualification: daysSinceOldestRequired };
}

export function evaluateCanonicalQualificationReadiness({
  workspace,
  qualificationResults,
  qualificationStandards,
  officerId,
  officerUserId = officerId,
  scope = {},
  qualificationValidDays,
  qualificationDueSoonDays,
  today,
}: {
  workspace: unknown;
  qualificationResults: unknown;
  qualificationStandards?: QualificationStandardSummary[];
  officerId: string;
  officerUserId?: string;
  scope?: CanonicalQualificationScope;
  qualificationValidDays: number;
  qualificationDueSoonDays: number;
  today?: Date;
}): CanonicalQualificationReadiness {
  const payloadStandards = get(workspace, "qualificationStandards", "qualification_standards");
  const standards = (qualificationStandards ?? records(payloadStandards)) as QualificationStandardSummary[];
  const attempts = [
    ...mapWorkspaceAttempts(workspace, officerId, standards),
    ...mapStoredAttempts(qualificationResults, officerUserId),
  ].sort((a, b) => getDateValue(b.date) - getDateValue(a.date));
  const expectedFirearmType = normalized(scope.firearmType ?? "handgun");
  const expectedStandardName = normalized(scope.standardName);
  const activeStandard = standards.find((standard) => {
    const typeMatches = !expectedFirearmType || normalized(standard.firearmType) === expectedFirearmType;
    const idMatches = !scope.standardId || standard.id === scope.standardId;
    const nameMatches = !expectedStandardName || normalized(standard.name) === expectedStandardName;
    return typeMatches && idMatches && nameMatches;
  });
  const standardComponents = activeStandard?.components
    ?.filter((component) => component.isRequired !== false)
    .map((component) => componentFrom(component.name))
    .filter((component): component is QualificationComponent => Boolean(component));
  const requiredComponents = scope.requiredComponents ?? (standardComponents?.length ? standardComponents : ["day", "night"]);
  const excluded = { incomplete: 0, wrongFirearm: 0, wrongStandard: 0 };
  const matchingAttempts = attempts.filter((attempt) => {
    if (!attempt.completed || !attempt.component || attempt.passed === undefined) {
      excluded.incomplete += 1;
      return false;
    }
    if (scope.firearmId && attempt.firearmId !== scope.firearmId) {
      excluded.wrongFirearm += 1;
      return false;
    }
    if (expectedFirearmType && attempt.firearmType && normalized(attempt.firearmType) !== expectedFirearmType) {
      excluded.wrongFirearm += 1;
      return false;
    }
    const explicitStandard = scope.standardId || expectedStandardName;
    if (explicitStandard) {
      const idMatches = Boolean(scope.standardId && attempt.standardId === scope.standardId);
      const nameMatches = Boolean(expectedStandardName && normalized(attempt.standardName) === expectedStandardName);
      if (!idMatches && !nameMatches) {
        excluded.wrongStandard += 1;
        return false;
      }
    } else if (activeStandard && attempt.recordOrigin === "range_workspace") {
      const idMatches = Boolean(activeStandard.id && attempt.standardId === activeStandard.id);
      const nameMatches = normalized(attempt.standardName) === normalized(activeStandard.name);
      if (!idMatches && !nameMatches) {
        excluded.wrongStandard += 1;
        return false;
      }
    }
    return true;
  });
  const latestPass = (component: QualificationComponent) => matchingAttempts.find(
    (attempt) => attempt.component === component && attempt.passed === true,
  );
  const readiness = evaluateQualificationReadiness({
    lastDayQualification: latestPass("day"),
    lastNightQualification: latestPass("night"),
    failedQualifications: matchingAttempts.filter((attempt) => attempt.passed === false),
    qualificationValidDays,
    qualificationDueSoonDays,
    requiredComponents,
    today,
  });
  const scopeKey = [expectedFirearmType || "any-firearm", scope.firearmId || "any-serial", scope.standardId || normalized(scope.standardName) || normalized(activeStandard?.name) || "any-standard"].join(":");
  return { ...readiness, attempts, matchingAttempts, excluded, scopeKey };
}
