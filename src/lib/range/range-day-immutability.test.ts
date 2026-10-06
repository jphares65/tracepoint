import assert from "node:assert/strict";
import test from "node:test";

import {
  hydrateEditableRangeDay,
  isImmutableRangeDay,
} from "./range-day-immutability.ts";
import { authorizeRangeWorkspaceMutation } from "./workspace-mutation.ts";

test("recognizes immutable Range Days from both workspace field spellings", () => {
  assert.equal(isImmutableRangeDay({ status: "Completed" }), true);
  assert.equal(isImmutableRangeDay({ packetStatus: "Ready" }), true);
  assert.equal(isImmutableRangeDay({ packet_status: "READY" }), true);
  assert.equal(isImmutableRangeDay({ status: "Planned", packetStatus: "In Progress" }), false);
});

test("creating a drill does not hydrate or rewrite unrelated finalized Range Day history", () => {
  const finalizedDay = {
    id: "completed-day",
    departmentId: "agency-a",
    status: "Completed",
    packetStatus: "Ready",
  };
  const openDay = {
    id: "open-day",
    departmentId: "agency-a",
    status: "Planned",
    packetStatus: "Needs Setup",
  };
  const existing = {
    rangeDays: [finalizedDay, openDay],
    drillLibrary: [],
    rangeDayDrills: [],
    rangeRoster: [],
    results: [],
    malfunctions: [],
  };

  // This mirrors page-load normalization: legacy editable records receive UI
  // defaults, while finalized history is retained exactly as persisted.
  const hydratedRangeDays = existing.rangeDays.map((day) =>
    hydrateEditableRangeDay(day, (editableDay) => ({
      ...editableDay,
      leadInstructorId: "instructor-1",
      instructorIds: ["instructor-1"],
      attendanceMode: "Scheduled Roster",
      staffingNotes: "",
    })),
  );
  const next = {
    ...existing,
    rangeDays: hydratedRangeDays,
    drillLibrary: [{ id: "custom-drill", departmentId: "agency-a", name: "Custom drill" }],
    rangeDayDrills: [{
      id: "custom-assignment",
      rangeDayId: "open-day",
      sourceTemplateId: "custom-drill",
      name: "Custom drill",
    }],
  };

  assert.equal(hydratedRangeDays[0], finalizedDay);
  assert.deepEqual(hydratedRangeDays[0], finalizedDay);
  assert.equal(hydratedRangeDays[1].status, "Planned");
  assert.deepEqual(authorizeRangeWorkspaceMutation({
    existingWorkspace: existing,
    nextWorkspace: next,
    departmentId: "agency-a",
    permissions: ["manage_range_days"],
  }), { ok: true, mode: "manage" });

  const reloaded = JSON.parse(JSON.stringify(next));
  assert.equal(reloaded.rangeDays[1].status, "Planned");
  assert.equal(reloaded.drillLibrary[0].name, "Custom drill");
  assert.equal(reloaded.rangeDayDrills[0].rangeDayId, "open-day");

  const afterRemoval = {
    ...reloaded,
    rangeDayDrills: [],
  };
  assert.deepEqual(authorizeRangeWorkspaceMutation({
    existingWorkspace: reloaded,
    nextWorkspace: afterRemoval,
    departmentId: "agency-a",
    permissions: ["manage_range_days"],
  }), { ok: true, mode: "manage" });
  assert.equal(afterRemoval.drillLibrary[0].name, "Custom drill");
});
