import assert from "node:assert/strict";
import test from "node:test";
import { addDrillLibraryTemplateToWorkspace, createDrillLibraryTemplate } from "./range-day-utils.ts";
import { workspaceHasDrillTemplate } from "../../../lib/tracepoint/drill-documents-core.ts";

test("new Drill Library templates are present in the workspace before Documents is rendered", () => {
  const created = createDrillLibraryTemplate({
    departmentId: "department-1", name: "New drill", category: "Marksmanship",
    defaultScoringMode: "Pass/Fail", defaultRunCount: 1, defaultRequired: false,
    createdByUserId: "user-1",
  }, "2026-10-05T12:01:00.000Z");
  const existing = { ...created, id: "drill-template-existing", name: "Existing drill" };

  const workspace = addDrillLibraryTemplateToWorkspace({
    drillLibrary: [existing], rangeDays: [], rangeDayDrills: [], rangeRoster: [], results: [], malfunctions: [],
  }, created);

  assert.equal(workspaceHasDrillTemplate(workspace, existing.id), true);
  assert.equal(workspaceHasDrillTemplate(workspace, created.id), true);
  assert.deepEqual(workspace.drillLibrary.map((template) => template.id), [created.id, existing.id]);
});
