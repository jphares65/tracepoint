import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pagePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "page.tsx",
);

test("login page routes session resolution through the invalid-session guard", async () => {
  const source = await readFile(pagePath, "utf8");
  assert.match(source, /resolveLoginSession\(resolveAuthenticatedPrincipal\)/);
  assert.doesNotMatch(source, /const principal = await resolveAuthenticatedPrincipal\(\)/);
});
