import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = () => readFile("src/app/range-days/page.tsx", "utf8");

test("adding a drill keeps the primary save control stable and reports dirty feedback separately", async () => {
  const source = await page();

  assert.match(
    source,
    /\{isSavingRangeDay \? "Saving…" : "Save Range Day"\}/,
    "the primary control must only change while the save request is in flight",
  );
  assert.doesNotMatch(
    source,
    /\{workspaceFeedback \|\| "Save Range Day"\}/,
    "drill feedback must not replace the primary save label",
  );
  assert.match(
    source,
    /setIsRangeDayDirty\(true\);\s*setWorkspaceFeedback\(`\$\{normalizedCopiedDrill\.name\} added\. Save Range Day when you are ready\.`\);/,
  );
  assert.match(
    source,
    /setIsRangeDayDirty\(false\);\s*setWorkspaceFeedback\("Saved"\);/,
    "a successful explicit save clears dirty state and confirms separately",
  );
  assert.match(
    source,
    /await saveRemoteRangeDayWorkspace\(workspace, departmentId\);/,
    "the explicit Save Range Day flow retains its existing persistence call",
  );
});
