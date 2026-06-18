import type {
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
  officerId: string
) {
  return results.filter((result) => result.officerId === officerId);
}

export function getDrillResultsForDrill(
  results: DrillRunResult[],
  drillId: string
) {
  return results.filter((result) => result.drillId === drillId);
}

export function getCompletedDrillRunCount(results: DrillRunResult[]) {
  return results.filter((result) => result.completed).length;
}

export function getAverageScore(results: DrillRunResult[]) {
  const scoredResults = results.filter(
    (result) => typeof result.score === "number"
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
    (result) => typeof result.passed === "boolean"
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
    (lastThree[0].score ?? 0) >
      (lastThree[1].score ?? 0) &&
    (lastThree[1].score ?? 0) >
      (lastThree[2].score ?? 0)
  );
}

export function getPerformanceTrend(results: DrillRunResult[]) {
  if (hasDecliningScores(results)) {
    return "Declining";
  }

  const scoredResults = results.filter(
    (result) => typeof result.score === "number"
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
  results: DrillRunResult[]
): OfficerPerformanceMetric {
  const officerResults = results.filter(
    (result) =>
      result.officerId === officerId &&
      result.drillId === drill.id
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
      result.passed === false
  );
}

export function createRemedialTrainingRecommendation(
  officerId: string,
  rangeDayId: string,
  instructorId: string,
  reason: string
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
  generatedByUserId: string
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

export function createDrillFromTemplate(
  template: DrillTemplate,
  rangeDayId: string
): RangeDayDrill {
  return {
    id: `drill-${rangeDayId}-${template.id}-${Date.now()}`,
    rangeDayId,
    name: template.name,
    category: template.category,
    description: template.description,
    scoringMode: template.defaultScoringMode,
    passingScore: template.defaultPassingScore,
    maxScore: template.defaultMaxScore,
    runCount: template.defaultRunCount,
    required: true,
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
  results: DrillRunResult[]
) {
  const expectedRuns = roster.length * drills.reduce((sum, drill) => {
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