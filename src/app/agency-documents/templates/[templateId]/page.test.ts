import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("template builder exposes an explicit analysis and direct-placement workflow", async () => {
  const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(source, /Analyze Form/);
  assert.match(source, /Add Field/);
  assert.match(source, /\/analyze/);
  assert.match(source, /\/fields/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /Click the PDF where the new field belongs/);
});
