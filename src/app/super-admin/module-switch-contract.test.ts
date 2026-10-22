import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("UX-RB2-6 (E-52): switching a module off asks first; either change reports what happened", async () => {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("async function setFeatureEnabled(");
  const save = page.slice(start, page.indexOf("if (access.loading)", start));
  assert.match(save, /if \(!isEnabled && !window\.confirm\(moduleDisableConfirmation\(moduleName, agencyName\)\)\) return;/);
  assert.ok(save.indexOf("window.confirm") < save.indexOf('fetch("/api/super-admin"'), "nothing is sent before the confirmation");
  assert.match(save, /setNotice\(moduleSwitchNotice\(moduleName, agencyName, isEnabled\)\);/);
  assert.match(page, /void setFeatureEnabled\(\n\s*feature\.code,\n\s*!enabled,\n\s*feature\.display_name,\n\s*\)/);
});
