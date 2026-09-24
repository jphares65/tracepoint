export function notificationDateValue(value?: string | Date | null): number {
  if (!value) return 0;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
  if (typeof value !== "string") return 0;
  const parsed = value.includes("T")
    ? new Date(value).getTime()
    : new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}
