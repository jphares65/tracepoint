/**
 * Normalizes a DATE column value to a calendar date (yyyy-mm-dd), or null.
 *
 * The two runtimes return DATE columns differently:
 * - Supabase/PostgREST returns the text "2026-09-14";
 * - node-postgres (the AWS-native runtime) returns a Date built at local
 *   midnight of that day, which serializes as "2026-09-14T00:00:00.000Z" on a
 *   UTC host.
 *
 * A Date is read with its local getters because that is how node-postgres built
 * it, so the calendar day never moves whatever the host time zone. A string
 * keeps its leading yyyy-mm-dd as written; a timestamp's time and offset are
 * ignored rather than converted, so a date-only value is never shifted a day.
 */
export function calendarDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return valid(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  return match ? valid(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function valid(year: number, month: number, day: number) {
  const check = new Date(Date.UTC(year, month - 1, day));
  if (year < 1000 || year > 9999 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
