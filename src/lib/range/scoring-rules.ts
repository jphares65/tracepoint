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
