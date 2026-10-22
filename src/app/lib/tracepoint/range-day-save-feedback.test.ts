import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = () => readFile("src/app/range-days/page.tsx", "utf8");

// The UX-RB client saves through one version-checked queue; its sync state is
// shown by the save-status pill. The primary control keeps its label, and
// result and failure messages are shown beside it, never inside it.
test("the primary save control keeps its label and feedback is reported separately", async () => {
  const source = await page();

  assert.match(
    source,
    /<Save size=\{14\} \/>\s*Save Range Day\s*<\/button>/,
    "the primary control's label is fixed",
  );
  assert.doesNotMatch(
    source,
    /\{(saveMessage|workspaceFeedback) \|\| "Save Range Day"\}/,
    "feedback must not replace the primary save label",
  );
  assert.match(
    source,
    /role="status" aria-live="polite">\{saveMessage\}<\/span>/,
    "feedback is announced and visible beside the control",
  );
  assert.match(
    source,
    /function handleSaveRangeDayWorkspace\(\) \{[\s\S]*?queueRangeDayWorkspaceSave\(createRangeDayWorkspaceSnapshot\(\), 0\);\s*void workspaceSaveQueue\.current\?\.flushNow\(/,
    "an explicit save sends the workspace now, through the same version-checked queue",
  );
});
