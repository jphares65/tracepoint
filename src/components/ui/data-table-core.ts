/** Pure helpers behind DataTable, kept separate so they can be unit tested. */

export type SortDirection = "asc" | "desc";
export type SortState = { key: string; direction: SortDirection } | null;
export type SortValue = string | number | Date | null | undefined;

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Compares two sort values. Empty values always sort last, whatever the direction. */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection = "asc") {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;

  let result: number;
  if (a instanceof Date || b instanceof Date) {
    result = new Date(a as Date).getTime() - new Date(b as Date).getTime();
  } else if (typeof a === "number" && typeof b === "number") {
    result = a - b;
  } else {
    result = collator.compare(String(a), String(b));
  }
  return direction === "asc" ? result : -result;
}

/** Stable sort of rows by the accessor for `sort.key`. Returns the input order when unsorted. */
export function sortRows<Row>(
  rows: readonly Row[],
  sort: SortState,
  accessor: (row: Row, key: string) => SortValue,
): Row[] {
  if (!sort) return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => compareSortValues(accessor(x.row, sort.key), accessor(y.row, sort.key), sort.direction) || x.index - y.index)
    .map(({ row }) => row);
}

/** Header click cycle: ascending, then descending, then back to unsorted. */
export function nextSort(current: SortState, key: string): SortState {
  if (!current || current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return null;
}

export function ariaSort(current: SortState, key: string): "ascending" | "descending" | "none" {
  if (!current || current.key !== key) return "none";
  return current.direction === "asc" ? "ascending" : "descending";
}
