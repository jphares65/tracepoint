import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveRunCompletion, standardFirearmType } from "./scoring-rules.ts";

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
