import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./TracePointShell.tsx", import.meta.url), "utf8");
const access = readFileSync(new URL("../../lib/tracepoint/server-access.ts", import.meta.url), "utf8");

test("the application shell receives department appearance through authenticated server access", () => {
  assert.doesNotMatch(shell, /@\/lib\/supabase\/client|\.from\s*\(/);
  for (const field of ["accentColor", "loginTheme"]) {
    assert.match(shell, new RegExp(`\\b${field}\\b`));
    assert.match(access, new RegExp(`\\b${field}\\b`));
  }
  assert.match(access, /accent_color,login_theme/);
});
