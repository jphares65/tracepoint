import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { analyzeTemplatePdf } from "./template-analyzer";
import { layoutText, renderAgencyDocument, renderDocument, wrapText, type RenderField } from "./pdf-renderer";
import { pdfRectToNormalized, type Rotation } from "./page-geometry";
import { buildAcroFormPdf, buildQualificationForm, QUALIFICATION_FORM_FIELDS } from "./__fixtures__/synthetic-forms";
import { inkBounds, inkRatio, rasterizerAvailable, renderGray } from "./__fixtures__/raster";

const noRaster = !rasterizerAvailable && "pdftoppm is not installed";

test("renders semantic values into a source PDF", async () => {
  const source = await PDFDocument.create(); source.addPage([612, 792]);
  const output = await renderAgencyDocument(await source.save(), [{ pageNumber: 1, value: "Badge 42", geometry: { x: 0.1, y: 0.1, width: 0.3, height: 0.05 }, formatting: { autoFit: true } }]);
  assert.equal((await PDFDocument.load(output)).getPageCount(), 1);
});

async function nativeFields(values: Record<string, string>): Promise<{ source: Uint8Array; fields: RenderField[] }> {
  const source = await buildQualificationForm();
  const analysis = await analyzeTemplatePdf(source);
  const fields = analysis.proposals.filter((p) => p.acroField && values[p.acroField.name] !== undefined).map((p) => ({
    fieldId: p.acroField!.name, label: p.detectedLabel, pageNumber: p.page, value: values[p.acroField!.name]!, geometry: p.geometry,
    formatting: { acroFieldName: p.acroField!.name, widgets: p.acroField!.widgets },
  }));
  return { source, fields };
}

test("native form fields are filled through the form itself and keep their values when not flattened", async () => {
  const { source, fields } = await nativeFields({ OfficerName: "Jordan A. Rivera", BadgeNo: "4471", SerialNo: "EXA123456", DutyWeapon: "Yes" });
  const result = await renderDocument(source, fields, { flatten: false });
  assert.deepEqual(result.issues, []);
  const form = (await PDFDocument.load(result.bytes)).getForm();
  assert.equal(form.getTextField("OfficerName").getText(), "Jordan A. Rivera");
  assert.equal(form.getTextField("BadgeNo").getText(), "4471");
  assert.equal(form.getTextField("SerialNo").getText(), "EXA123456");
  assert.equal(form.getCheckBox("DutyWeapon").isChecked(), true);
  // Untouched fields stay empty — nothing is invented.
  assert.equal(form.getTextField("SupervisorName").getText(), undefined);
});

test("flattened output is structurally clean: no dangling annotation references", async () => {
  const { source, fields } = await nativeFields({ OfficerName: "Jordan A. Rivera", BadgeNo: "4471" });
  const result = await renderDocument(source, fields);
  const output = await PDFDocument.load(result.bytes);
  for (const page of output.getPages()) {
    const annots = page.node.Annots();
    for (let index = 0; index < (annots?.size() ?? 0); index += 1) {
      const ref = annots!.get(index);
      assert.ok(output.context.lookup(ref as never), "every annotation reference must resolve");
    }
  }
  const poppler = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(result.bytes) });
  if (poppler.status === 0) assert.ok(!/Invalid XRef|Syntax Error/.test(poppler.stderr.toString()), poppler.stderr.toString());
});

test("flattened output has no editable fields and the ink lands inside each form box", { skip: noRaster }, async () => {
  const { source, fields } = await nativeFields({ OfficerName: "Jordan A. Rivera", BadgeNo: "4471" });
  const result = await renderDocument(source, fields);
  assert.deepEqual(result.issues, []);
  const output = await PDFDocument.load(result.bytes);
  assert.equal(output.getForm().getFields().length, 0);
  const raster = renderGray(result.bytes, 1, 100);
  for (const name of ["OfficerName", "BadgeNo"]) {
    const spec = QUALIFICATION_FORM_FIELDS.find((field) => field.name === name)!;
    const box = pdfRectToNormalized(spec, { x: 0, y: 0, width: 612, height: 792 }, 0)!;
    assert.ok(inkRatio(raster, box) > 0.02, `${name} should contain ink`);
  }
  // Nothing is drawn in the supervisor box, which was not mapped.
  const supervisor = QUALIFICATION_FORM_FIELDS.find((field) => field.name === "SupervisorName")!;
  assert.equal(inkRatio(raster, pdfRectToNormalized(supervisor, { x: 0, y: 0, width: 612, height: 792 }, 0)!), 0);
});

test("overlay text lands inside its box and reads upright on rotated and cropped pages", { skip: noRaster }, async () => {
  for (const rotation of [0, 90, 180, 270] as Rotation[]) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    page.setCropBox(36, 36, 540, 720);
    page.setRotation((await import("pdf-lib")).degrees(rotation));
    const display = rotation % 180 === 0 ? { w: 540, h: 720 } : { w: 720, h: 540 };
    const geometry = { x: 100 / display.w, y: 120 / display.h, width: 260 / display.w, height: 24 / display.h };
    const result = await renderDocument(await pdf.save(), [{ fieldId: "f", label: "Officer", pageNumber: 1, value: "JORDAN RIVERA 4471", geometry }]);
    assert.deepEqual(result.issues, [], `rotation ${rotation}`);
    const ink = inkBounds(renderGray(result.bytes, 1, 100))!;
    assert.ok(ink, `rotation ${rotation} should render text`);
    const slack = 0.01;
    assert.ok(ink.x >= geometry.x - slack && ink.x + ink.width <= geometry.x + geometry.width + slack, `rotation ${rotation}: text x-range ${ink.x}..${ink.x + ink.width} outside box ${geometry.x}..${geometry.x + geometry.width}`);
    assert.ok(ink.y >= geometry.y - slack && ink.y + ink.height <= geometry.y + geometry.height + slack, `rotation ${rotation}: text y-range outside box`);
    // Upright horizontal text is much wider than tall in display space.
    assert.ok(ink.width * display.w > ink.height * display.h * 4, `rotation ${rotation}: text should read horizontally`);
  }
});

test("text that cannot fit is reported instead of being silently cut off", async () => {
  const source = await PDFDocument.create(); source.addPage([612, 792]);
  const long = "Jordan Alexander Rivera-Montgomery of the Lakeview Township Police Department";
  const result = await renderDocument(await source.save(), [{ fieldId: "n", label: "Officer Name", pageNumber: 1, value: long, geometry: { x: 0.1, y: 0.1, width: 0.08, height: 0.02 } }]);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.kind, "overflow");
  await assert.rejects(renderAgencyDocument(await source.save(), [{ pageNumber: 1, value: long, geometry: { x: 0.1, y: 0.1, width: 0.08, height: 0.02 } }]), /too long/);
});

test("long text wraps inside a tall box rather than shrinking illegibly or truncating", async () => {
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const layout = layoutText(font, "Qualified with duty weapon on the day course; remedial training not required.", { width: 150, height: 60 }, 11, { multiline: true });
  assert.ok(layout && layout.lines.length > 1);
  assert.ok(layout!.size >= 9);
  assert.equal(wrapText(font, "Supercalifragilisticexpialidocious", 10, 20), null);
});

test("native field limits are enforced without altering the value", async () => {
  const source = await buildAcroFormPdf([{ fields: [{ name: "BadgeNo", x: 50, y: 700, width: 60, height: 18, maxLength: 4 }, { name: "Status", x: 50, y: 650, width: 100, height: 18, kind: "dropdown", options: ["Pass", "Fail"] }, { name: "Duty", x: 50, y: 600, width: 14, height: 14, kind: "checkbox" }] }]);
  const result = await renderDocument(source, [
    { fieldId: "b", label: "Badge", pageNumber: 1, value: "123456", geometry: { x: 0.1, y: 0.1, width: 0.1, height: 0.02 }, formatting: { acroFieldName: "BadgeNo" } },
    { fieldId: "s", label: "Status", pageNumber: 1, value: "Passed", geometry: { x: 0.1, y: 0.2, width: 0.1, height: 0.02 }, formatting: { acroFieldName: "Status" } },
    { fieldId: "d", label: "Duty", pageNumber: 1, value: "maybe", geometry: { x: 0.1, y: 0.3, width: 0.02, height: 0.02 }, formatting: { acroFieldName: "Duty" } },
    { fieldId: "x", label: "Gone", pageNumber: 1, value: "x", geometry: { x: 0.1, y: 0.4, width: 0.1, height: 0.02 }, formatting: { acroFieldName: "DeletedField" } },
  ], { flatten: false });
  assert.deepEqual(result.issues.map((issue) => issue.kind).sort(), ["form_field_missing", "invalid_checkbox_value", "not_an_option", "too_long"]);
  const ok = await renderDocument(source, [{ fieldId: "s", label: "Status", pageNumber: 1, value: "pass", geometry: { x: 0.1, y: 0.2, width: 0.1, height: 0.02 }, formatting: { acroFieldName: "Status" } }], { flatten: false });
  assert.deepEqual(ok.issues, []);
  assert.deepEqual((await PDFDocument.load(ok.bytes)).getForm().getDropdown("Status").getSelected(), ["Pass"]);
});

test("characters the document font cannot print are reported, not replaced", async () => {
  const source = await PDFDocument.create(); source.addPage([612, 792]);
  const result = await renderDocument(await source.save(), [{ fieldId: "n", label: "Officer Name", pageNumber: 1, value: "Łukasz Żółć", geometry: { x: 0.1, y: 0.1, width: 0.4, height: 0.03 } }]);
  assert.equal(result.issues[0]?.kind, "unsupported_characters");
});

test("fields placed on a page the PDF does not have are reported", async () => {
  const source = await PDFDocument.create(); source.addPage([612, 792]);
  const result = await renderDocument(await source.save(), [{ fieldId: "n", label: "Name", pageNumber: 3, value: "A", geometry: { x: 0.1, y: 0.1, width: 0.4, height: 0.03 } }]);
  assert.equal(result.issues[0]?.kind, "page_missing");
});

test("proof mode outlines every field placement so position can be checked visually", { skip: noRaster }, async () => {
  const source = await PDFDocument.create(); source.addPage([612, 792]);
  const geometry = { x: 0.2, y: 0.3, width: 0.4, height: 0.05 };
  const proof = await renderDocument(await source.save(), [{ fieldId: "a", label: "Case Number", pageNumber: 1, value: "", geometry, status: "missing" }], { mode: "proof" });
  const raster = renderGray(proof.bytes, 1, 100);
  // Border ink at the top edge of the box, empty interior.
  assert.ok(inkRatio(raster, { x: geometry.x, y: geometry.y - 0.002, width: geometry.width, height: 0.004 }, 200) > 0.3);
  assert.equal(inkRatio(raster, { x: geometry.x + 0.02, y: geometry.y + 0.01, width: geometry.width - 0.04, height: geometry.height - 0.02 }, 200), 0);
});

test("password-protected PDFs are refused with guidance", { skip: spawnSync("qpdf", ["--version"]).status !== 0 && "qpdf is not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "tp-enc-"));
  try {
    writeFileSync(join(dir, "in.pdf"), await buildQualificationForm());
    spawnSync("qpdf", ["--encrypt", "user", "owner", "256", "--", join(dir, "in.pdf"), join(dir, "out.pdf")]);
    await assert.rejects(renderDocument(new Uint8Array(readFileSync(join(dir, "out.pdf"))), []), /password-protected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
