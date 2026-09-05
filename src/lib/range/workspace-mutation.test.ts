import assert from "node:assert/strict";
import test from "node:test";

import { authorizeRangeWorkspaceMutation } from "./workspace-mutation.ts";

const base = () => ({
  rangeDays: [{ id: "day-1", departmentId: "agency-a", status: "Planned", packetStatus: "Needs Setup" }],
  drillLibrary: [{ id: "template-1", departmentId: "agency-a", name: "Baseline", status: "Active" }],
  rangeDayDrills: [{ id: "drill-1", rangeDayId: "day-1", sourceTemplateId: "template-1" }],
  rangeRoster: [{ id: "roster-1", rangeDayId: "day-1", officerId: "officer-1" }],
  results: [],
  malfunctions: [],
});
test("range managers may edit planning records in their agency", () => {
  const existing = base();
  const next = { ...existing, rangeDays: [{ ...existing.rangeDays[0], title: "Updated" }] };
  assert.deepEqual(authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: next,
    departmentId: "agency-a",
    permissions: ["manage_range_days"],
  }), { ok: true, mode: "manage" });
});

test("viewers and participants cannot forge direct planning updates", () => {
  const existing = base();
  const next = { ...existing, rangeDayDrills: [] };
  const decision = authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: next,
    departmentId: "agency-a",
    permissions: [],
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 403);
});

test("scorers can add results but cannot edit range days, rosters, or drills", () => {
  const existing = base();
  const scored = { ...existing, results: [{ id: "result-1", rangeDayId: "day-1", drillId: "drill-1" }] };
  assert.deepEqual(authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: scored,
    departmentId: "agency-a",
    permissions: ["score_range_days"],
  }), { ok: true, mode: "score" });

  const forged = { ...scored, rangeDayDrills: [] };
  const denied = authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: forged,
    departmentId: "agency-a",
    permissions: ["score_range_days"],
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);
});

test("cross-agency payloads and orphaned associations are denied", () => {
  for (const nextWorkspace of [
    { ...base(), rangeDays: [{ ...base().rangeDays[0], departmentId: "agency-b" }] },
    { ...base(), rangeDayDrills: [{ id: "drill-x", rangeDayId: "other-day" }] },
  ]) {
    const decision = authorizeRangeWorkspaceMutation({
      existingWorkspace: base(),
      nextWorkspace,
      departmentId: "agency-a",
      permissions: ["manage_range_days"],
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 403);
  }
});

test("completed and packet-finalized history cannot be rewritten", () => {
  for (const day of [
    { ...base().rangeDays[0], status: "Completed" },
    { ...base().rangeDays[0], packetStatus: "Ready" },
  ]) {
    const existing = { ...base(), rangeDays: [day], results: [{ id: "result-1", rangeDayId: "day-1", score: 90 }] };
    const next = { ...existing, results: [{ ...existing.results[0], score: 100 }] };
    const decision = authorizeRangeWorkspaceMutation({
      existingWorkspace: existing,
      nextWorkspace: next,
      departmentId: "agency-a",
      permissions: ["manage_range_days", "score_range_days"],
    });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 409);
  }
});
