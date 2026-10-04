import assert from "node:assert/strict";
import test from "node:test";
import {
  INVENTORY_UNIT_OPTIONS,
  nextUnitValue,
  unitSelection,
} from "./unit-of-measure";

test("inventory unit options store normalized backend values", () => {
  assert.deepEqual(INVENTORY_UNIT_OPTIONS.slice(0, 4), [
    ["each", "Each"],
    ["box", "Box"],
    ["case", "Case"],
    ["pack", "Pack"],
  ]);
  assert.equal(unitSelection("case"), "case");
});

test("custom units remain editable when an existing item is opened", () => {
  assert.equal(unitSelection("bundle"), "other");
  assert.equal(nextUnitValue("bundle", "other"), "bundle");
  assert.equal(nextUnitValue("each", "other"), "");
  assert.equal(nextUnitValue("bundle", "box"), "box");
});
