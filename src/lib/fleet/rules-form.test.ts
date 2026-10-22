import assert from "node:assert/strict";
import test from "node:test";

import { canSaveRules, formatCodeList, parseCodeList } from "./rules-form.ts";

test("UX-RB2-2 (D-27): a second role code can be typed after a comma", () => {
  // Before: the input re-rendered from the parsed list, so "fleet_manager," became "fleet_manager".
  assert.equal(formatCodeList(parseCodeList("fleet_manager, ")), "fleet_manager");
  assert.deepEqual(parseCodeList("fleet_manager, sergeant"), ["fleet_manager", "sergeant"]);
  assert.deepEqual(parseCodeList(" a ,, b , a "), ["a", "b"]);
  assert.deepEqual(parseCodeList(""), []);
  assert.equal(formatCodeList(["a", "b"]), "a, b");
  assert.equal(formatCodeList(null), "");
});

test("UX-RB2-2 (D-28): rules can be saved only after they loaded", () => {
  assert.equal(canSaveRules({ state: "loading" }, false), false);
  assert.equal(canSaveRules({ state: "failed", error: "x" }, false), false);
  assert.equal(canSaveRules({ state: "loaded" }, true), false);
  assert.equal(canSaveRules({ state: "loaded" }, false), true);
});
