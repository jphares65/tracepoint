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

export function getOpenAttendanceScoringState({
  attendanceMode,
  attendingCount,
}: {
  attendanceMode: unknown;
  attendingCount: number;
}) {
  if (
    normalizeRangeDayAttendanceMode(attendanceMode) !==
    OPEN_ROLLING_ATTENDANCE
  ) {
    return "scheduled" as const;
  }

  return attendingCount > 0 ? "active" as const : "empty" as const;
}

export function createOpenAttendanceRosterEntry({
  id,
  rangeDayId,
  officerId,
  attendanceTime,
  firearmId,
}: {
  id: string;
  rangeDayId: string;
  officerId: string;
  attendanceTime: string;
  firearmId?: string;
}): RangeRosterEntry {
  return {
    id,
    rangeDayId,
    officerId,
    assignedFirearmIds: firearmId ? [firearmId] : [],
    attended: true,
    attendanceTime,
    notes: "Added during open attendance.",
  };
}
