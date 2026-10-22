import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UX-RB-2: the quick inspection panel has no Pass defaults and no one-tap copy", async () => {
  const panel = await readFile(new URL("./[vehicleId]/QuickInspectionPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /condition: "Pass" as Condition/);
  assert.doesNotMatch(panel, /: \("Pass" as Condition\)/);
  assert.doesNotMatch(panel, /one-tap submission/);
  assert.doesNotMatch(panel, /start as Pass/);
  assert.match(panel, /checklist: submittedVehicleChecklist\(items\)/);
  assert.match(panel, /disabled=\{saving \|\| submitBlockers\.length > 0\}/);
});
