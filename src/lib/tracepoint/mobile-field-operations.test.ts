import assert from "node:assert/strict";
import test from "node:test";
import { qrDecision } from "./mobile-workflows.ts";
test("inventory QR honors explicit permission", () => {
  const input = { identifier: "SKU-1", access: { permissions: ["view_inventory"] as never[], enabledFeatures: [] }, inventory: { id: "item1", name: "Bandage" } };
  const allowed = qrDecision(input);
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.workflow, "inventory");
  const denied = qrDecision({ ...input, access: { permissions: [] as never[], enabledFeatures: [] } });
  assert.equal(denied.status, "denied");
});
