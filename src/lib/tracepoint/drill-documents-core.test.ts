import assert from "node:assert/strict";
import test from "node:test";
import { validateDrillDocumentFile, workspaceHasDrillTemplate } from "./drill-documents-core.ts";

test("accepts supported drill documents and rejects unsafe uploads", () => {
  assert.equal(validateDrillDocumentFile({ name: "diagram.pdf", size: 1024, type: "application/pdf" }), null);
  assert.match(validateDrillDocumentFile({ name: "../diagram.pdf", size: 1024, type: "application/pdf" }) ?? "", /filename/);
  assert.match(validateDrillDocumentFile({ name: "diagram.svg", size: 1024, type: "image/svg+xml" }) ?? "", /Only PDF/);
  assert.match(validateDrillDocumentFile({ name: "empty.png", size: 0, type: "image/png" }) ?? "", /empty/);
});

test("finds only exact Drill Library record keys", () => {
  const workspace = { drillLibrary: [{ id: "drill-a" }] };
  assert.equal(workspaceHasDrillTemplate(workspace, "drill-a"), true);
  assert.equal(workspaceHasDrillTemplate(workspace, "drill-b"), false);
  assert.equal(workspaceHasDrillTemplate({}, "drill-a"), false);
});
