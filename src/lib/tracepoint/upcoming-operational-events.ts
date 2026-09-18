export type UpcomingOperationalEvent = {
  id: string;
  title: string;
  date: string;
  source: "Agency Training" | "Certifications" | "Fleet" | "Range & Training";
  type: string;
  detail: string;
  href: string;
};

export type UpcomingOperationalEventSource = {
  enabled: boolean;
  available: boolean;
  events: UpcomingOperationalEvent[];
};

function dateValue(value: string) {
  const parsed = new Date(
    value.includes("T") ? value : `${value}T00:00:00`,
  ).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function buildUpcomingOperationalEvents(
  sources: UpcomingOperationalEventSource[],
  limit: number,
  now = Date.now(),
) {
  const current = new Date(now);
  const today = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate(),
  ).getTime();

  return sources
    .filter((source) => source.enabled && source.available)
    .flatMap((source) => source.events)
    .map((event) => ({ event, timestamp: dateValue(event.date) }))
    .filter(
      (candidate): candidate is {
        event: UpcomingOperationalEvent;
        timestamp: number;
      } => candidate.timestamp !== null && candidate.timestamp >= today,
    )
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.event.source.localeCompare(right.event.source) ||
        left.event.title.localeCompare(right.event.title) ||
        left.event.id.localeCompare(right.event.id),
    )
    .slice(0, Math.max(1, Math.round(limit)))
    .map(({ event }) => event);
}
