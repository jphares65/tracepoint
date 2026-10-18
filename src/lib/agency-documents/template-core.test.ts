import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionTemplate, isValidFieldGeometry, tenantMatch } from "./template-core";

test("template lifecycle supports draft and published states without archiving bypass", () => {
  assert.equal(canTransitionTemplate("draft", "published"), true);
  assert.equal(canTransitionTemplate("published", "draft"), true);
  assert.equal(canTransitionTemplate("archived", "published"), false);
});
test("template geometry round-trips normalized document coordinates", () => {
  const geometry = { x: 0.12, y: 0.31, width: 0.24, height: 0.05 };
  assert.equal(isValidFieldGeometry(JSON.parse(JSON.stringify(geometry))), true);
  assert.equal(isValidFieldGeometry({ ...geometry, width: 0.95 }), false);
});
test("tenant checks do not permit cross-agency template access", () => {
  assert.equal(tenantMatch("agency-a", "agency-a"), true);
  assert.equal(tenantMatch("agency-a", "agency-b"), false);
});
