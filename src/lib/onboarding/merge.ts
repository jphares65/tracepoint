export type MergeConflict = {
  field: string;
  existingValue: unknown;
  incomingValue: unknown;
};

export type EnrichOnlyMergeResult<T extends Record<string, unknown>> = {
  updates: Partial<T>;
  conflicts: MergeConflict[];
  changedFields: string[];
};

function normalizeComparable(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

export function isMissingOnboardingValue(value: unknown) {
  const normalized = normalizeComparable(value);

  return (
    normalized === "" ||
    normalized === "tbd" ||
    normalized === "unknown" ||
    normalized === "tbd / unknown" ||
    normalized === "tbd/unknown"
  );
}

export function buildEnrichOnlyUpdates<T extends Record<string, unknown>>(
  existing: T,
  incoming: Partial<T>,
  protectedFields: string[] = [],
): EnrichOnlyMergeResult<T> {
  const updates: Partial<T> = {};
  const conflicts: MergeConflict[] = [];
  const changedFields: string[] = [];

  for (const [field, incomingValue] of Object.entries(incoming)) {
    if (protectedFields.includes(field)) continue;
    if (isMissingOnboardingValue(incomingValue)) continue;

    const existingValue = existing[field];

    if (isMissingOnboardingValue(existingValue)) {
      updates[field as keyof T] = incomingValue as T[keyof T];
      changedFields.push(field);
      continue;
    }

    if (
      normalizeComparable(existingValue) !==
      normalizeComparable(incomingValue)
    ) {
      conflicts.push({
        field,
        existingValue,
        incomingValue,
      });
    }
  }

  return {
    updates,
    conflicts,
    changedFields,
  };
}