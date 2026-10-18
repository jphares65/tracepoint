import assert from "node:assert/strict";import test from "node:test";import { canCreateTemplateField,eligibleForBulkAccept,reviewProgress } from "./proposal-review";
const high={id:"a",page:1,detectedLabel:"Badge",suggestedType:"tracepoint_data" as const,suggestedSemanticKey:"person.badge_number",confidence:.96,classification:"high" as const,reviewRequired:false,geometry:{x:.1,y:.1,width:.2,height:.04},analyzerSource:"native_pdf" as const};
test("bulk acceptance includes only safe high-confidence proposals",()=>{assert.equal(eligibleForBulkAccept(high),true);assert.equal(eligibleForBulkAccept({...high,classification:"unmapped",suggestedSemanticKey:undefined} as unknown as typeof high),false)});test("review progress persists from proposal status",()=>assert.deepEqual(reviewProgress(["accepted","rejected","proposed"]),{reviewed:2,total:3,remaining:1}));test("repeated sections never become scalar template fields",()=>assert.equal(canCreateTemplateField({...high,kind:"structured_section",classification:"structured",reviewRequired:true}),false));

test("editing a proposal cannot change what was detected on the form", async () => {
  const { mergeProposalUpdate } = await import("./proposal-review");
  const stored = { id: "p1", page: 2, detectedLabel: "Dates Fired", suggestedType: "manual", confidence: 0.5, classification: "structured", geometry: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, reviewRequired: true, analyzerSource: "native", kind: "structured_section", targetCells: [], acroField: { name: "Dates" } } as unknown as Parameters<typeof mergeProposalUpdate>[0];
  const merged = mergeProposalUpdate(stored, { kind: "scalar_field", page: 1, acroField: { name: "OtherField" }, docxTarget: { part: "word/document.xml" }, suggestedType: "tracepoint_data", suggestedSemanticKey: "officer.full_name", label: "Range dates", geometry: { x: 0.2, y: 0.2, width: 0.2, height: 0.05 }, formatting: { fontSize: 9, acroFieldName: "Injected", confirmedByPerson: true } } as never);
  assert.equal(merged.kind, "structured_section");
  assert.equal(merged.page, 2);
  assert.deepEqual(merged.acroField, { name: "Dates" });
  assert.equal(merged.docxTarget, undefined);
  assert.equal(merged.suggestedType, "tracepoint_data");
  assert.equal(merged.label, "Range dates");
  assert.equal(merged.geometry.x, 0.2);
  assert.deepEqual(merged.formatting, { fontSize: 9 });
});
