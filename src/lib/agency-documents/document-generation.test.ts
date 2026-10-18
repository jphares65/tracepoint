import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { analyzeTemplatePdf } from "./template-analyzer";
import { planAutomaticSetup, proposalToFieldRow, publishBlockers } from "./proposal-review";
import { generateDocument, renderTemplateProof, toFieldSpec, type StoredTemplateField } from "./document-generation";
import type { GenerationSources } from "./field-values";
import { pdfRectToNormalized } from "./page-geometry";
import { buildQualificationForm, QUALIFICATION_FORM_FIELDS, SYNTHETIC_AGENCY, SYNTHETIC_FIREARM, SYNTHETIC_OFFICER, SYNTHETIC_PREPARER, SYNTHETIC_QUALIFICATION } from "./__fixtures__/synthetic-forms";
import { inkRatio, rasterizerAvailable, renderGray } from "./__fixtures__/raster";

const sources: GenerationSources = {
  person: { id: SYNTHETIC_OFFICER.id, fullName: SYNTHETIC_OFFICER.full_name, badgeNumber: SYNTHETIC_OFFICER.badge_number, rankTitle: SYNTHETIC_OFFICER.rank_title },
  firearm: { id: SYNTHETIC_FIREARM.id, make: SYNTHETIC_FIREARM.make, model: SYNTHETIC_FIREARM.model, serialNumber: SYNTHETIC_FIREARM.serial_number, caliber: SYNTHETIC_FIREARM.caliber },
  qualification: { id: SYNTHETIC_QUALIFICATION.id, date: SYNTHETIC_QUALIFICATION.qualification_date, score: SYNTHETIC_QUALIFICATION.score, passed: true, instructorName: SYNTHETIC_QUALIFICATION.instructor_name },
  agency: { name: SYNTHETIC_AGENCY.name },
  preparer: SYNTHETIC_PREPARER,
  today: "2026-10-18",
};

/** Simulates the stored rows the setup route writes to document_template_fields. */
function storedRows(rows: ReturnType<typeof planAutomaticSetup>["rows"]): StoredTemplateField[] {
  return rows.map((row) => ({ ...row, formatting: row.formatting }));
}

async function pdfText(bytes: Uint8Array) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("pdftotext", ["-layout", "-", "-"], { input: Buffer.from(bytes) });
  return result.status === 0 ? result.stdout.toString() : null;
}

test("vertical slice: upload → automatic setup → review flagged fields → generate an accurately completed form", async () => {
  const source = await buildQualificationForm();
  // 1. Analyze and set up automatically.
  const analysis = await analyzeTemplatePdf(source);
  const plan = planAutomaticSetup(analysis.proposals);
  assert.equal(plan.summary.needsReview, 1, "only the generic 'Model' label should need review");
  assert.ok(plan.summary.confirmed >= 11);
  // The signature box is left blank for a hand signature.
  assert.deepEqual(plan.skipped.map((proposal) => proposal.acroField?.name), ["OfficerSignature"]);
  // Supervisor, case number, remarks and the checkbox become manual fields asked for at generation — never auto-filled.
  const manualNames = plan.rows.filter((row) => row.field_type === "manual").map((row) => row.formatting.acroFieldName).sort();
  assert.deepEqual(manualNames, ["CaseNumber", "DutyWeapon", "Remarks", "SupervisorName"]);

  // 2. Publishing is blocked until the flagged field is confirmed.
  let rows = storedRows(plan.rows);
  assert.equal(publishBlockers(rows).length, 1);
  assert.match(publishBlockers(rows)[0]!.message, /confirm or change/);
  const modelProposal = analysis.proposals.find((proposal) => proposal.acroField?.name === "Model")!;
  const confirmed = proposalToFieldRow(modelProposal, "accepted");
  rows = rows.map((row) => (row.formatting?.acroFieldName === "Model" ? { ...confirmed, id: row.id } : row));
  assert.deepEqual(publishBlockers(rows), []);

  // 3. Generate for the selected officer; the generating sergeant's details must not appear in officer fields.
  const specs = rows.map(toFieldSpec);
  const caseField = specs.find((spec) => spec.formatting?.acroFieldName === "CaseNumber")!;
  const outcome = await generateDocument(source, specs, sources, { entered: { [caseField.id]: "26-001234" } });
  assert.deepEqual(outcome.issues, []);
  assert.equal(outcome.ready, true, JSON.stringify(outcome.resolution.missing));
  const byAcro = new Map(outcome.resolution.fields.map((field) => [specs.find((spec) => spec.id === field.fieldId)!.formatting!.acroFieldName, field]));
  assert.equal(byAcro.get("OfficerName")!.value, "Jordan A. Rivera");
  assert.equal(byAcro.get("BadgeNo")!.value, "4471");
  assert.equal(byAcro.get("AgencyName")!.value, "Lakeview Township Police Department");
  assert.equal(byAcro.get("Model")!.value, "EA-19");
  assert.equal(byAcro.get("QualDate")!.value, "03/14/2026");
  assert.equal(byAcro.get("PassFail")!.value, "Pass");
  assert.equal(byAcro.get("SupervisorName")!.value, "");
  assert.equal(byAcro.has("OfficerSignature"), false);
  assert.equal(byAcro.get("CaseNumber")!.status, "typed");

  // 4. The output is flattened and contains the values where the form expects them.
  const output = await PDFDocument.load(outcome.bytes);
  assert.equal(output.getForm().getFields().length, 0);
  const text = await pdfText(outcome.bytes);
  if (text !== null) {
    for (const expected of ["Jordan A. Rivera", "4471", "Example Arms", "EXA123456", "03/14/2026", "287", "Taylor Brooks", "26-001234"]) assert.ok(text.includes(expected), `${expected} should be printed`);
    assert.ok(!text.includes("Casey Morgan"), "the generating user's name must not appear");
  }
  if (rasterizerAvailable) {
    const raster = renderGray(outcome.bytes, 1, 100);
    const supervisor = QUALIFICATION_FORM_FIELDS.find((field) => field.name === "SupervisorName")!;
    assert.equal(inkRatio(raster, pdfRectToNormalized(supervisor, { x: 0, y: 0, width: 612, height: 792 }, 0)!), 0, "supervisor box must stay empty");
  }
});

test("missing data blocks final generation and lists exactly what is missing", async () => {
  const source = await buildQualificationForm();
  const plan = planAutomaticSetup((await analyzeTemplatePdf(source)).proposals);
  const specs = storedRows(plan.rows).map(toFieldSpec);
  const outcome = await generateDocument(source, specs, { ...sources, person: { ...sources.person!, badgeNumber: null }, firearm: null });
  assert.equal(outcome.ready, false);
  const missing = outcome.resolution.missing.map((field) => field.canonicalKey).sort();
  assert.deepEqual(missing, ["firearm.caliber", "firearm.manufacturer", "firearm.model", "firearm.serial_number", "person.badge_number"]);
  // The document still renders as a preview, with the missing boxes left empty.
  assert.ok(outcome.bytes.length > 1000);
});

test("template proof renders every configured field with realistic sample values and flags boxes that are too small", async () => {
  const source = await buildQualificationForm();
  const plan = planAutomaticSetup((await analyzeTemplatePdf(source)).proposals);
  const specs = storedRows(plan.rows).map(toFieldSpec);
  const proof = await renderTemplateProof(source, specs);
  // The synthetic Make box is 120pt wide; "Example Arms Company" fits; nothing overflows on a well-built form.
  assert.deepEqual(proof.issues.map((issue) => issue.label), []);
  // Shrink a box to force an overflow and confirm the proof reports it.
  const tiny = specs.map((spec) => (spec.formatting?.acroFieldName === "OfficerName" ? { ...spec, formatting: { ...spec.formatting, acroFieldName: undefined }, geometry: { ...spec.geometry, width: 0.03 } } : spec));
  const flagged = await renderTemplateProof(source, tiny);
  assert.equal(flagged.issues.length, 1);
  assert.equal(flagged.issues[0]!.kind, "overflow");
});

test("Word vertical slice: analyze → automatic setup → generate a completed .docx for the selected officer", async () => {
  const { buildQualificationDocx } = await import("./__fixtures__/synthetic-docx");
  const { analyzeTemplateDocx } = await import("./template-analyzer");
  const { generateDocxDocument, templateFormat } = await import("./document-generation");
  const { docxText } = await import("./docx-forms");
  const source = buildQualificationDocx();
  assert.equal(templateFormat(source), "docx");
  const plan = planAutomaticSetup(analyzeTemplateDocx(source).proposals);
  assert.deepEqual(plan.skipped.map((proposal) => proposal.detectedLabel), ["Officer Signature"]);
  const reviewLabels = plan.rows.filter((row) => row.formatting.matchStatus === "suggested").map((row) => row.label);
  assert.deepEqual(reviewLabels, ["Model"]);
  const manual = plan.rows.filter((row) => row.field_type === "manual").map((row) => row.label).sort();
  assert.deepEqual(manual, ["CaseNo", "Supervisor Name"]);
  const specs = storedRows(plan.rows).map(toFieldSpec);
  const caseId = specs.find((spec) => spec.label === "CaseNo")!.id;
  const outcome = generateDocxDocument(source, specs, sources, { entered: { [caseId]: "26-001234" } });
  assert.deepEqual(outcome.issues, []);
  assert.equal(outcome.ready, true, JSON.stringify(outcome.resolution.missing));
  const text = docxText(outcome.bytes);
  for (const expected of ["Officer: Jordan A. Rivera", "Badge Number: 4471", "Rank: Patrol Officer", "Date of Report: 10/18/2026", "EXA123456", "EA-19", "Case Number: 26-001234", "Supervisor Name: ____"]) assert.ok(text.includes(expected), `${expected} should be in the document`);
  assert.ok(!text.includes("Casey Morgan"));
  assert.ok(outcome.previewHtml.includes("<mark>Jordan A. Rivera</mark>"));
});
