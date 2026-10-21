import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Choose template button scrolls to the template list through its own click handler", async () => {
  const page = await readFile("src/app/agency-documents/page.tsx", "utf8");
  assert.match(page, /<button type="button" onClick=\{chooseTemplate\}[^>]*>Choose template<\/button>/);
  assert.match(page, /const chooseTemplate=\(\)=>document\.getElementById\("templates"\)\?\.scrollIntoView/);
  assert.match(page, /<section id="templates"/);
  // Listeners attached by searching the DOM after the first render miss buttons that render later.
  assert.doesNotMatch(page, /querySelectorAll\("button"\)/);
});
