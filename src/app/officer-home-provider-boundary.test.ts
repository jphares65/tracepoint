import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("Officer Home consumes the server access payload without a browser data provider", () => {
  assert.doesNotMatch(source, /@\/lib\/supabase\/client|\.auth\.|\.from\s*\(/);
  for (const field of ["fullName", "rankTitle", "primaryRoleLabel", "unitName", "badgeNumber"]) {
    assert.match(source, new RegExp(`\\b${field}\\b`));
  }
  assert.match(source, /unit:\s*unitName\s*\|\|\s*"Department"/);
  assert.match(source, /badge:\s*badgeNumber/);
});
