import assert from "node:assert/strict";
import test from "node:test";

import {
  canAddOpenAttendanceShooter,
  normalizeRangeDayAttendanceMode,
  OPEN_ROLLING_ATTENDANCE,
  SCHEDULED_ROSTER_ATTENDANCE,
} from "./attendance-mode.ts";
import { getRangeDayCompletionSummary } from "@/app/lib/tracepoint/range-day-utils";

test("existing Range Days retain scheduled-roster attendance by default", () => {
  assert.equal(
    normalizeRangeDayAttendanceMode(undefined),
    SCHEDULED_ROSTER_ATTENDANCE,
  );
  assert.equal(
    canAddOpenAttendanceShooter({
      attendanceMode: undefined,
      roster: [],
      rangeDayId: "day-1",
      officerId: "officer-1",
    }),
    false,
  );
});

test("open attendance allows a new shooter once, without affecting another session", () => {
  const roster = [
    { rangeDayId: "day-1", officerId: "officer-1" },
    { rangeDayId: "day-2", officerId: "officer-2" },
  ];

  assert.equal(
    canAddOpenAttendanceShooter({
      attendanceMode: OPEN_ROLLING_ATTENDANCE,
      roster,
      rangeDayId: "day-1",
      officerId: "officer-2",
    }),
    true,
  );
  assert.equal(
    canAddOpenAttendanceShooter({
      attendanceMode: OPEN_ROLLING_ATTENDANCE,
      roster,
      rangeDayId: "day-1",
      officerId: "officer-1",
    }),
    false,
  );
});

test("an open-attendance shooter participates in existing completion scoring", () => {
  const summary = getRangeDayCompletionSummary(
    [
      {
        id: "roster-1",
        rangeDayId: "day-1",
        officerId: "officer-1",
        assignedFirearmIds: [],
        attended: true,
      },
    ],
    [
      {
        id: "drill-1",
        rangeDayId: "day-1",
        name: "Qualification",
        category: "Qualification",
        scoringMode: "Scored",
        runCount: 1,
        required: true,
      },
    ],
    [
      {
        id: "result-1",
        rangeDayId: "day-1",
        drillId: "drill-1",
        officerId: "officer-1",
        runNumber: 1,
        completed: true,
        instructorId: "instructor-1",
      },
    ],
  );

  assert.deepEqual(summary, {
    rosterCount: 1,
    attendanceCount: 1,
    attendanceRate: 100,
    expectedRuns: 1,
    completedRuns: 1,
    remainingRuns: 0,
    completionRate: 100,
  });
});
