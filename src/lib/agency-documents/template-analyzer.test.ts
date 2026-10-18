import assert from "node:assert/strict";
import test from "node:test";
import { degrees, PDFDocument } from "pdf-lib";
import { analyzeTemplatePdf, normalizeWidgetRectangle, suggestFromLabel, validateProposal } from "./template-analyzer";
import { eligibleForBulkAccept } from "./proposal-review";
import { buildAcroFormPdf, buildFlatForm, buildQualificationForm } from "./__fixtures__/synthetic-forms";

function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 0.003, `${actual} is not close to ${expected}`); }

test("analysis can only emit registry semantic keys", () => {
  const proposal = suggestFromLabel("Badge Number", 1, { x: 0.1, y: 0.1, width: 0.2, height: 0.04 });
  assert.equal(proposal?.suggestedSemanticKey, "person.badge_number");
  assert.equal(validateProposal({ page: 1, detectedLabel: "x", suggestedType: "tracepoint_data", suggestedSemanticKey: "profiles.secret", confidence: 0.9, geometry: { x: 0, y: 0, width: 0.2, height: 0.1 } }), null);
});

test("normalizes widget rectangles from PDF bottom-left coordinates (rotation verified against a renderer in page-geometry tests)", () => {
  const lower = normalizeWidgetRectangle({ x: 0, y: 0, width: 61.2, height: 79.2 }, 612, 792)!; close(lower.y, 0.9);
  const upper = normalizeWidgetRectangle({ x: 550.8, y: 712.8, width: 61.2, height: 79.2 }, 612, 792)!; close(upper.x, 0.9); close(upper.y, 0);
  const wide = normalizeWidgetRectangle({ x: 100, y: 100, width: 200, height: 100 }, 1000, 500)!; close(wide.x, 0.1); close(wide.y, 0.6);
  // /Rotate 90 displays PDF (px, py) at (py, px) from the top-left. The previous implementation swapped 90 and 270.
  const rotated = normalizeWidgetRectangle({ x: 100, y: 100, width: 200, height: 100 }, 1000, 500, 90)!; close(rotated.x, 0.2); close(rotated.y, 0.1); close(rotated.width, 0.2); close(rotated.height, 0.2);
  const inverted = normalizeWidgetRectangle({ x: 237.48, y: 248.28, width: 35.52, height: -15.12 }, 612, 792)!; close(inverted.x, 0.3889); close(inverted.y, 0.6865);
});

test("a field with widgets on several pages becomes one proposal that keeps every placement", async () => {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([612, 792]), second = pdf.addPage([1000, 500]);
  second.setRotation(degrees(90));
  const field = pdf.getForm().createTextField("Officer Name");
  field.addToPage(first, { x: 61.2, y: 633.6, width: 122.4, height: 39.6 });
  field.addToPage(second, { x: 100, y: 100, width: 200, height: 100 });
  const result = await analyzeTemplatePdf(await pdf.save());
  const proposals = result.proposals.filter((p) => p.detectedLabel === "Officer Name");
  assert.equal(proposals.length, 1);
  const widgets = proposals[0]!.acroField!.widgets;
  assert.deepEqual(widgets.map((w) => w.page), [1, 2]);
  close(widgets[0]!.geometry.x, 0.1); close(widgets[0]!.geometry.y, 0.15);
  close(widgets[1]!.geometry.x, 0.2); close(widgets[1]!.geometry.y, 0.1);
});

test("a native field with no placeable widget is reported, never given a guessed location for drawing", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.getForm().createTextField("Badge Number");
  const result = await analyzeTemplatePdf(await pdf.save());
  assert.match(result.proposals[0]?.rationale ?? "", /no visible position/);
  assert.equal(result.proposals[0]?.skipByDefault, true);
  assert.equal(result.proposals[0]?.acroField?.widgets.length, 0);
});

test("repeated firearm fields become a structured section while scalar fields remain normal", async () => {
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  for (const name of ["Caliber 1", "Model 1", "Serial 1", "Caliber 2", "Model 2", "Serial 2"]) {
    const field = pdf.getForm().createTextField(name);
    field.addToPage(page, { x: 50 + (name.includes("Model") ? 120 : name.includes("Serial") ? 240 : 0), y: name.endsWith("1") ? 600 : 560, width: 90, height: 20 });
  }
  const score = pdf.getForm().createTextField("Score"); score.addToPage(page, { x: 50, y: 400, width: 90, height: 20 });
  const result = await analyzeTemplatePdf(await pdf.save());
  const group = result.proposals.find((p) => p.kind === "structured_section");
  assert.equal(group?.detectedLabel, "Repeated firearm fields (1, 2)");
  assert.equal(group?.reviewRequired, true);
  assert.equal(result.proposals.some((p) => p.detectedLabel === "Caliber 1"), false);
  assert.equal(result.proposals.find((p) => p.detectedLabel === "Score")?.suggestedSemanticKey, "qualification.score");
});

test("unmapped suggestions remain manual and reviewable", () => {
  const proposal = suggestFromLabel("Case Number", 1, { x: 0.1, y: 0.1, width: 0.2, height: 0.04 });
  assert.equal(proposal?.classification, "unmapped");
  assert.equal(proposal?.suggestedType, "manual");
});

test("synthetic qualification form: mapping accuracy, traps, and bulk-accept eligibility", async () => {
  const result = await analyzeTemplatePdf(await buildQualificationForm());
  assert.equal(result.scanned, false);
  const byName = new Map(result.proposals.map((p) => [p.acroField?.name, p]));
  const expectExact: Record<string, string> = { OfficerName: "person.full_name", BadgeNo: "person.badge_number", AgencyName: "agency.name", SerialNo: "firearm.serial_number", QualDate: "qualification.date", PassFail: "qualification.result", InstructorName: "qualification.instructor" };
  for (const [name, key] of Object.entries(expectExact)) {
    const proposal = byName.get(name)!;
    assert.equal(proposal.suggestedSemanticKey, key, `${name} → ${key}`);
    assert.equal(proposal.classification, "high", `${name} should be high confidence`);
    assert.equal(eligibleForBulkAccept(proposal), true);
  }
  // One-word labels are suggested with the right field but need a person's confirmation and are never bulk-accepted.
  const expectReview: Record<string, string> = { Rank: "person.rank", Make: "firearm.manufacturer", Model: "firearm.model", Caliber: "firearm.caliber", Score: "qualification.score" };
  for (const [name, key] of Object.entries(expectReview)) {
    const proposal = byName.get(name)!;
    assert.equal(proposal.suggestedSemanticKey, key, `${name} → ${key}`);
    assert.equal(proposal.classification, "review", `${name} should need review`);
    assert.equal(eligibleForBulkAccept(proposal), false);
  }
  // Traps: never mapped to the selected officer or bulk-accepted.
  for (const trap of ["SupervisorName", "OfficerSignature", "CaseNumber", "Remarks", "DutyWeapon"]) {
    const proposal = byName.get(trap)!;
    assert.notEqual(proposal.suggestedSemanticKey, "person.full_name", trap);
    assert.equal(eligibleForBulkAccept(proposal), false, trap);
  }
  assert.equal(byName.get("Remarks")!.acroField!.multiline, true);
  assert.equal(byName.get("DutyWeapon")!.acroField!.kind, "checkbox");
});

test("fields on a rotated, cropped page are located where the viewer shows them", async () => {
  const bytes = await buildAcroFormPdf([{ size: [612, 792], rotation: 90, cropBox: { x: 36, y: 36, width: 540, height: 720 }, fields: [{ name: "Badge Number", x: 136, y: 236, width: 100, height: 20 }] }]);
  const proposal = (await analyzeTemplatePdf(bytes)).proposals[0]!;
  // Display: x = (py - cropY)/cropH, y = (px - cropX)/cropW
  close(proposal.geometry.x, (236 - 36) / 720); close(proposal.geometry.y, (136 - 36) / 540);
  close(proposal.geometry.width, 20 / 720); close(proposal.geometry.height, 100 / 540);
});

test("a flat PDF reports no native fields so the visual path can take over", async () => {
  const result = await analyzeTemplatePdf(await buildFlatForm());
  assert.equal(result.scanned, true);
  assert.equal(result.proposals.length, 0);
});

test("damaged or non-PDF input fails with a readable error", async () => {
  await assert.rejects(analyzeTemplatePdf(new TextEncoder().encode("hello")), /not a PDF/);
  await assert.rejects(analyzeTemplatePdf(new Uint8Array()), /empty/);
  await assert.rejects(analyzeTemplatePdf(new TextEncoder().encode("%PDF-1.7\n garbage garbage")), /could not be read|damaged/);
});

test("hierarchically named firearm rows (Inventory.RowN.SerialNumber) are a repeating section, not one value in every row", async () => {
  const fields = [{ name: "OfficerName", tooltip: "Officer Name", x: 40, y: 700, width: 200, height: 18 }];
  for (let row = 1; row <= 5; row += 1) {
    const y = 600 - row * 24;
    fields.push({ name: `Inventory.Row${row}.Make`, tooltip: "Make", x: 40, y, width: 120, height: 18 });
    fields.push({ name: `Inventory.Row${row}.Model`, tooltip: "Model", x: 180, y, width: 120, height: 18 });
    fields.push({ name: `Inventory.Row${row}.SerialNumber`, tooltip: "Serial Number", x: 320, y, width: 120, height: 18 });
  }
  const { proposals } = await analyzeTemplatePdf(await buildAcroFormPdf([{ fields }]));
  const sections = proposals.filter((proposal) => proposal.kind === "structured_section");
  assert.equal(sections.length, 1);
  assert.match(sections[0]!.detectedLabel, /1, 2, 3, 4, 5/);
  assert.equal(proposals.some((proposal) => proposal.acroField?.name.startsWith("Inventory.")), false, "table cells must not become scalar fields");
  assert.ok(proposals.some((proposal) => proposal.acroField?.name === "OfficerName"));
});

test("hierarchical names without a row segment, or with a page number, are not treated as rows", async () => {
  const { proposals } = await analyzeTemplatePdf(await buildAcroFormPdf([{ fields: [
    { name: "form1.Page1.Make", tooltip: "Make", x: 40, y: 600, width: 120, height: 18 },
    { name: "form1.Page1.Model", tooltip: "Model", x: 180, y: 600, width: 120, height: 18 },
    { name: "form1.Page2.Make", tooltip: "Make", x: 40, y: 560, width: 120, height: 18 },
    { name: "form1.Page2.Model", tooltip: "Model", x: 180, y: 560, width: 120, height: 18 },
  ] }]));
  assert.equal(proposals.filter((proposal) => proposal.kind === "structured_section").length, 0);
});

test("a PDF image or push-button box is reported for a decision; print and reset buttons are not", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  form.createButton("OfficerPhoto").addToPage("Photo", page, { x: 400, y: 600, width: 120, height: 150 });
  form.createButton("PrintForm").addToPage("Print", page, { x: 40, y: 40, width: 80, height: 20 });
  form.createTextField("OfficerName").addToPage(page, { x: 40, y: 700, width: 200, height: 20 });
  const proposals = (await analyzeTemplatePdf(await doc.save())).proposals;
  const flagged = proposals.filter((proposal) => proposal.structuredType === "unsupported_control");
  assert.deepEqual(flagged.map((proposal) => proposal.detectedLabel), ["Unsupported button or image field: Officer Photo"]);
  assert.equal(flagged[0]!.kind, "structured_section");
  assert.ok(flagged[0]!.reviewRequired);
});

test("a PDF firearm list is a section TracePoint says it cannot fill, never a single-record field", async () => {
  const fields = [1, 2, 3].flatMap((row) => ["Make", "Model", "SerialNumber"].map((column, index) => ({ name: `Inventory.Row${row}.${column}`, x: 40 + index * 150, y: 500 - row * 25, width: 140, height: 20 })));
  const proposals = (await analyzeTemplatePdf(await buildAcroFormPdf([{ fields }]))).proposals;
  assert.equal(proposals.filter((proposal) => proposal.acroField?.name.startsWith("Inventory.")).length, 0);
  const section = proposals.find((proposal) => proposal.kind === "structured_section");
  assert.match(section?.rationale ?? "", /cannot fill firearm lists/);
});
