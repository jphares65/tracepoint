import type { RangeRosterEntry } from "@/app/lib/tracepoint/range-day-types";

export const RANGE_DAY_ATTENDANCE_MODES = [
  "Scheduled Roster",
  "Open / Rolling Attendance",
] as const;

export type RangeDayAttendanceMode =
  (typeof RANGE_DAY_ATTENDANCE_MODES)[number];

export const SCHEDULED_ROSTER_ATTENDANCE: RangeDayAttendanceMode =
  "Scheduled Roster";
export const OPEN_ROLLING_ATTENDANCE: RangeDayAttendanceMode =
  "Open / Rolling Attendance";

/** Existing days without a stored mode retain their scheduled-roster behavior. */
export function normalizeRangeDayAttendanceMode(
  value: unknown,
): RangeDayAttendanceMode {
  return value === OPEN_ROLLING_ATTENDANCE
    ? OPEN_ROLLING_ATTENDANCE
    : SCHEDULED_ROSTER_ATTENDANCE;
}

export function canAddOpenAttendanceShooter({
  attendanceMode,
  roster,
  rangeDayId,
  officerId,
}: {
  attendanceMode: unknown;
  roster: Pick<RangeRosterEntry, "rangeDayId" | "officerId">[];
  rangeDayId: string;
  officerId: string;
}) {
  return (
    normalizeRangeDayAttendanceMode(attendanceMode) ===
      OPEN_ROLLING_ATTENDANCE &&
    Boolean(officerId) &&
    !roster.some(
      (entry) =>
        entry.rangeDayId === rangeDayId && entry.officerId === officerId,
    )
  );
}
