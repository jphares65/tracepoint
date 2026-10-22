import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loginNotice } from "./login-notice.ts";

test("login notices render only fixed copy for known failure codes", () => {
  for (const code of ["authorization_rejected", "authorization_unavailable", "logout_unconfirmed", "session_expired"]) {
    const notice = loginNotice(code);
    assert.ok(notice, code);
    assert.equal(/[{}"]|code|cognito|json/i.test(notice.message), false, code);
  }
  for (const code of [undefined, null, "", "toString", "__proto__", "constructor", "<script>", ["authorization_rejected"], "Call 555-0100 to verify your account"]) {
    assert.equal(loginNotice(code), null, String(code));
  }
});

test("/login uses the shared return-path validator and the fixed notice channel", async () => {
  const page = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/login/page.tsx"), "utf8");
  assert.match(page, /loginReturnPath\(params\.next, \(await cookies\(\)\)\.toString\(\)\)/);
  assert.match(page, /loginNotice\(params\.notice\)/);
  assert.doesNotMatch(page, /function safeNextPath/);
  const form = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../app/login/LoginForm.tsx"), "utf8");
  assert.match(form, /<form action="\/api\/auth\/cognito\/login" method="post">\s*<input type="hidden" name="next" value=\{nextPath\} \/>/);
});
