import assert from "node:assert/strict";
import test from "node:test";

import {
  initialEquipmentCondition,
  markRemainingPass,
  notInspectedCount,
  submittedVehicleChecklist,
  vehicleSubmitBlockers,
  type VehicleFormItem,
} from "./inspection-form.ts";

const items = (): VehicleFormItem[] => [
  { id: "brakes", label: "Brakes, steering and controls", critical: true, condition: null, note: "" },
  { id: "lights", label: "Lights, signals and siren", critical: false, condition: null, note: "" },
];

test("UX-RB-2: vehicle checks start Not inspected; only a known-bad equipment record is carried in", () => {
  assert.equal(initialEquipmentCondition("Current", false), null);
  assert.equal(initialEquipmentCondition(undefined, true), null);
  assert.equal(initialEquipmentCondition("Missing", false), "Defect");
  assert.equal(initialEquipmentCondition("Attention", true), "Critical");
  assert.equal(initialEquipmentCondition("Out of Service", false), "Critical");
});

test("UX-RB-2: an untouched vehicle inspection cannot be submitted", () => {
  assert.deepEqual(vehicleSubmitBlockers(items()), ["2 items are not inspected."]);
  assert.throws(() => submittedVehicleChecklist(items()), /not inspected/);
});

test("UX-RB-2: Mark remaining as Pass is explicit and never overrides an answered item", () => {
  const answered = items().map((item) => (item.id === "lights" ? { ...item, condition: "Defect" as const, note: "Left signal out" } : item));
  const marked = markRemainingPass(answered);
  assert.deepEqual(marked.map((item) => item.condition), ["Pass", "Defect"]);
  assert.equal(notInspectedCount(marked), 0);
  assert.deepEqual(vehicleSubmitBlockers(marked), []);
  assert.deepEqual(submittedVehicleChecklist(marked).map((item) => item.condition), ["Pass", "Defect"]);
});

test("UX-RB-2: a defect still needs a note", () => {
  const marked = markRemainingPass(items()).map((item) => (item.id === "lights" ? { ...item, condition: "Defect" as const } : item));
  assert.deepEqual(vehicleSubmitBlockers(marked), ["Add a short note for Lights, signals and siren."]);
});
