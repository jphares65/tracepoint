import assert from "node:assert/strict";
import test from "node:test";
import { mobileDepartmentSelection, mobileSupportSelection, isDedicatedMobileApiPath } from "./mobile-route-policy-core.ts";
const id = "11111111-1111-7111-8111-111111111111";
test("support selection is explicit, requires a valid agency, and accepts newer UUID layouts", () => {
  assert.deepEqual(mobileDepartmentSelection(id), { ok: true, selected: id });
  assert.deepEqual(mobileSupportSelection(id, null), { ok: true, support: "" });
  assert.deepEqual(mobileSupportSelection(id, "false"), { ok: true, support: "" });
  assert.deepEqual(mobileSupportSelection(id, "true"), { ok: true, support: id });
  for (const [selected, value] of [["", "true"], ["arbitrary", "true"], [id, "true,false"], [id, "1"]]) assert.deepEqual(mobileSupportSelection(selected, value), { ok: false });
  assert.equal(isDedicatedMobileApiPath("https://example.test/api/platform/support-mode"), false);
});
