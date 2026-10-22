import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  completionChoiceRequired,
  displayedCompletion,
  resolveRunCompletion,
  resolveRunOutcome,
  standardFirearmType,
} from "./scoring-rules.ts";

test("RNG-15: the Complete / Incomplete toggle is honoured for every format and incomplete never passes", () => {
  for (const scoringFormat of ["Qualification", "Points", "Time", "Hit Count", "Pass/Fail"]) {
    assert.deepEqual(resolveRunCompletion({ scoringFormat, completed: false, passed: true }), { completed: false, passed: false }, scoringFormat);
    assert.deepEqual(resolveRunCompletion({ scoringFormat, passed: true }), { completed: true, passed: true }, scoringFormat);
    assert.deepEqual(resolveRunCompletion({ scoringFormat, completed: true, passed: false }), { completed: true, passed: false }, scoringFormat);
  }
  assert.deepEqual(resolveRunCompletion({ scoringFormat: "Completion", passed: undefined }), { completed: false, passed: false });
  assert.deepEqual(resolveRunCompletion({ scoringFormat: "Completion", completed: true, passed: true }), { completed: true, passed: true });
  assert.deepEqual(resolveRunCompletion({ scoringFormat: "Notes Only" }), { completed: true, passed: undefined });
});

test("RNG-09: an Any-firearm drill is matched to the standard of the firearm used", () => {
  assert.equal(standardFirearmType("Any", "Handgun"), "handgun");
  assert.equal(standardFirearmType("Any", "Rifle"), "rifle");
  assert.equal(standardFirearmType("Any", undefined), "");
  assert.equal(standardFirearmType("Handgun", "Rifle"), "handgun");
  assert.equal(standardFirearmType(undefined, "Rifle"), "");
});

test("the range scoring page saves through these rules", async () => {
  const page = await readFile(new URL("../../app/range-days/page.tsx", import.meta.url), "utf8");
  const save = page.slice(page.indexOf("function handleSaveBatchResults()"), page.indexOf("function handleGeneratePacket()"));
  assert.match(save, /const \{ completed, passed: finalPassed \} = resolveRunCompletion\(\{/);
  assert.match(save, /\n        completed,\n/);
  assert.match(save, /firearmTypeSnapshot: getFirearmType\(firearmId\),/);
  assert.doesNotMatch(save, /: true,\n        score:/);
  // Standard snapshots and passes are resolved with the firearm used.
  const calls = save.split(/getQualificationStandard(?:Pass|Snapshot)\(/).slice(1).map((call) => call.slice(0, call.indexOf(")")));
  assert.equal(calls.length, 3);
  calls.forEach((call) => assert.match(call, /\bfirearmId,\s*\}?\s*$/));
  assert.match(page, /const firearmType = standardFirearmType\(\n    drill\.firearmType,\n    getFirearmType\(firearmId\),\n  \);/);
});

test("RNG-07: the page lets scorers take attendance and add walk-ups but keeps other roster edits for managers", async () => {
  const page = await readFile(new URL("../../app/range-days/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const canTakeSelectedRangeDayAttendance =\n    \(canManageRangeDays \|\| canScoreRangeDays\) && !selectedRangeDayFinalized;/);
  assert.match(page, /const canManageOpenAttendance =\n    isOpenAttendance && canTakeSelectedRangeDayAttendance && canScoreRangeDays;/);
  assert.match(page, /function handleToggleRosterAttendance\(rosterEntryId: string\) \{\n    if \(!canTakeSelectedRangeDayAttendance\) return;/);
  assert.match(page, /function handleAddOpenAttendanceShooter\(\) \{\n    if \(!canManageOpenAttendance\) return;/);
  for (const handler of ["handleAddOfficerToRoster", "handleRemoveOfficerFromRoster", "handleToggleRosterFirearm"]) {
    assert.match(page, new RegExp(`function ${handler}\\([^)]*\\) \\{\\n    if \\(!canEditSelectedRangeDay\\) return;`), handler);
  }
  assert.match(page, /disabled=\{!canEditSelectedRangeDay\}\n                        onClick=\{\(\) => handleRemoveOfficerFromRoster\(entry\.id\)\}/);
});

const FORMATS = ["Qualification", "Points", "Time", "Hit Count", "Pass/Fail", "Completion", "Notes Only"];
const STORED = [undefined, true, false];

test("UX-RB-1 defect (RC 5b6cc00): the old toggle display disagreed with the saved value for Completion drills", () => {
  // The RC page displayed `row.completed ?? true` while saving resolveRunCompletion().
  const oldDisplayComplete = (completed?: boolean) => completed ?? true;
  assert.equal(oldDisplayComplete(undefined), true);
  assert.equal(resolveRunCompletion({ scoringFormat: "Completion" }).completed, false);
});

test("UX-RB-1: whatever the control displays is exactly what is saved, for every format", () => {
  for (const scoringFormat of FORMATS) {
    for (const completed of STORED) {
      const shown = displayedCompletion(scoringFormat, completed);
      if (completionChoiceRequired(scoringFormat, completed)) {
        assert.equal(shown, "not_recorded", `${scoringFormat}/${completed}`);
        continue;
      }
      const saved = resolveRunCompletion({ scoringFormat, completed }).completed;
      assert.equal(shown, saved ? "complete" : "incomplete", `${scoringFormat}/${completed}`);
    }
  }
});

test("UX-RB-1: only an untouched Completion row needs an explicit choice", () => {
  for (const scoringFormat of FORMATS) {
    assert.equal(completionChoiceRequired(scoringFormat, undefined), scoringFormat === "Completion", scoringFormat);
    assert.equal(completionChoiceRequired(scoringFormat, true), false);
    assert.equal(completionChoiceRequired(scoringFormat, false), false);
  }
});

test("UX-RB-1: no failure or remediation flag without a recorded failing result", () => {
  // Notes Only never passes or fails, complete or not.
  for (const completed of [true, false]) {
    const outcome = resolveRunOutcome({ scoringFormat: "Notes Only", completed, finalPassed: completed ? undefined : false, hasStandard: true });
    assert.deepEqual(outcome, { passed: undefined, departmentStandardPassed: undefined, deficiencyObserved: false, remedialTrainingRecommended: false });
  }
  // An incomplete run of a drill with no standard is not a standard failure.
  assert.equal(resolveRunOutcome({ scoringFormat: "Completion", completed: false, finalPassed: false, hasStandard: false }).departmentStandardPassed, undefined);
  // A complete Completion run passes cleanly.
  assert.deepEqual(resolveRunOutcome({ scoringFormat: "Completion", completed: true, finalPassed: true, hasStandard: false }), { passed: true, departmentStandardPassed: undefined, deficiencyObserved: false, remedialTrainingRecommended: false });
});

test("UX-RB-1: an explicit failing result still records the deficiency (B10 semantics kept)", () => {
  const scored = resolveRunOutcome({ scoringFormat: "Points", completed: true, finalPassed: false, hasStandard: true, standardPassedWhenComplete: false, remediationRequired: true });
  assert.deepEqual(scored, { passed: false, departmentStandardPassed: false, deficiencyObserved: true, remedialTrainingRecommended: true });
  const incomplete = resolveRunOutcome({ scoringFormat: "Points", completed: false, finalPassed: false, hasStandard: true, remediationRequired: false });
  assert.deepEqual(incomplete, { passed: false, departmentStandardPassed: false, deficiencyObserved: true, remedialTrainingRecommended: true });
  const completionIncomplete = resolveRunOutcome({ scoringFormat: "Completion", completed: false, finalPassed: false, hasStandard: false });
  assert.equal(completionIncomplete.passed, false);
});
