import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UX-RB-2: the New Inspection page has no Pass or Passed defaults and no stale copy", async () => {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(page, /useState<FormChecklistItem\[\]>\(\(\) => notInspected\(DEFAULT_CHECKLIST\)\)/);
  assert.doesNotMatch(page, /useState<\(typeof RESULTS\)\[number\]>\("Passed"\)/);
  assert.doesNotMatch(page, /useState\("Yes"\)/);
  assert.doesNotMatch(page, />\("Remain In Service"\)/);
  assert.match(page, /checklist: submittedChecklist\(checklist\)/);
  assert.match(page, /disabled=\{saving \|\| submitBlockers\.length > 0\}/);
  assert.doesNotMatch(page, /Next step is\s+connecting this to the inspection database/);
  assert.match(page, /\{inspectionStatusEffect\(result\)\}/);
});
