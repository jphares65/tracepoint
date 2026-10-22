import assert from "node:assert/strict";
import test from "node:test";

import { inspectionPayloadError } from "./firearm-status-change.ts";
import {
  inspectionStatusEffect,
  inspectionSubmitBlockers,
  markRemainingPass,
  notInspected,
  notInspectedCount,
  submittedChecklist,
  type FormChecklistItem,
} from "./inspection-form.ts";

const template = [
  { id: "a", section: "S", label: "Serial verified", status: "Pass" as const, note: "" },
  { id: "b", section: "S", label: "Safe for duty use", status: "Pass" as const, note: "", critical: true },
  { id: "c", section: "S", label: "Optic", status: "N/A" as const, note: "" },
];

const answered = (items: FormChecklistItem[]) => markRemainingPass(items);

test("UX-RB-2: every checklist item starts Not inspected, whatever the template default", () => {
  const items = notInspected(template);
  assert.ok(items.every((item) => item.status === null));
  assert.equal(notInspectedCount(items), 3);
});

test("UX-RB-2: an untouched form cannot be saved and lists what is missing", () => {
  const blockers = inspectionSubmitBlockers({ firearmSelected: true, checklist: notInspected(template), weaponCleared: "", ammoRemoved: "", result: "" });
  assert.deepEqual(blockers, [
    "Record whether the weapon was cleared.",
    "Record whether ammunition was removed.",
    "3 checklist items are not inspected.",
    "Choose the overall result.",
  ]);
});

test("UX-RB-2: Mark remaining as Pass only fills items not yet answered", () => {
  const items = notInspected(template).map((item) => (item.id === "c" ? { ...item, status: "N/A" as const } : item.id === "a" ? { ...item, status: "Fail" as const } : item));
  const marked = markRemainingPass(items);
  assert.deepEqual(marked.map((item) => item.status), ["Fail", "Pass", "N/A"]);
});

test("UX-RB-2: a fully answered form with an explicit result can be saved; a failed critical item blocks Passed", () => {
  const items = answered(notInspected(template));
  assert.deepEqual(inspectionSubmitBlockers({ firearmSelected: true, checklist: items, weaponCleared: "Yes", ammoRemoved: "Yes", result: "Passed" }), []);
  const criticalFail = items.map((item) => (item.critical ? { ...item, status: "Fail" as const } : item));
  assert.deepEqual(inspectionSubmitBlockers({ firearmSelected: true, checklist: criticalFail, weaponCleared: "Yes", ammoRemoved: "Yes", result: "Passed" }), ["A critical item failed, so the result cannot be Passed."]);
});

test("UX-RB-2: an uninspected item is never turned into an answer in the request body", () => {
  assert.throws(() => submittedChecklist(notInspected(template)), /not inspected/);
  assert.deepEqual(submittedChecklist(answered(notInspected(template))).map((item) => item.status), ["Pass", "Pass", "Pass"]);
});

test("UX-RB-2: the server refuses a missing result and an unanswered item (unchanged contract)", () => {
  assert.equal(inspectionPayloadError({ checklist: [] }), "result is required.");
  assert.match(String(inspectionPayloadError({ result: "Passed", checklist: [{ label: "Optic", status: null }] })), /must be Pass, Fail or N\/A/);
});

test("UX-RB-2: the form states the status effect of the chosen result", () => {
  assert.match(inspectionStatusEffect(""), /Choose a result/);
  assert.equal(inspectionStatusEffect("Failed"), "Saving a Failed result sets this firearm to Inspection Required.");
  assert.equal(inspectionStatusEffect("Removed from Service"), "Saving a Removed from Service result sets this firearm to Out of Service.");
  assert.match(inspectionStatusEffect("Passed"), /returns this firearm to In Service/);
});
