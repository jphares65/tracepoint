import type {
  AddLibraryDrillToRangeDayInput,
  CreateDrillLibraryTemplateInput,
  DrillLibraryTemplate,
  DrillRunResult,
  DrillTemplate,
  OfficerPerformanceMetric,
  RangeDay,
  RangeDayDrill,
  RangePacket,
  RangeRosterEntry,
  RemedialTrainingRecommendation,
} from "./range-day-types";

export function getRangeDayTitle(rangeDay: RangeDay) {
  return `${rangeDay.title} - ${rangeDay.date}`;
}

export function getRosterCount(roster: RangeRosterEntry[]) {
  return roster.length;
}

export function getAttendanceCount(roster: RangeRosterEntry[]) {
  return roster.filter((entry) => entry.attended).length;
}

export function getAttendanceRate(roster: RangeRosterEntry[]) {
  if (roster.length === 0) {
    return 0;
  }

  return Math.round((getAttendanceCount(roster) / roster.length) * 100);
}

export function getDrillResultsForOfficer(
  results: DrillRunResult[],
  officerId: string,
) {
  return results.filter((result) => result.officerId === officerId);
}

export function getDrillResultsForDrill(
  results: DrillRunResult[],
  drillId: string,
) {
  return results.filter((result) => result.drillId === drillId);
}

export function getCompletedDrillRunCount(results: DrillRunResult[]) {
  return results.filter((result) => result.completed).length;
}

export function getAverageScore(results: DrillRunResult[]) {
  const scoredResults = results.filter(
    (result) => typeof result.score === "number",
  );

  if (scoredResults.length === 0) {
    return undefined;
  }

  const total = scoredResults.reduce((sum, result) => {
    return sum + (result.score ?? 0);
  }, 0);

  return Math.round(total / scoredResults.length);
}

export function getPassRate(results: DrillRunResult[]) {
  const passFailResults = results.filter(
    (result) => typeof result.passed === "boolean",
  );

  if (passFailResults.length === 0) {
    return undefined;
  }

  const passedCount = passFailResults.filter((result) => result.passed).length;

  return Math.round((passedCount / passFailResults.length) * 100);
}

export function hasDecliningScores(results: DrillRunResult[]) {
  const scoredResults = results
    .filter((result) => typeof result.score === "number")
    .sort((a, b) => a.runNumber - b.runNumber);

  if (scoredResults.length < 3) {
    return false;
  }

  const lastThree = scoredResults.slice(-3);

  return (
    (lastThree[0].score ?? 0) > (lastThree[1].score ?? 0) &&
    (lastThree[1].score ?? 0) > (lastThree[2].score ?? 0)
  );
}

export function getPerformanceTrend(results: DrillRunResult[]) {
  if (hasDecliningScores(results)) {
    return "Declining";
  }

  const scoredResults = results.filter(
    (result) => typeof result.score === "number",
  );

  if (scoredResults.length < 2) {
    return "Stable";
  }

  const firstScore = scoredResults[0].score ?? 0;
  const lastScore = scoredResults[scoredResults.length - 1].score ?? 0;

  if (lastScore > firstScore) {
    return "Improving";
  }

  if (lastScore < firstScore) {
    return "Declining";
  }

  return "Stable";
}

export function getOfficerPerformanceMetric(
  officerId: string,
  drill: RangeDayDrill,
  results: DrillRunResult[],
): OfficerPerformanceMetric {
  const officerResults = results.filter(
    (result) => result.officerId === officerId && result.drillId === drill.id,
  );

  return {
    officerId,
    category: drill.category,
    averageScore: getAverageScore(officerResults),
    passRate: getPassRate(officerResults),
    totalRuns: officerResults.length,
    trend: getPerformanceTrend(officerResults),
    lastUpdated: new Date().toISOString(),
  };
}

export function shouldRecommendRemedialTraining(results: DrillRunResult[]) {
  return results.some(
    (result) =>
      result.remedialTrainingRecommended ||
      result.deficiencyObserved ||
      result.passed === false,
  );
}

export function createRemedialTrainingRecommendation(
  officerId: string,
  rangeDayId: string,
  instructorId: string,
  reason: string,
): RemedialTrainingRecommendation {
  return {
    id: `remedial-${rangeDayId}-${officerId}-${Date.now()}`,
    officerId,
    rangeDayId,
    createdByInstructorId: instructorId,
    reason,
    assignedDate: new Date().toISOString(),
    completed: false,
  };
}

export function createRangePacket(
  rangeDay: RangeDay,
  generatedByUserId: string,
): RangePacket {
  return {
    id: `packet-${rangeDay.id}-${Date.now()}`,
    rangeDayId: rangeDay.id,
    generatedByUserId,
    generatedAt: new Date().toISOString(),
    includesRoster: true,
    includesQualificationSheets: true,
    includesDrillSheets: true,
    includesRemedialSection: true,
    includesInstructorNotes: true,
  };
}

/**
 * Creates a reusable Drill Library template.
 * This is the master drill record that Range Masters can create, edit, activate,
 * deactivate, and reuse when planning future range days.
 */
export function createDrillLibraryTemplate(
  input: CreateDrillLibraryTemplateInput,
  now = new Date().toISOString(),
): DrillLibraryTemplate {
  return {
    id: `drill-template-${Date.now()}`,
    departmentId: input.departmentId,
    name: input.name,
    category: input.category,
    description: input.description,
    instructions: input.instructions,
    firearmType: input.firearmType ?? "Any",
    roundCount: input.roundCount,
    estimatedMinutes: input.estimatedMinutes,
    difficulty: input.difficulty,
    defaultScoringMode: input.defaultScoringMode,
    defaultPassingScore: input.defaultPassingScore,
    defaultMaxScore: input.defaultMaxScore,
    defaultRunCount: input.defaultRunCount,
    defaultRequired: input.defaultRequired,
    tags: input.tags ?? [],
    status: "Active",
    createdByUserId: input.createdByUserId,
    createdAt: now,
    notes: input.notes,
  };
}

export function updateDrillLibraryTemplate(
  template: DrillLibraryTemplate,
  updates: Partial<CreateDrillLibraryTemplateInput>,
  now = new Date().toISOString(),
): DrillLibraryTemplate {
  return {
    ...template,
    name: updates.name ?? template.name,
    category: updates.category ?? template.category,
    description: updates.description ?? template.description,
    instructions: updates.instructions ?? template.instructions,
    firearmType: updates.firearmType ?? template.firearmType,
    roundCount: updates.roundCount ?? template.roundCount,
    estimatedMinutes: updates.estimatedMinutes ?? template.estimatedMinutes,
    difficulty: updates.difficulty ?? template.difficulty,
    defaultScoringMode:
      updates.defaultScoringMode ?? template.defaultScoringMode,
    defaultPassingScore:
      updates.defaultPassingScore ?? template.defaultPassingScore,
    defaultMaxScore: updates.defaultMaxScore ?? template.defaultMaxScore,
    defaultRunCount: updates.defaultRunCount ?? template.defaultRunCount,
    defaultRequired: updates.defaultRequired ?? template.defaultRequired,
    tags: updates.tags ?? template.tags,
    notes: updates.notes ?? template.notes,
    updatedAt: now,
  };
}

export function archiveDrillLibraryTemplate(
  template: DrillLibraryTemplate,
  now = new Date().toISOString(),
): DrillLibraryTemplate {
  return {
    ...template,
    status: "Archived",
    updatedAt: now,
  };
}

export function deactivateDrillLibraryTemplate(
  template: DrillLibraryTemplate,
  now = new Date().toISOString(),
): DrillLibraryTemplate {
  return {
    ...template,
    status: "Inactive",
    updatedAt: now,
  };
}

export function activateDrillLibraryTemplate(
  template: DrillLibraryTemplate,
  now = new Date().toISOString(),
): DrillLibraryTemplate {
  return {
    ...template,
    status: "Active",
    updatedAt: now,
  };
}

export function getActiveDrillLibraryTemplates(
  templates: DrillLibraryTemplate[],
) {
  return templates.filter((template) => template.status === "Active");
}

export function getDrillTemplatesByCategory(
  templates: DrillLibraryTemplate[],
  category: DrillLibraryTemplate["category"],
) {
  return templates.filter((template) => template.category === category);
}

export function searchDrillLibraryTemplates(
  templates: DrillLibraryTemplate[],
  searchTerm: string,
) {
  const query = searchTerm.trim().toLowerCase();

  if (!query) {
    return templates;
  }

  return templates.filter((template) => {
    const searchableText = [
      template.name,
      template.category,
      template.description,
      template.instructions,
      template.firearmType,
      template.difficulty,
      template.tags?.join(" "),
      template.notes,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchableText.includes(query);
  });
}

/**
 * Copies a reusable library drill into a specific range day.
 *
 * Important:
 * This returns a RangeDayDrill snapshot, not a live reference.
 * If the library template is changed later, historical range-day drills remain unchanged.
 */
export function addLibraryDrillToRangeDay(
  input: AddLibraryDrillToRangeDayInput,
  templates: DrillLibraryTemplate[],
  now = new Date().toISOString(),
): RangeDayDrill | null {
  const template = templates.find((item) => item.id === input.templateId);

  if (!template || template.status !== "Active") {
    return null;
  }

  return {
    id: `range-drill-${input.rangeDayId}-${template.id}-${Date.now()}`,
    rangeDayId: input.rangeDayId,
    name: input.overrideName ?? template.name,
    category: template.category,
    description: template.description,
    instructions: template.instructions,
    scoringMode: input.overrideScoringMode ?? template.defaultScoringMode,
    passingScore: input.overridePassingScore ?? template.defaultPassingScore,
    maxScore: input.overrideMaxScore ?? template.defaultMaxScore,
    runCount: input.overrideRunCount ?? template.defaultRunCount,
    required: input.overrideRequired ?? template.defaultRequired,
    firearmType: template.firearmType,
    roundCount: template.roundCount,
    estimatedMinutes: template.estimatedMinutes,
    difficulty: template.difficulty,
    sourceTemplateId: template.id,
    sourceTemplateName: template.name,
    copiedFromLibraryAt: now,
    notes: input.overrideNotes ?? template.notes,
  };
}

/**
 * Backward-compatible helper.
 * Existing code already calls createDrillFromTemplate(template, rangeDayId).
 * Internally, it now creates a range-day snapshot from a library template.
 */
export function createDrillFromTemplate(
  template: DrillTemplate,
  rangeDayId: string,
  now = new Date().toISOString(),
): RangeDayDrill {
  return {
    id: `range-drill-${rangeDayId}-${template.id}-${Date.now()}`,
    rangeDayId,
    name: template.name,
    category: template.category,
    description: template.description,
    instructions: template.instructions,
    scoringMode: template.defaultScoringMode,
    passingScore: template.defaultPassingScore,
    maxScore: template.defaultMaxScore,
    runCount: template.defaultRunCount,
    required: template.defaultRequired,
    firearmType: template.firearmType,
    roundCount: template.roundCount,
    estimatedMinutes: template.estimatedMinutes,
    difficulty: template.difficulty,
    sourceTemplateId: template.id,
    sourceTemplateName: template.name,
    copiedFromLibraryAt: now,
    notes: template.notes,
  };
}

export function getRequiredDrills(drills: RangeDayDrill[]) {
  return drills.filter((drill) => drill.required);
}

export function getOptionalDrills(drills: RangeDayDrill[]) {
  return drills.filter((drill) => !drill.required);
}

export function getRangeDayCompletionSummary(
  roster: RangeRosterEntry[],
  drills: RangeDayDrill[],
  results: DrillRunResult[],
) {
  const expectedRuns =
    roster.length *
    drills.reduce((sum, drill) => {
      return sum + drill.runCount;
    }, 0);

  const completedRuns = getCompletedDrillRunCount(results);

  return {
    rosterCount: getRosterCount(roster),
    attendanceCount: getAttendanceCount(roster),
    attendanceRate: getAttendanceRate(roster),
    expectedRuns,
    completedRuns,
    remainingRuns: Math.max(expectedRuns - completedRuns, 0),
    completionRate:
      expectedRuns === 0
        ? 0
        : Math.round((completedRuns / expectedRuns) * 100),
  };
}

export function getMalfunctionCountForRangeDay(results: DrillRunResult[]) {
  return results.reduce((count, result) => {
    return count + (result.malfunctionIds?.length ?? 0);
  }, 0);
}

export {};