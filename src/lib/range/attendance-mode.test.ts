import assert from "node:assert/strict";
import test from "node:test";

import {
  canAddOpenAttendanceShooter,
  createOpenAttendanceRosterEntry,
  getOpenAttendanceScoringState,
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

test("open attendance exposes an empty current-shooters state only until someone arrives", () => {
  assert.equal(
    getOpenAttendanceScoringState({
      attendanceMode: OPEN_ROLLING_ATTENDANCE,
      attendingCount: 0,
    }),
    "empty",
  );
  assert.equal(
    getOpenAttendanceScoringState({
      attendanceMode: OPEN_ROLLING_ATTENDANCE,
      attendingCount: 1,
    }),
    "active",
  );
  assert.equal(
    getOpenAttendanceScoringState({
      attendanceMode: SCHEDULED_ROSTER_ATTENDANCE,
      attendingCount: 0,
    }),
    "scheduled",
  );
});

test("adding an open-attendance shooter records arrival and an optional scoring firearm", () => {
  assert.deepEqual(
    createOpenAttendanceRosterEntry({
      id: "roster-1",
      rangeDayId: "day-1",
      officerId: "officer-1",
      attendanceTime: "2026-09-17T12:00:00.000Z",
      firearmId: "firearm-1",
    }),
    {
      id: "roster-1",
      rangeDayId: "day-1",
      officerId: "officer-1",
      assignedFirearmIds: ["firearm-1"],
      attended: true,
      attendanceTime: "2026-09-17T12:00:00.000Z",
      notes: "Added during open attendance.",
    },
  );
});
