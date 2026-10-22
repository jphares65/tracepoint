import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { clearRequestKey, requestKeyFor, type RequestKeyStore } from "./request-key";

test("the same values reuse one request key; changed values or a recorded action get a new one", () => {
  const store: RequestKeyStore = { current: null };
  const first = requestKeyFor(store, { item: "a", quantity: 2 });
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(requestKeyFor(store, { item: "a", quantity: 2 }), first, "a retry is the same request");
  const changed = requestKeyFor(store, { item: "a", quantity: 3 });
  assert.notEqual(changed, first, "different values are a different request");
  clearRequestKey(store);
  assert.notEqual(requestKeyFor(store, { item: "a", quantity: 3 }), changed, "after a success the next action is new");
});

test("C-07: the firearm inspection form sends a request key and ignores a second save in flight", async () => {
  const page = await readFile("src/app/firearms/inspections/new/page.tsx", "utf8");
  assert.match(page, /idempotencyKey: requestKeyFor\(requestKey\.current, inspectionRequest\)/);
  assert.match(page, /if \(savingRef\.current\) return;/);
  assert.match(page, /disabled=\{saving \|\| submitBlockers\.length > 0\}/);
});
