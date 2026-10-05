import assert from "node:assert/strict";
import test from "node:test";
import { addDrillLibraryTemplateToWorkspace, addLibraryDrillToRangeDay, createDrillLibraryTemplate } from "./range-day-utils.ts";
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

test("a document-bearing library drill creates a persisted Range Day snapshot without embedding or changing documents", () => {
  const template = createDrillLibraryTemplate({
    departmentId: "department-1", name: "PDF qualification", category: "Qualification",
    defaultScoringMode: "Pass/Fail", defaultRunCount: 1, defaultRequired: true,
    createdByUserId: "user-1",
  }, "2026-10-05T12:01:00.000Z");
  const document = { id: "document-1", drill_template_id: template.id, original_filename: "course.pdf" };

  const assignment = addLibraryDrillToRangeDay({ rangeDayId: "day-1", templateId: template.id }, [template], "2026-10-05T12:02:00.000Z");

  assert.ok(assignment);
  assert.equal(assignment.sourceTemplateId, template.id);
  assert.equal(assignment.rangeDayId, "day-1");
  assert.equal("documents" in assignment, false);
  assert.deepEqual(document, { id: "document-1", drill_template_id: template.id, original_filename: "course.pdf" });
});
