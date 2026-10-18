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

test("one TracePoint value mapped to several distinct form fields is flagged, not confirmed", async () => {
  const { planAutomaticSetup, publishBlockers, sharedSourceKeys } = await import("./proposal-review");
  const serial = (name: string, y: number) => ({ ...high, id: name, detectedLabel: "Serial Number", suggestedSemanticKey: "firearm.serial_number", matchStatus: "exact" as const, geometry: { ...high.geometry, y }, acroField: { name, kind: "text" as const, multiline: false, comb: false, maxLength: null, options: [], widgets: [] } });
  const proposals = [serial("SerialA", 0.1), serial("SerialB", 0.2), { ...high, matchStatus: "exact" as const }];
  const plan = planAutomaticSetup(proposals);
  const serialRows = plan.rows.filter((row) => row.canonical_key === "firearm.serial_number");
  assert.equal(serialRows.length, 2);
  assert.ok(serialRows.every((row) => row.formatting.matchStatus === "suggested"));
  assert.match(String(serialRows[0]!.formatting.matchReason), /used for 2 different fields/);
  assert.equal(plan.rows.find((row) => row.canonical_key === "person.badge_number")!.formatting.matchStatus, "confirmed");
  assert.equal(plan.summary.needsReview, 2);
  assert.equal(publishBlockers(plan.rows).length, 2);
  // Bulk "accept all exact matches" leaves them for one-by-one review too.
  const shared = sharedSourceKeys(proposals);
  assert.deepEqual([...shared], ["firearm.serial_number"]);
  assert.equal(eligibleForBulkAccept(proposals[0]!, shared), false);
  assert.equal(eligibleForBulkAccept(proposals[2]!, shared), true);
});
