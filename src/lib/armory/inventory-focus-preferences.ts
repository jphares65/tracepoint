import type { FirearmSortKey } from "./inventory-view";
import {
  normalizeTableGroupingPreferences,
  type TableGroupingPreferences,
} from "@/lib/tables/grouping";

export const FOCUS_INVENTORY_COLUMNS: FirearmSortKey[] = [
  "firearm",
  "serial",
  "asset",
  "type",
  "status",
  "custody",
];

export const FIREARM_INVENTORY_GROUP_BY = [
  "none",
  "type",
  "status",
  "assignment",
] as const;

export type FirearmInventoryGroupBy = (typeof FIREARM_INVENTORY_GROUP_BY)[number];

export type FocusInventoryPreferences = TableGroupingPreferences<FirearmInventoryGroupBy> & {
  columnOrder: FirearmSortKey[];
  hiddenColumns: FirearmSortKey[];
};

export const DEFAULT_FOCUS_INVENTORY_PREFERENCES: FocusInventoryPreferences = {
  columnOrder: FOCUS_INVENTORY_COLUMNS,
  hiddenColumns: [],
  groupBy: "none",
  collapsedGroupKeys: [],
};

function isFocusColumn(value: unknown): value is FirearmSortKey {
  return typeof value === "string" && FOCUS_INVENTORY_COLUMNS.includes(value as FirearmSortKey);
}

export function normalizeFocusInventoryPreferences(
  value: Partial<FocusInventoryPreferences> | null | undefined,
): FocusInventoryPreferences {
  const savedOrder = Array.isArray(value?.columnOrder)
    ? value.columnOrder.filter(isFocusColumn)
    : [];
  const columnOrder = [
    ...new Set(savedOrder),
    ...FOCUS_INVENTORY_COLUMNS.filter((column) => !savedOrder.includes(column)),
  ];
  const hiddenColumns = Array.isArray(value?.hiddenColumns)
    ? [...new Set(value.hiddenColumns.filter(isFocusColumn))]
    : [];

  const grouping = normalizeTableGroupingPreferences(
    value,
    FIREARM_INVENTORY_GROUP_BY,
    "none",
  );

  return { columnOrder, hiddenColumns, ...grouping };
}

export function moveFocusInventoryColumn(
  columns: FirearmSortKey[],
  source: FirearmSortKey,
  destination: FirearmSortKey,
) {
  if (source === destination) return columns;
  const next = columns.filter((column) => column !== source);
  const destinationIndex = next.indexOf(destination);
  if (destinationIndex === -1) return columns;
  next.splice(destinationIndex, 0, source);
  return next;
}

export function shouldSortFocusColumnHeader(dragCompleted: boolean) {
  return !dragCompleted;
}

export function getFocusInventoryPreferenceKey(departmentId: string) {
  return `tracepoint:armory:focus-columns:v1:${departmentId}`;
}

export function getStoredFocusInventoryPreferences(departmentId: string) {
  if (typeof window === "undefined" || !departmentId) {
    return DEFAULT_FOCUS_INVENTORY_PREFERENCES;
  }

  try {
    const raw = window.localStorage.getItem(
      getFocusInventoryPreferenceKey(departmentId),
    );
    return normalizeFocusInventoryPreferences(
      raw ? (JSON.parse(raw) as FocusInventoryPreferences) : null,
    );
  } catch {
    return DEFAULT_FOCUS_INVENTORY_PREFERENCES;
  }
}

export function saveFocusInventoryPreferences(
  departmentId: string,
  preferences: FocusInventoryPreferences,
) {
  if (typeof window === "undefined" || !departmentId) return;

  try {
    window.localStorage.setItem(
      getFocusInventoryPreferenceKey(departmentId),
      JSON.stringify(normalizeFocusInventoryPreferences(preferences)),
    );
  } catch {
    // Preference persistence is optional and must never block inventory work.
  }
}
