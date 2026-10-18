import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeDocx, docxPreviewHtml, docxText, fillDocx, DocxFormError, type DocxField } from "./docx-forms";
import { createZip, entryText, readZip } from "./docx-zip";
import { buildDocx, buildQualificationDocx, cell, p, r, row, table } from "./__fixtures__/synthetic-docx";

const office = spawnSync("soffice", ["--version"]).status === 0;

function fillAll(bytes: Uint8Array, values: Record<string, string>) {
  const fields = analyzeDocx(bytes);
  const fills = fields.filter((field) => values[field.label] !== undefined).map((field) => ({ target: field, value: values[field.label]!, label: field.label }));
  return fillDocx(bytes, fills);
}

test("detects every supported placeholder style in a Word form, including headers", () => {
  const fields = analyzeDocx(buildQualificationDocx());
  const byKind = (kind: DocxField["kind"]) => fields.filter((field) => field.kind === kind).map((field) => field.label);
  assert.deepEqual(byKind("token"), ["Officer Name", "Agency Name"]);
  assert.deepEqual(byKind("label_blank"), ["Badge Number", "Rank", "Date of Report", "Supervisor Name", "Officer Signature"]);
  assert.deepEqual(byKind("table_cell"), ["Manufacturer", "Serial Number", "Model", "Score", "Pass/Fail", "Instructor Name"]);
  assert.deepEqual(byKind("content_control"), ["Caliber"]);
  assert.deepEqual(byKind("legacy_field"), ["CaseNo"]);
  assert.equal(fields.find((field) => field.label === "Agency Name")!.part, "word/header1.xml");
});

test("fills values in place and leaves untouched placeholders alone", () => {
  const source = buildQualificationDocx();
  const { bytes, issues } = fillAll(source, {
    "Officer Name": "Jordan A. Rivera", "Agency Name": "Lakeview Township Police Department", "Badge Number": "4471", Rank: "Patrol Officer", "Date of Report": "10/18/2026",
    Manufacturer: "Example Arms", "Serial Number": "EXA123456", Model: "EA-19", Score: "287", "Pass/Fail": "Pass", "Instructor Name": "Taylor Brooks", Caliber: "9mm", CaseNo: "26-001234",
  });
  assert.deepEqual(issues, []);
  const text = docxText(bytes);
  for (const expected of ["Officer: Jordan A. Rivera", "Badge Number: 4471", "Rank: Patrol Officer", "Date of Report: 10/18/2026", "Example Arms", "EXA123456", "EA-19", "287", "Pass", "Taylor Brooks", "Caliber: 9mm", "Case Number: 26-001234"]) assert.ok(text.includes(expected), `missing "${expected}" in:\n${text}`);
  // Unmapped blanks stay as blank lines; nothing is invented.
  assert.ok(text.includes("Supervisor Name: ______________________"));
  assert.ok(text.includes("Officer Signature: ______________________"));
  assert.ok(!text.includes("{{"));
  // Header value
  const header = entryText(readZip(bytes).find((entry) => entry.name === "word/header1.xml")!);
  assert.ok(header.includes("Lakeview Township Police Department"));
  // The content control no longer shows placeholder styling.
  const body = entryText(readZip(bytes).find((entry) => entry.name === "word/document.xml")!);
  assert.ok(!body.includes("<w:showingPlcHdr/>"));
  assert.ok(!body.includes("Click or tap here"));
  // Formatting of the token run is kept (bold).
  assert.match(body, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Jordan A\. Rivera<\/w:t>/);
});

test("parts that were not filled are copied byte-for-byte", () => {
  const source = buildQualificationDocx();
  const { bytes } = fillAll(source, { "Officer Name": "Jordan A. Rivera" });
  const before = readZip(source), after = readZip(bytes);
  assert.deepEqual(after.map((entry) => entry.name), before.map((entry) => entry.name));
  for (const entry of before.filter((item) => item.name !== "word/document.xml")) {
    const same = after.find((item) => item.name === entry.name)!;
    assert.deepEqual(Buffer.from(same.compressed), Buffer.from(entry.compressed), entry.name);
  }
});

test("special characters and multi-line values are written safely", () => {
  const source = buildDocx(p(r("Remarks: {{Remarks}}")) + p(r("Name: {{Name}}")));
  const { bytes, issues } = fillAll(source, { Remarks: "Line one <b>&\nLine two", Name: "O'Brien & Sons \"Jr.\"" });
  assert.deepEqual(issues, []);
  const text = docxText(bytes);
  assert.ok(text.includes("Line one <b>&\nLine two"));
  assert.ok(text.includes("O'Brien & Sons \"Jr.\""));
  const body = entryText(readZip(bytes).find((entry) => entry.name === "word/document.xml")!);
  assert.ok(body.includes("&lt;b&gt;&amp;"));
  assert.ok(body.includes("<w:br/>"));
});

test("a token split across several runs (as Word often saves it) is still found and replaced", () => {
  const source = buildDocx(p(r("Officer: "), r("{{Offi"), r("cer Na", "<w:i/>"), r("me}}")));
  const fields = analyzeDocx(source);
  assert.deepEqual(fields.map((field) => field.label), ["Officer Name"]);
  const { bytes } = fillDocx(source, [{ target: fields[0]!, value: "Jordan Rivera" }]);
  assert.equal(docxText(bytes), "Officer: Jordan Rivera");
});

test("a header row over several empty rows is flagged as a list, not a single record", () => {
  const source = buildDocx(table(row(cell(p(r("Officer Name"))), cell(p(r("Badge")))), row(cell(""), cell("")), row(cell(""), cell("")), row(cell(""), cell(""))));
  const fields = analyzeDocx(source);
  assert.equal(fields.length, 2);
  assert.ok(fields.every((field) => field.repeating));
});

test("a changed or missing locator is reported instead of filling the wrong place", () => {
  const source = buildQualificationDocx();
  const badge = analyzeDocx(source).find((field) => field.label === "Badge Number")!;
  const moved = fillDocx(source, [{ target: { ...badge, label: "Rank" }, value: "4471", fieldId: "f1" }]);
  assert.equal(moved.issues[0]?.kind, "target_changed");
  const missing = fillDocx(source, [{ target: { ...badge, ordinal: 99 }, value: "4471", fieldId: "f2" }]);
  assert.equal(missing.issues[0]?.kind, "target_missing");
  assert.ok(!docxText(moved.bytes).includes("4471"));
});

test("non-Word (including encrypted Office files), macro-enabled and damaged files fail with readable errors", () => {
  assert.throws(() => analyzeDocx(new TextEncoder().encode("%PDF-1.7")), (error: unknown) => error instanceof DocxFormError && /not a Word/.test(error.message));
  assert.throws(() => analyzeDocx(createZip([["readme.txt", "hello"]])), /word\/document.xml is missing/);
  assert.throws(() => analyzeDocx(createZip([["word/document.xml", "<w:document/>"], ["word/vbaProject.bin", "x"]])), /Macro-enabled/);
  const damaged = buildQualificationDocx().slice(0, 200);
  assert.throws(() => analyzeDocx(damaged), DocxFormError);
});

test("preview HTML shows the completed content with filled values highlighted", () => {
  const { bytes } = fillAll(buildQualificationDocx(), { "Officer Name": "Jordan A. Rivera", Score: "287" });
  const html = docxPreviewHtml(bytes, ["Jordan A. Rivera", "287"]);
  assert.ok(html.includes("<mark>Jordan A. Rivera</mark>"));
  assert.ok(html.includes("<table>"));
  assert.ok(!html.includes("<script"));
});

test("the completed file opens in an office suite and prints the values", { skip: !office && "LibreOffice is not installed" }, () => {
  const { bytes } = fillAll(buildQualificationDocx(), { "Officer Name": "Jordan A. Rivera", "Badge Number": "4471", Manufacturer: "Example Arms", Caliber: "9mm", CaseNo: "26-001234", "Agency Name": "Lakeview Township Police Department" });
  const dir = mkdtempSync(join(tmpdir(), "tp-docx-"));
  try {
    writeFileSync(join(dir, "filled.docx"), bytes);
    const convert = spawnSync("soffice", ["--headless", `-env:UserInstallation=file://${join(dir, "profile")}`, "--convert-to", "pdf", "--outdir", dir, join(dir, "filled.docx")], { timeout: 120000 });
    assert.equal(convert.status, 0, convert.stderr?.toString());
    const pdf = readdirSync(dir).find((name) => name.endsWith(".pdf"));
    assert.ok(pdf, "conversion should produce a PDF");
    const text = spawnSync("pdftotext", ["-layout", join(dir, pdf!), "-"]).stdout.toString();
    for (const expected of ["Jordan A. Rivera", "4471", "Example Arms", "9mm", "26-001234", "Lakeview Township Police Department"]) assert.ok(text.includes(expected), `${expected} should print`);
    void readFileSync;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
