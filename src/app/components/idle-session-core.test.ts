import assert from "node:assert/strict";
import test from "node:test";

import {
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
