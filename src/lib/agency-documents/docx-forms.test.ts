import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeDocx, docxPreviewHtml, docxText, fillDocx, DocxFormError, type DocxField } from "./docx-forms";
import { createZip, entryText, readZip } from "./docx-zip";
import { buildDocx, buildQualificationDocx, cell, legacyField, p, r, row, table } from "./__fixtures__/synthetic-docx";
import { analyzeTemplateDocx } from "./template-analyzer";

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

const mergedStart = (content: string) => `<w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${content}</w:tc>`;
const mergedContinue = () => `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`;
const checkboxField = (name: string) => `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${name}"/><w:checkBox><w:sizeAuto/><w:default w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;

test("cells that only look empty — merged continuations, symbols, images, fields — are never targets", () => {
  const symbolCell = `<w:tc><w:p><w:r><w:sym w:font="Wingdings" w:char="F0A8"/></w:r></w:p></w:tc>`;
  const source = buildDocx(table(
    row(mergedStart(p(r("Officer Name"))), cell("")),
    row(mergedContinue(), cell(p(r("x")))),
    row(cell(p(r("Duty weapon"))), symbolCell),
    row(cell(p(r("Case Number"))), cell(p(legacyField("CaseNo")))),
  ));
  const fields = analyzeDocx(source);
  const tableTargets = fields.filter((field) => field.kind === "table_cell").map((field) => field.label);
  assert.deepEqual(tableTargets, ["Officer Name"]);
  assert.equal(fields.filter((field) => field.kind === "legacy_field").length, 1);
  // Filling every detected target works without overlap errors and keeps the checkbox symbol.
  // The box symbol is a checkbox labelled by the cell to its left.
  assert.deepEqual(fields.filter((field) => field.kind === "checkbox").map((field) => field.label), ["Duty weapon"]);
  const filled = fillDocx(source, fields.map((field) => ({ target: field, value: field.kind === "checkbox" ? "Yes" : "V" })));
  assert.deepEqual(filled.issues, []);
  assert.ok(entryText(readZip(filled.bytes).find((entry) => entry.name === "word/document.xml")!).includes(`<w:sym w:font="Wingdings" w:char="F0FE"/>`));
});

test("a legacy checkbox before a text field does not steal the text field's label", () => {
  const source = buildDocx(p(r("Supervisor Review "), checkboxField("SupervisorReviewed"), r(" Officer Name: "), legacyField("Text1")));
  const fields = analyzeDocx(source).filter((field) => field.kind === "legacy_field");
  assert.deepEqual(fields.map((field) => field.label), ["Officer Name"]);
  const filled = fillDocx(source, [{ target: fields[0]!, value: "Jordan Rivera" }]);
  assert.match(docxText(filled.bytes), /Officer Name: Jordan Rivera/);
});

test("fields under a heading about another person are flagged for review, not auto-confirmed", () => {
  const source = buildDocx(p(r("OFFICER INFORMATION", "<w:b/>")) + table(row(cell(p(r("Badge Number"))), cell(""))) + p(r("SUPERVISOR INFORMATION", "<w:b/>")) + table(row(cell(p(r("Badge Number"))), cell(""))));
  const proposals = analyzeTemplateDocx(source).proposals;
  assert.deepEqual(proposals.map((proposal) => proposal.matchStatus), ["exact", "suggested"]);
  assert.match(proposals[1]!.rationale ?? "", /supervisor/i);
});

test("a token or placeholder prompt left blank is removed rather than printed", () => {
  const source = buildQualificationDocx();
  const fields = analyzeDocx(source);
  const token = fields.find((field) => field.label === "Officer Name")!;
  const control = fields.find((field) => field.kind === "content_control")!;
  const filled = fillDocx(source, [{ target: token, value: "" }, { target: control, value: "" }]);
  const text = docxText(filled.bytes);
  assert.ok(!text.includes("{{"));
  assert.ok(!text.includes("Click or tap here"));
});

test("the Word preview includes filled headers and footers", () => {
  const source = buildQualificationDocx();
  const header = analyzeDocx(source).find((field) => field.part === "word/header1.xml")!;
  const filled = fillDocx(source, [{ target: header, value: "Lakeview PD" }]);
  assert.ok(docxPreviewHtml(filled.bytes, ["Lakeview PD"]).includes("<header class=\"docx-header\"><p><mark>Lakeview PD</mark></p></header>"));
});

test("formatting is preserved: token runs keep their style, filled cells use the cell's own paragraph font", () => {
  const styled = `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/>`;
  const cellWithMarkFont = `<w:tc><w:p><w:pPr><w:rPr>${styled}</w:rPr></w:pPr></w:p></w:tc>`;
  const source = buildDocx(p(r("{{Officer Name}}", `<w:b/><w:u w:val="single"/>`)) + table(row(cell(p(r("Badge Number"))), cellWithMarkFont)));
  const fields = analyzeDocx(source);
  const filled = fillDocx(source, fields.map((field) => ({ target: field, value: field.label === "Officer Name" ? "Jordan Rivera" : "4471" })));
  const body = entryText(readZip(filled.bytes).find((entry) => entry.name === "word/document.xml")!);
  assert.match(body, /<w:rPr><w:b\/><w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">Jordan Rivera<\/w:t>/);
  assert.ok(body.includes(`<w:r><w:rPr>${styled}</w:rPr><w:t xml:space="preserve">4471</w:t></w:r>`), body);
  // Paragraph properties of the filled cell are untouched.
  assert.ok(body.includes(`<w:pPr><w:rPr>${styled}</w:rPr></w:pPr>`));
});

test("footer placeholders are detected, filled, and shown in the preview", async () => {
  const { createZip } = await import("./docx-zip");
  const base = readZip(buildDocx(p(r("Body"))));
  const files: Array<[string, string]> = base.map((entry) => [entry.name, entryText(entry)]);
  files.push(["word/footer1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p(r("Prepared by: {{Prepared By}}"))}</w:ftr>`]);
  const source = createZip(files);
  const footer = analyzeDocx(source).find((field) => field.part === "word/footer1.xml")!;
  assert.equal(footer.label, "Prepared By");
  const filled = fillDocx(source, [{ target: footer, value: "Sgt. Casey Morgan" }]);
  assert.ok(entryText(readZip(filled.bytes).find((entry) => entry.name === "word/footer1.xml")!).includes("Sgt. Casey Morgan"));
  assert.ok(docxPreviewHtml(filled.bytes).includes("<footer class=\"docx-footer\"><p>Prepared by: Sgt. Casey Morgan</p></footer>"));
});

test("images and drawings elsewhere in the document survive filling byte-for-byte in their XML", () => {
  const drawing = `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Seal"/></wp:inline></w:drawing></w:r>`;
  const source = buildDocx(p(drawing) + p(r("Officer: {{Officer Name}}")) + table(row(cell(p(r("Seal"))), `<w:tc><w:p>${drawing}</w:p></w:tc>`)));
  const fields = analyzeDocx(source);
  assert.deepEqual(fields.map((field) => field.label), ["Officer Name"]);
  const filled = fillDocx(source, [{ target: fields[0]!, value: "Jordan Rivera" }]);
  const body = entryText(readZip(filled.bytes).find((entry) => entry.name === "word/document.xml")!);
  assert.equal(body.split(drawing).length - 1, 2);
});

test("several placeholders in one text run are all filled (Word often saves a typed line as one run)", () => {
  const bytes = buildDocx(p(r("{{First Name}} {{Last Name}}")) + p(r("Name: ________   Badge: ________")) + p(r("Officer {{Officer Name}} Badge: ______")));
  const fields = analyzeDocx(bytes);
  assert.deepEqual(fields.map((field) => field.label), ["First Name", "Last Name", "Name", "Badge", "Officer Name", "Badge"]);
  const filled = fillAll(bytes, { "First Name": "Jordan", "Last Name": "Rivera", "Officer Name": "J. Rivera", Name: "Jordan Rivera", Badge: "287" });
  assert.deepEqual(filled.issues, []);
  assert.equal(docxText(filled.bytes), "Jordan Rivera\nName: Jordan Rivera   Badge: 287\nOfficer J. Rivera Badge: 287");
  // An empty value clears a token but keeps the blank line next to it.
  const cleared = fillDocx(bytes, analyzeDocx(bytes).slice(0, 2).map((field) => ({ target: field, value: field.label === "First Name" ? "Jordan" : "", label: field.label })));
  assert.equal(docxText(cleared.bytes).split("\n")[0], "Jordan ");
});

test("placeholders next to a checkbox control or a legacy form field are still found", () => {
  const checkbox = `<w:sdt><w:sdtPr><w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"/></w:sdtPr><w:sdtContent><w:r><w:sym w:font="Wingdings" w:char="F0A8"/></w:r></w:sdtContent></w:sdt>`;
  const bytes = buildDocx(`<w:p>${r("Qualified ")}${checkbox}${r(" {{Officer Name}}")}</w:p>` + p(r("Badge: "), legacyField("BadgeNumber"), r("   Unit: ______")));
  assert.deepEqual(analyzeDocx(bytes).map((field) => `${field.kind}:${field.label}`).sort(), ["checkbox:Qualified", "label_blank:Unit", "legacy_field:BadgeNumber", "token:Officer Name"]);
  const filled = fillAll(bytes, { "Officer Name": "Jordan Rivera", BadgeNumber: "287", Unit: "Patrol" });
  assert.deepEqual(filled.issues, []);
  const text = docxText(filled.bytes);
  assert.ok(!text.includes("{{"), text);
  assert.match(text, /Jordan Rivera/);
  assert.match(text, /287/);
  assert.match(text, /Unit: Patrol/);
  assert.ok(entryText(readZip(filled.bytes).find((entry) => entry.name === "word/document.xml")!).includes("w14:checkbox"));
});

test("content inside a building-block container is scanned", () => {
  const wrapped = `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Cover Pages"/></w:docPartObj></w:sdtPr><w:sdtContent>${p(r("{{Agency Name}}"))}</w:sdtContent></w:sdt>`;
  const filled = fillAll(buildDocx(wrapped), { "Agency Name": "Lakeview PD" });
  assert.equal(docxText(filled.bytes), "Lakeview PD");
});

test("a form laid out inside an outer one-cell table is detected, without inner text becoming headings", () => {
  const inner = table(row(cell(p(r("Officer Name"))), cell("")), row(cell(p(r("Badge"))), cell("")));
  const bytes = buildDocx(p(r("QUALIFICATION RECORD")) + table(row(cell(inner))));
  const fields = analyzeDocx(bytes);
  assert.deepEqual(fields.map((field) => field.label), ["Officer Name", "Badge"]);
  assert.ok(fields.every((field) => field.section === "QUALIFICATION RECORD"), JSON.stringify(fields.map((field) => field.section)));
  const filled = fillAll(bytes, { "Officer Name": "Jordan Rivera", Badge: "287" });
  assert.equal(docxText(filled.bytes), "QUALIFICATION RECORD\nOfficer Name\nJordan Rivera\nBadge\n287");
});

test("a blank's label does not include an earlier token, and a token cell is not a label for the next cell", () => {
  const bytes = buildDocx(p(r("Officer {{Officer Name}} Badge ______")) + table(row(cell(p(r("{{Officer Name}}"))), cell(""))));
  assert.deepEqual(analyzeDocx(bytes).map((field) => `${field.kind}:${field.label}`), ["token:Officer Name", "label_blank:Badge", "token:Officer Name"]);
});

test("preview highlighting never breaks the markup, even for short values", () => {
  const filled = fillAll(buildDocx(p(r("Grade: ______")) + p(r("Notes: ______", "<w:b/>"))), { Grade: "p", Notes: "strong & amp" });
  const html = docxPreviewHtml(filled.bytes, ["p", "strong & amp"]);
  assert.equal(html, "<p>Grade: <mark>p</mark></p><p><strong>Notes: <mark>strong &amp; amp</mark></strong></p>");
});

test("checkboxes separate the text around them, so blank labels do not absorb checkbox wording", () => {
  const box = `<w:sdt><w:sdtPr><w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"/></w:sdtPr><w:sdtContent><w:r><w:sym w:font="Wingdings" w:char="F0A8"/></w:r></w:sdtContent></w:sdt>`;
  const legacyBox = `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Check1"/><w:checkBox><w:sizeAuto/><w:default w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const bytes = buildDocx(`<w:p>${r("Yes ")}${box}${r(" No ")}${box}${r(" Date ____")}</w:p>` + `<w:p>${r("Passed ")}${legacyBox}${r(" Failed ")}${legacyBox}${r(" Instructor ____")}</w:p>`);
  assert.deepEqual(analyzeDocx(bytes).filter((field) => field.kind !== "checkbox").map((field) => field.label), ["Date", "Instructor"]);
  // The boxes themselves are labelled by the word before each one.
  assert.deepEqual(analyzeDocx(bytes).filter((field) => field.kind === "checkbox").map((field) => field.label), ["Yes", "No", "Passed", "Failed"]);
});

test("a legacy form field whose result runs into the next paragraph stays protected", () => {
  const begin = `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Notes"/><w:textInput/></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("First line")}`;
  const end = `${r("Comments: ________")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const fields = analyzeDocx(buildDocx(p(r("Notes: "), begin) + p(end)));
  assert.deepEqual(fields.map((field) => `${field.kind}:${field.label}`), ["legacy_field:Notes"]);
});

test("locators saved by an earlier version of Word detection are refused, not filled somewhere else", () => {
  const bytes = buildDocx(p(r("Officer: {{Officer Name}}")));
  const [field] = analyzeDocx(bytes);
  const { scheme: _scheme, ...old } = field!;
  void _scheme;
  const result = fillDocx(bytes, [{ target: old, value: "Jordan Rivera", fieldId: "f1" }]);
  assert.equal(result.issues[0]?.kind, "target_changed");
  assert.match(result.issues[0]!.message, /Set the template up again/);
  assert.equal(docxText(result.bytes), "Officer: {{Officer Name}}");
});

test("Word checkboxes — content controls, legacy FORMCHECKBOX fields and ☐ characters — are detected, asked for and ticked", async () => {
  const { planAutomaticSetup } = await import("./proposal-review");
  const { isCheckboxField } = await import("./document-generation");
  const w14 = `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"`;
  const control = `<w:sdt><w:sdtPr><w14:checkbox ${w14}><w14:checked w14:val="0"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt>`;
  const bytes = buildDocx(`<w:p>${control}${r(" Passed ")}${checkboxField("Check1")}${r(" Failed")}</w:p>` + p(r("☐ Remedial ☐ Other: ______")));
  const fields = analyzeDocx(bytes);
  assert.deepEqual(fields.map((field) => `${field.kind}:${field.label}`), ["checkbox:Passed", "checkbox:Failed", "checkbox:Remedial", "checkbox:Other", "label_blank:Other"]);
  // Setup turns every box into a question for the person generating; none is skipped or auto-filled.
  const proposals = analyzeTemplateDocx(bytes).proposals.filter((proposal) => proposal.docxTarget?.kind === "checkbox");
  assert.equal(proposals.length, 4);
  assert.ok(proposals.every((proposal) => !proposal.skipByDefault && !proposal.suggestedSemanticKey));
  const rows = planAutomaticSetup(proposals).rows;
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.field_type === "manual" && isCheckboxField({ formatting: row.formatting })));

  const value: Record<string, string> = { Passed: "Yes", Failed: "No", Remedial: "x", Other: "" };
  const filled = fillDocx(bytes, [...fields.filter((field) => field.kind === "checkbox").map((field) => ({ target: field, value: value[field.label]! })), { target: fields.find((field) => field.kind === "label_blank")!, value: "Night course" }]);
  assert.deepEqual(filled.issues, []);
  const xml = entryText(readZip(filled.bytes).find((entry) => entry.name === "word/document.xml")!);
  assert.match(xml, /<w14:checked w14:val="1"\/>/);
  assert.match(xml, /<w:checked w:val="0"\/><\/w:checkBox>/);
  assert.equal(docxText(filled.bytes), "☒ Passed  Failed\n☒ Remedial ☐ Other: Night course");

  const invalid = fillDocx(bytes, [{ target: fields[0]!, value: "Maybe", fieldId: "f1" }]);
  assert.equal(invalid.issues[0]?.kind, "invalid_checkbox_value");
});

test("a value written into an empty cell keeps the label's font and size but not its bold or underline", () => {
  const bytes = buildDocx(table(row(cell(p(r("Officer Name", `<w:b/><w:u w:val="single"/><w:sz w:val="20"/>`))), cell("")), row(cell(p(r("Rank", "<w:b/>"))), cell(""))));
  const filled = fillAll(bytes, { "Officer Name": "Jordan Rivera", Rank: "Sergeant" });
  assert.deepEqual(filled.issues, []);
  const html = docxPreviewHtml(filled.bytes);
  assert.match(html, /<td><p>Jordan Rivera<\/p><\/td>/);
  assert.match(html, /<td><p>Sergeant<\/p><\/td>/);
  assert.match(html, /<u><strong>Officer Name<\/strong><\/u>/);
  const xml = entryText(readZip(filled.bytes).find((entry) => entry.name === "word/document.xml")!);
  assert.match(xml, /<w:r><w:rPr><w:sz w:val="20"\/><\/w:rPr><w:t xml:space="preserve">Jordan Rivera<\/w:t><\/w:r>/);
  assert.match(xml, /<w:r><w:t xml:space="preserve">Sergeant<\/w:t><\/w:r>/);
});
