/**
 * RNG-15: the Complete / Incomplete toggle applies to every scoring format
 * (Completion runs default to incomplete, all others to complete), and an
 * incomplete run never passes.
 */
export function resolveRunCompletion({
  scoringFormat,
  completed,
  passed,
}: {
  scoringFormat: string;
  completed?: boolean;
  passed?: boolean;
}) {
  const isComplete = completed ?? scoringFormat !== "Completion";
  return { completed: isComplete, passed: isComplete ? passed : false };
}

/**
 * RNG-09: a drill for "Any" firearm is scored against the agency standard for
 * the class of the firearm actually used; other drills keep their own class.
 */
export function standardFirearmType(drillFirearmType?: string | null, usedFirearmType?: string | null) {
  const drillType = String(drillFirearmType ?? "").trim().toLowerCase();
  return drillType === "any" ? String(usedFirearmType ?? "").trim().toLowerCase() : drillType;
}

/**
 * UX-RB-1: what the Complete / Incomplete control shows for a row. Completion
 * drills have no default ("not_recorded") and need an explicit choice; every
 * other format shows the same default `resolveRunCompletion` saves (complete).
 */
export type CompletionChoice = "not_recorded" | "complete" | "incomplete";

export function displayedCompletion(scoringFormat: string, completed?: boolean): CompletionChoice {
  if (typeof completed === "boolean") return completed ? "complete" : "incomplete";
  return scoringFormat === "Completion" ? "not_recorded" : "complete";
}

/** A Completion row cannot be saved until the instructor chooses Complete or Incomplete. */
export function completionChoiceRequired(scoringFormat: string, completed?: boolean) {
  return scoringFormat === "Completion" && typeof completed !== "boolean";
}

/**
 * UX-RB-1: the outcome flags written with a run. A failure or remediation
 * recommendation only comes from a recorded result: a Notes Only drill never
 * passes or fails, and an incomplete run is a standard failure only when the
 * drill actually has a standard.
 */
export function resolveRunOutcome({
  scoringFormat,
  completed,
  finalPassed,
  hasStandard,
  standardPassedWhenComplete,
  remediationRequired,
}: {
  scoringFormat: string;
  completed: boolean;
  finalPassed?: boolean;
  hasStandard: boolean;
  standardPassedWhenComplete?: boolean;
  remediationRequired?: boolean;
}) {
  const passed = scoringFormat === "Notes Only" ? undefined : finalPassed;
  const departmentStandardPassed = completed
    ? standardPassedWhenComplete
    : hasStandard && scoringFormat !== "Notes Only"
      ? false
      : undefined;
  return {
    passed,
    departmentStandardPassed,
    deficiencyObserved: passed === false || departmentStandardPassed === false,
    remedialTrainingRecommended:
      passed === false || (departmentStandardPassed === false && remediationRequired === true),
  };
}

/** UX-RB-6: the result field a typed measurement is stored in, by scoring format. */
export function measurementField(scoringFormat: string): "score" | "timeSeconds" | "hitCount" | null {
  if (scoringFormat === "Qualification" || scoringFormat === "Points") return "score";
  if (scoringFormat === "Time") return "timeSeconds";
  if (scoringFormat === "Hit Count") return "hitCount";
  return null;
}
