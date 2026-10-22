import assert from "node:assert/strict";
import test from "node:test";

import {
  currentReturnPath,
  IDLE_SESSION_SIGN_OUT_PATH,
  submitIdleSessionExpiry,
} from "./idle-session-core.ts";

test("idle expiry submits the POST-only sign-out route instead of navigating to it", () => {
  const submitted: { action: string; method: string; hidden: boolean }[] = [];
  const appended: unknown[] = [];
  const document = {
    body: { append(value: unknown) { appended.push(value); } },
    createElement() {
      const form = {
        action: "",
        method: "",
        hidden: false,
        submit() { submitted.push({ action: form.action, method: form.method, hidden: form.hidden }); },
      };
      return form;
    },
  } as unknown as Document;

  submitIdleSessionExpiry(document);

  assert.equal(appended.length, 1);
  assert.deepEqual(submitted, [{ action: IDLE_SESSION_SIGN_OUT_PATH, method: "post", hidden: true }]);
});

test("automatic idle expiry posts the current page as next; explicit sign-out posts no field", () => {
  const forms: { fields: { type: string; name: string; value: string }[] }[] = [];
  const document = {
    body: { append() {} },
    createElement(tag: string) {
      if (tag === "input") return { type: "", name: "", value: "" };
      const form = { action: "", method: "", hidden: false, fields: [] as { type: string; name: string; value: string }[], append(field: { type: string; name: string; value: string }) { form.fields.push(field); }, submit() { forms.push(form); } };
      return form;
    },
  } as unknown as Document;
  submitIdleSessionExpiry(document, currentReturnPath({ pathname: "/range-days", search: "?day=d-1" }));
  submitIdleSessionExpiry(document);
  assert.deepEqual(forms.map((form) => form.fields), [[{ type: "hidden", name: "next", value: "/range-days?day=d-1" }], []]);
});

test("the dialog's Sign Out button never forwards its click event as a destination", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./IdleSessionGuard.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => signOut\(\)\}/);
  assert.match(source, /signOut\(currentReturnPath\(window\.location\)\)/);
});
