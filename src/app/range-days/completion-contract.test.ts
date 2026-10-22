import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UX-RB-1: the scoring page uses the explicit control and blocks unrecorded Completion rows", async () => {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /row\.completed \?\? true/);
  assert.equal(page.match(/<CompletionChoiceControl\b/g)?.length, 2);
  const save = page.slice(page.indexOf("function handleSaveBatchResults()"), page.indexOf("function handleGeneratePacket()"));
  assert.match(save, /completionChoiceRequired\(scoringFormat, row\.completed\)/);
  assert.ok(save.indexOf("officersNeedingCompletionChoice.length > 0") < save.indexOf("const savedResults ="));
  assert.match(save, /deficiencyObserved: outcome\.deficiencyObserved,/);
  assert.match(save, /remedialTrainingRecommended: outcome\.remedialTrainingRecommended,/);
  assert.doesNotMatch(save, /const departmentStandardPassed = !completed \? false/);
});
