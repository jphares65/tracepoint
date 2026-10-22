import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UX-RB-3: the quick inspection panel reports the server's outcome, not a work-order guess", async () => {
  const panel = await readFile(new URL("./[vehicleId]/QuickInspectionPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /Vehicle remains ready/);
  assert.doesNotMatch(panel, /payload\.workOrder\s*\?/);
  assert.match(panel, /const outcome = inspectionOutcome\(response\.ok, payload\);/);
  assert.match(panel, /if \(!outcome\.saved\) throw new Error\(outcome\.message\);/);
  assert.match(panel, /setWarning\(outcome\.warning \?\? ""\);/);
});
