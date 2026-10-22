import assert from "node:assert/strict";
import test from "node:test";

import { statusBlockedByHold, statusChangeMessage } from "./status-change.ts";

test("UX-RB2-4: while held, only statuses that keep the vehicle out of service can be chosen", () => {
  assert.deepEqual(["Available", "Attention", "Maintenance", "Out of Service", "Retired"].filter((status) => !statusBlockedByHold(true, status)), ["Maintenance", "Out of Service", "Retired"]);
  assert.equal(statusBlockedByHold(false, "Available"), false);
});

test("UX-RB2-4 (D-15): a status change the server did not apply is not reported as done", () => {
  assert.deepEqual(statusChangeMessage("3101", "Available", "Available"), { tone: "success", message: "Unit 3101 status updated and audited." });
  const held = statusChangeMessage("3101", "Available", "Out of Service");
  assert.equal(held.tone, "warning");
  assert.match(held.message, /^Unit 3101 stays Out of Service: a critical safety hold/);
});
