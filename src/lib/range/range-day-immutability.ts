export type RangeDayStateRecord = {
  status?: unknown;
  packetStatus?: unknown;
  packet_status?: unknown;
};

const IMMUTABLE_STATUSES = new Set(["completed", "locked", "archived"]);

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * Range Day history is immutable after it has been closed. A packet marked
 * Ready is not final (RNG-03; database/aws/052): corrections stay possible
 * until the day is Completed, Locked or Archived.
 */
export function isImmutableRangeDay(rangeDay: RangeDayStateRecord) {
  return IMMUTABLE_STATUSES.has(normalizedText(rangeDay.status));
}

/**
 * UI defaults are useful for an editable Range Day, but must never be written
 * into a historical record as a side effect of hydrating the workspace.
 */
export function hydrateEditableRangeDay<T extends RangeDayStateRecord>(
  rangeDay: T,
  hydrate: (editableRangeDay: T) => T,
) {
  return isImmutableRangeDay(rangeDay) ? rangeDay : hydrate(rangeDay);
}
