import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeRangeWorkspaceMutation,
  hasValidRangeWorkspaceTenantBoundary,
} from "./workspace-mutation.ts";
import {
  attemptsProtectedRecordMutation,
  mergeProtectedWorkspaceRecords,
  workspaceForActiveDepartment,
} from "./workspace-tenant-boundary.ts";

const activeWorkspace = () => ({
  rangeDays: [{ id: "day-a", departmentId: "agency-a", status: "Planned" }],
  drillLibrary: [{ id: "template-a", departmentId: "agency-a", name: "Active template", documents: [{ id: "document-a" }] }],
  rangeDayDrills: [{ id: "assignment-a", rangeDayId: "day-a", sourceTemplateId: "template-a" }],
  rangeRoster: [],
  results: [],
  malfunctions: [],
});

const workspaceWithLegacyForeignRecords = () => ({
  ...activeWorkspace(),
  rangeDays: [
    ...activeWorkspace().rangeDays,
    { id: "day-b", departmentId: "agency-b", status: "Completed", title: "Foreign history" },
  ],
  drillLibrary: [
    ...activeWorkspace().drillLibrary,
    { id: "template-b", departmentId: "agency-b", name: "Foreign template", documents: [{ id: "document-b" }] },
  ],
  rangeDayDrills: [
    ...activeWorkspace().rangeDayDrills,
    { id: "assignment-b", rangeDayId: "day-b", sourceTemplateId: "template-b" },
  ],
  results: [{ id: "result-b", rangeDayId: "day-b", drillId: "assignment-b", score: 100 }],
});

test("active-department serialization excludes foreign records and their children", () => {
  const payload = workspaceForActiveDepartment(workspaceWithLegacyForeignRecords(), "agency-a");

  assert.deepEqual(payload.rangeDays.map((item) => item.id), ["day-a"]);
  assert.deepEqual(payload.drillLibrary.map((item) => item.id), ["template-a"]);
  assert.deepEqual(payload.rangeDayDrills.map((item) => item.id), ["assignment-a"]);
  assert.deepEqual(payload.results, []);
});

test("a valid same-agency drill add survives the server preservation merge and reload", () => {
  const existing = workspaceWithLegacyForeignRecords();
  const submitted = workspaceForActiveDepartment({
    ...existing,
    rangeDayDrills: [
      ...existing.rangeDayDrills,
      { id: "assignment-new", rangeDayId: "day-a", sourceTemplateId: "template-a", name: "New copy" },
    ],
  }, "agency-a");
  const saved = mergeProtectedWorkspaceRecords(existing, submitted, "agency-a");

  assert.equal(hasValidRangeWorkspaceTenantBoundary({
    existingWorkspace: existing,
    nextWorkspace: submitted,
    departmentId: "agency-a",
  }), true);
  assert.deepEqual(authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: saved,
    departmentId: "agency-a",
    permissions: ["manage_range_days"],
  }), { ok: true, mode: "manage" });
  const reloaded = JSON.parse(JSON.stringify(saved));
  assert.deepEqual((reloaded.rangeDayDrills as Array<{ id: string }>).map((item) => item.id), [
    "assignment-a", "assignment-b", "assignment-new",
  ]);
  const foreignTemplate = (reloaded.drillLibrary as Array<{ id: string; documents?: unknown[] }>)
    .find((item) => item.id === "template-b");
  assert.deepEqual(foreignTemplate?.documents, [{ id: "document-b" }]);
});

test("removing an active Range Day drill does not remove a preserved foreign template or document", () => {
  const existing = workspaceWithLegacyForeignRecords();
  const submitted = workspaceForActiveDepartment({
    ...existing,
    rangeDayDrills: existing.rangeDayDrills.filter((item) => item.id !== "assignment-a"),
  }, "agency-a");
  const saved = mergeProtectedWorkspaceRecords(existing, submitted, "agency-a");

  assert.deepEqual(authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: saved,
    departmentId: "agency-a",
    permissions: ["manage_range_days"],
  }), { ok: true, mode: "manage" });
  assert.deepEqual((saved.rangeDayDrills as Array<{ id: string }>).map((item) => item.id), ["assignment-b"]);
  assert.deepEqual((saved.drillLibrary as Array<{ id: string }>).map((item) => item.id), ["template-a", "template-b"]);
});

test("a foreign record submitted by a client remains fail-closed and cannot be merged as an edit", () => {
  const existing = workspaceWithLegacyForeignRecords();
  const forged = {
    ...activeWorkspace(),
    rangeDays: [{ id: "day-b", departmentId: "agency-a", status: "Planned", title: "Forged foreign day" }],
  };

  assert.equal(attemptsProtectedRecordMutation(existing, forged, "agency-a"), true);
  assert.equal(hasValidRangeWorkspaceTenantBoundary({
    existingWorkspace: existing,
    nextWorkspace: forged,
    departmentId: "agency-a",
  }), false);
  const decision = authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: forged,
    departmentId: "agency-a",
    permissions: ["manage_range_days"],
  });
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.status, 403);
});
