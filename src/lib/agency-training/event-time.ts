// Agency-training event times are entered and shown as wall-clock times in the
// department's time zone (departments.timezone), independent of the browser and
// server zones. Stored values stay timestamptz instants.
export const DEFAULT_DEPARTMENT_TIME_ZONE = "America/New_York";

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const OFFSET_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function resolveTimeZone(value: unknown) {
  const zone = typeof value === "string" ? value.trim() : "";
  if (!zone) return DEFAULT_DEPARTMENT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_DEPARTMENT_TIME_ZONE;
  }
}

function wallClock(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

function offsetAt(instant: number, timeZone: string) {
  const clock = wallClock(instant, timeZone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// "YYYY-MM-DDTHH:mm" in timeZone -> ISO instant. A time skipped by a DST change
// resolves to the later offset; a repeated time resolves to its first occurrence.
export function zonedLocalToIso(local: string, timeZone: string) {
  const match = LOCAL_PATTERN.exec(local.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((item) => Number(item ?? 0));
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const zone = resolveTimeZone(timeZone);
  const first = guess - offsetAt(guess, zone);
  const retry = guess - offsetAt(first, zone);
  const candidates = [first, retry].filter((instant) => {
    const clock = wallClock(instant, zone);
    return clock.year === year && clock.month === month && clock.day === day && clock.hour === hour && clock.minute === minute;
  });
  const instant = candidates.length ? Math.min(...candidates) : Math.max(first, retry);
  return new Date(instant).toISOString();
}

// ISO instant -> "YYYY-MM-DDTHH:mm" wall time in timeZone (datetime-local value).
export function isoToZonedLocal(value: string | Date | null | undefined, timeZone: string) {
  if (!value) return "";
  const instant = new Date(value).getTime();
  if (Number.isNaN(instant)) return "";
  const clock = wallClock(instant, resolveTimeZone(timeZone));
  const pad = (number: number, size = 2) => String(number).padStart(size, "0");
  return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)}T${pad(clock.hour)}:${pad(clock.minute)}`;
}

// Server parse of an event time: an offset-less value is department wall time;
// a value that carries Z or an offset is an absolute instant (unchanged contract).
export function parseEventDateTime(value: unknown, timeZone: string) {
  const valueText = typeof value === "string" ? value.trim() : "";
  if (!valueText) return null;
  if (LOCAL_PATTERN.test(valueText)) return zonedLocalToIso(valueText, timeZone);
  if (!OFFSET_PATTERN.test(valueText)) return null;
  const parsed = new Date(valueText);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type DepartmentLookup = { from(table: "departments"): { select(fields: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: { timezone?: unknown } | null; error: { message: string } | null }> } } } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- route clients are untyped
export async function loadDepartmentTimeZone(admin: any, departmentId: string) {
  const result = await (admin as DepartmentLookup).from("departments").select("timezone").eq("id", departmentId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return resolveTimeZone(result.data?.timezone);
}
