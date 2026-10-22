import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("D-14: the vehicle form has no Open Issues field; the count is shown, never typed", async () => {
  const page = await readFile("src/app/fleet-management/page.tsx", "utf8");
  assert.doesNotMatch(page, /<Field label="Open Issues">/);
  assert.doesNotMatch(page, /openIssueCount:/);
  assert.match(page, /vehicle\.open_issue_count \?\? 0/, "the list still shows the computed count");
});
