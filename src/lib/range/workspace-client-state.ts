type Keyed = { id?: unknown };

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).filter((key) => source[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stable(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Load-time normalization fills display defaults (attendance mode, outline,
 * run counts...). Records the user has not changed since load are sent back as
 * the server stored them, so the normalization alone never reads as an edit of a
 * finalized day or as a planning change by a scorer.
 */
export function withStoredCopiesOfUnchangedRecords<T extends Keyed>(
  current: T[],
  normalizedAtLoad: readonly T[],
  storedAtLoad: readonly unknown[],
): T[] {
  const baseline = new Map<string, { normalized: string; stored: unknown }>();
  normalizedAtLoad.forEach((item, index) => {
    if (typeof item.id === "string" && item.id) {
      baseline.set(item.id, { normalized: stable(item), stored: storedAtLoad[index] });
    }
  });
  return current.map((item) => {
    const loaded = typeof item.id === "string" ? baseline.get(item.id) : undefined;
    return loaded && loaded.normalized === stable(item) ? loaded.stored as T : item;
  });
}

/** Keeps rows the user typed into but has not saved when the rows are rebuilt. */
export function preserveUnsavedBatchRows<T>(
  rebuilt: Record<string, T>,
  current: Record<string, T>,
  unsavedOfficerIds: ReadonlySet<string>,
): Record<string, T> {
  const next = { ...rebuilt };
  Object.keys(rebuilt).forEach((officerId) => {
    if (unsavedOfficerIds.has(officerId) && current[officerId]) next[officerId] = current[officerId];
  });
  return next;
}
