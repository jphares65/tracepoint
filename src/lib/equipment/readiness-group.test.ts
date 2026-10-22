import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readinessGroupSummary, otherAssignedAssets } from "./readiness-group";

const row = (equipmentTypeId: string, status: string, affectsReadiness = true) => ({ equipmentTypeId, status, affectsReadiness });

test("D-22: a missing tracked-only item does not make an officer Not Ready, and the badge and % agree", () => {
  const summary = readinessGroupSummary([row("vest", "current"), row("radio", "due_soon"), row("flashlight", "missing", false)]);
  assert.deepEqual(summary, { readinessPercent: 100, ready: true });
});

test("D-22: a missing readiness item makes the officer Not Ready below 100%", () => {
  assert.deepEqual(readinessGroupSummary([row("vest", "missing"), row("radio", "current")]), { readinessPercent: 50, ready: false });
  assert.deepEqual(readinessGroupSummary([row("vest", "inspection_overdue")]), { readinessPercent: 0, ready: false });
  assert.deepEqual(readinessGroupSummary([]), { readinessPercent: 100, ready: true });
});

test("D-22: assigned kit that a requirement row already shows is not listed twice", () => {
  const assets = [{ id: "a1", equipment_type_id: "vest" }, { id: "a2", equipment_type_id: "taser" }];
  assert.deepEqual(otherAssignedAssets(assets, [row("vest", "current")]).map((asset) => asset.id), ["a2"]);
});

test("D-22: the readiness board uses the shared summary", async () => {
  const page = await readFile("src/app/equipment/page.tsx", "utf8");
  assert.match(page, /readinessGroupSummary\(group\.rows\)/);
  assert.match(page, /otherAssignedAssets\(group\.assignedAssets, group\.rows\)/);
});
