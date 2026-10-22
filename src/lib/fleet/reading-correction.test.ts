import assert from "node:assert/strict";
import test from "node:test";

import { readingCorrectionNeeded } from "./reading-correction.ts";

test("UX-RB2-7 (D-08): a lowered reading needs a correction reason; a higher or blank one does not", () => {
  const original = { current_mileage: 19200, current_hours: 100 };
  assert.equal(readingCorrectionNeeded({ currentMileage: "19100", currentHours: "100" }, original), true);
  assert.equal(readingCorrectionNeeded({ currentMileage: "19200", currentHours: "99.5" }, original), true);
  assert.equal(readingCorrectionNeeded({ currentMileage: "19300", currentHours: "" }, original), false);
  assert.equal(readingCorrectionNeeded({ currentMileage: "100", currentHours: "1" }, null), false, "a new vehicle has nothing to correct");
});
