export type TableGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

export type TableGroupingPreferences<GroupBy extends string> = {
  groupBy: GroupBy;
  collapsedGroupKeys: string[];
};

export function groupTableRows<T, GroupBy extends string>(
  rows: readonly T[],
  groupBy: GroupBy,
  getGroup: (row: T, groupBy: Exclude<GroupBy, "none">) => { key: string; label: string },
): TableGroup<T>[] {
  if (groupBy === "none") return [];

  const groups = new Map<string, TableGroup<T>>();
  for (const row of rows) {
    const group = getGroup(row, groupBy as Exclude<GroupBy, "none">);
    const key = `${groupBy}:${group.key}`;
    const existing = groups.get(key);
    if (existing) existing.items.push(row);
    else groups.set(key, { key, label: group.label, items: [row] });
  }

  return [...groups.values()];
}

export function toggleCollapsedTableGroup(
  collapsedGroupKeys: readonly string[],
  groupKey: string,
) {
  return collapsedGroupKeys.includes(groupKey)
    ? collapsedGroupKeys.filter((key) => key !== groupKey)
    : [...collapsedGroupKeys, groupKey];
}

export function normalizeTableGroupingPreferences<GroupBy extends string>(
  value: Partial<TableGroupingPreferences<GroupBy>> | null | undefined,
  allowedGroupBy: readonly GroupBy[],
  defaultGroupBy: GroupBy,
): TableGroupingPreferences<GroupBy> {
  return {
    groupBy:
      typeof value?.groupBy === "string" && allowedGroupBy.includes(value.groupBy as GroupBy)
        ? (value.groupBy as GroupBy)
        : defaultGroupBy,
    collapsedGroupKeys: Array.isArray(value?.collapsedGroupKeys)
      ? [...new Set(value.collapsedGroupKeys.filter((key): key is string => typeof key === "string"))]
      : [],
  };
}

export function getStoredTableGroupingPreferences<GroupBy extends string>(
  storageKey: string,
  allowedGroupBy: readonly GroupBy[],
  defaultGroupBy: GroupBy,
) {
  if (typeof window === "undefined") {
    return normalizeTableGroupingPreferences<GroupBy>(null, allowedGroupBy, defaultGroupBy);
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    return normalizeTableGroupingPreferences<GroupBy>(
      raw ? (JSON.parse(raw) as Partial<TableGroupingPreferences<GroupBy>>) : null,
      allowedGroupBy,
      defaultGroupBy,
    );
  } catch {
    return normalizeTableGroupingPreferences<GroupBy>(null, allowedGroupBy, defaultGroupBy);
  }
}

export function saveTableGroupingPreferences<GroupBy extends string>(
  storageKey: string,
  preferences: TableGroupingPreferences<GroupBy>,
  allowedGroupBy: readonly GroupBy[],
  defaultGroupBy: GroupBy,
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(normalizeTableGroupingPreferences(preferences, allowedGroupBy, defaultGroupBy)),
    );
  } catch {
    // Optional display preferences must never block inventory work.
  }
}
