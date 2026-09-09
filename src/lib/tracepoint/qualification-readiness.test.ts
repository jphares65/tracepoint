import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCanonicalQualificationReadiness,
  evaluateQualificationReadiness,
  requiredHandgunQualificationComponents,
} from "./qualification-readiness.ts";

const today = new Date("2026-09-05T12:00:00-04:00");
const standards = [{
  id: "handgun-standard",
  name: "Handgun Qualifications",
  firearmType: "Handgun",
  components: [
    { name: "Day Course", isRequired: true },
    { name: "Night Course", isRequired: true },
  ],
}];

function workspaceAttempt({
  id,
  officerId = "officer-a",
  date = "2026-08-25",
  runNumber,
  firearmId = "handgun-a",
  firearmType = "Handgun",
  standardName,
  completed = true,
  passed = true,
}: {
  id: string;
  officerId?: string;
  date?: string;
  runNumber: number;
  firearmId?: string;
  firearmType?: string;
  standardName?: string;
  completed?: boolean;
  passed?: boolean;
}) {
  const drillId = `drill-${id}`;
  const rangeDayId = `range-${id}`;
  const component = runNumber === 2 ? "Night Course" : "Day Course";
  return {
    rangeDay: { id: rangeDayId, date },
    drill: {
      id: drillId,
      name: `${firearmType} Qualification`,
      category: "Qualification",
      firearmType,
    },
    result: {
      id,
      officerId,
      rangeDayId,
      drillId,
      runNumber,
      firearmId,
      completed,
      passed,
      finalPassed: passed,
      departmentStandardPassed: passed,
      scoringFormatSnapshot: "Qualification",
      departmentStandardSnapshot: {
        departmentStandardName:
          standardName ?? `Handgun Qualifications - ${component}`,
      },
    },
  };
}

function workspace(...entries: ReturnType<typeof workspaceAttempt>[]) {
  return {
    rangeDays: entries.map((entry) => entry.rangeDay),
    rangeDayDrills: entries.map((entry) => entry.drill),
    results: entries.map((entry) => entry.result),
  };
}

function readiness(
  entries: ReturnType<typeof workspaceAttempt>[],
  qualificationResults: unknown[] = [],
  scope = {},
) {
  return evaluateCanonicalQualificationReadiness({
    workspace: workspace(...entries),
    qualificationResults,
    qualificationStandards: standards,
    officerId: "officer-a",
    scope,
    qualificationValidDays: 365,
    qualificationDueSoonDays: 30,
    today,
  });
}

test("the production-shaped current day/night workspace pair is canonical current", () => {
  const result = readiness([
    workspaceAttempt({ id: "day", runNumber: 1 }),
    workspaceAttempt({ id: "night", runNumber: 2 }),
  ]);
  assert.equal(result.status, "Current");
  assert.equal(result.matchingAttempts.length, 2);
});

test("expired, failed, and incomplete component records remain actionable", () => {
  assert.equal(readiness([
    workspaceAttempt({ id: "old-day", runNumber: 1, date: "2025-08-01" }),
    workspaceAttempt({ id: "old-night", runNumber: 2, date: "2025-08-01" }),
  ]).status, "Overdue");

  assert.equal(readiness([
    workspaceAttempt({ id: "pass-day", runNumber: 1, date: "2026-08-01" }),
    workspaceAttempt({ id: "pass-night", runNumber: 2, date: "2026-08-01" }),
    workspaceAttempt({ id: "fail-day", runNumber: 1, date: "2026-09-01", passed: false }),
  ]).status, "Failed");

  const incomplete = readiness([
    workspaceAttempt({ id: "day", runNumber: 1 }),
    workspaceAttempt({ id: "night", runNumber: 2, completed: false }),
  ]);
  assert.equal(incomplete.status, "Missing Night");
  assert.equal(incomplete.excluded.incomplete, 1);
});

test("wrong-standard and wrong-firearm evidence cannot satisfy readiness", () => {
  const wrongStandard = readiness([
    workspaceAttempt({ id: "day", runNumber: 1, standardName: "Retired Standard - Day Course" }),
    workspaceAttempt({ id: "night", runNumber: 2, standardName: "Retired Standard - Night Course" }),
  ]);
  assert.equal(wrongStandard.status, "No Record");
  assert.equal(wrongStandard.excluded.wrongStandard, 2);

  const wrongFirearm = readiness([
    workspaceAttempt({ id: "day", runNumber: 1, firearmType: "Rifle" }),
    workspaceAttempt({ id: "night", runNumber: 2, firearmType: "Rifle" }),
  ]);
  assert.equal(wrongFirearm.status, "No Record");
  assert.equal(wrongFirearm.excluded.wrongFirearm, 2);
});

test("a department-standard failure remains failed even when the drill pass is true", () => {
  const day = workspaceAttempt({ id: "day", runNumber: 1 });
  day.result.departmentStandardPassed = false;
  const result = readiness([
    day,
    workspaceAttempt({ id: "night", runNumber: 2 }),
  ]);
  assert.equal(result.status, "Failed");
});

test("score entry and historical import reconcile missing readiness without identity leakage", () => {
  const day = workspaceAttempt({ id: "day", runNumber: 1 });
  const otherOfficerNight = workspaceAttempt({
    id: "other-night",
    officerId: "officer-b",
    runNumber: 2,
  });
  assert.equal(readiness([day, otherOfficerNight]).status, "Missing Night");

  const importedNight = {
    id: "import-night",
    officerUserId: "officer-a",
    qualificationDate: "2026-08-25",
    lightingCondition: "night",
    qualificationType: "handgun",
    recordOrigin: "historical_import",
    passed: true,
    score: 50,
  };
  assert.equal(readiness([day, otherOfficerNight], [importedNight]).status, "Current");

  const scoredNight = workspaceAttempt({ id: "scored-night", runNumber: 2 });
  assert.equal(readiness([day, scoredNight]).status, "Current");
});

test("explicit firearm and standard scopes reject otherwise-current mismatches", () => {
  const entries = [
    workspaceAttempt({ id: "day", runNumber: 1 }),
    workspaceAttempt({ id: "night", runNumber: 2 }),
  ];
  assert.equal(readiness(entries, [], { firearmId: "handgun-b" }).status, "No Record");
  assert.equal(readiness(entries, [], { standardId: "different-standard" }).status, "No Record");
});

test("agency day and night policy is normalized with backward-compatible defaults", () => {
  assert.deepEqual(requiredHandgunQualificationComponents(undefined), ["day", "night"]);
  assert.deepEqual(requiredHandgunQualificationComponents({ require_night_handgun_qualification: false }), ["day"]);
  assert.deepEqual(requiredHandgunQualificationComponents({ require_day_handgun_qualification: false }), ["night"]);
  assert.deepEqual(requiredHandgunQualificationComponents({
    require_day_handgun_qualification: false,
    require_night_handgun_qualification: false,
  }), []);
});

test("unrequired components cannot create missing or failed readiness", () => {
  const dayOnly = readiness([
    workspaceAttempt({ id: "day", runNumber: 1 }),
    workspaceAttempt({ id: "night-failure", runNumber: 2, passed: false }),
  ], [], { requiredComponents: ["day"] });
  assert.equal(dayOnly.status, "Current");

  const nightOnly = readiness([
    workspaceAttempt({ id: "night", runNumber: 2 }),
  ], [], { requiredComponents: ["night"] });
  assert.equal(nightOnly.status, "Current");

  const noneRequired = evaluateQualificationReadiness({
    failedQualifications: [{
      date: "2026-09-01",
      runLabel: "Day Qualification",
      component: "day",
    }],
    qualificationValidDays: 365,
    qualificationDueSoonDays: 30,
    requiredComponents: [],
    today,
  });
  assert.equal(noneRequired.status, "Current");
});
