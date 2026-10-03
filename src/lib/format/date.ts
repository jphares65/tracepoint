export type DisplayDateValue = string | number | Date | null | undefined;

const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/;

function parse(value: DisplayDateValue, preserveCalendarDate: boolean) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && preserveCalendarDate) {
    const match = value.match(dateOnly);
    if (match) return new Date(`${match[1]}T00:00:00`);
  }
  return new Date(value as string | number);
}

export function formatDate(value: DisplayDateValue, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = parse(value, true);
  return Number.isNaN(parsed.getTime()) ? fallback : new Intl.DateTimeFormat("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric",
  }).format(parsed);
}

export function formatDateTime(value: DisplayDateValue, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = parse(value, false);
  return Number.isNaN(parsed.getTime()) ? fallback : new Intl.DateTimeFormat("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(parsed).replace(",", "");
}
