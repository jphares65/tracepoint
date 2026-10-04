import assert from "node:assert/strict";
import test from "node:test";
import { isDedicatedMobileApiPath, mobileDepartmentSelection } from "./mobile-route-policy-core";

test("only the dedicated mobile namespace is bearer-eligible", () => {
  assert.equal(isDedicatedMobileApiPath("https://tracepoint.example/api/mobile/fleet/vehicles"), true);
  for (const url of ["https://tracepoint.example/api/fleet/vehicles", "https://tracepoint.example/api/mobileish/fleet", "not a url"]) assert.equal(isDedicatedMobileApiPath(url), false);
});

test("mobile department selection accepts none or one UUID and rejects foreign-shaped values", () => {
  assert.deepEqual(mobileDepartmentSelection(null), { ok: true, selected: "" });
  assert.deepEqual(mobileDepartmentSelection("11111111-1111-4111-8111-111111111111"), { ok: true, selected: "11111111-1111-4111-8111-111111111111" });
  assert.deepEqual(mobileDepartmentSelection("foreign-department"), { ok: false });
});
