import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { csvCell, csvRow, parseCsvRecords } from "./csv.ts";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("ADM-25: a quoted multi-line cell stays in its record and column", () => {
  const text = 'Serial,Notes,Status\r\nA-1,"Line one\nLine two, with comma",Active\r\nA-2,"He said ""hold""",Retired\n';
  assert.deepEqual(parseCsvRecords(text), [
    ["Serial", "Notes", "Status"],
    ["A-1", "Line one\nLine two, with comma", "Active"],
    ["A-2", 'He said "hold"', "Retired"],
  ]);
});

test("ADM-25: BOM, CR-only line ends, blank lines and a missing final newline are handled", () => {
  assert.deepEqual(parseCsvRecords("\uFEFFa,b\r\r1,2\r\n\n3,"), [["a", "b"], ["1", "2"], ["3", ""]]);
  assert.deepEqual(parseCsvRecords(""), []);
  assert.deepEqual(parseCsvRecords(',,\n'), [["", "", ""]]);
});

test("ADM-25: cells starting with = + - @ tab or CR open as text", () => {
  for (const value of ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"]) {
    assert.ok(csvCell(value).replace(/^"/, "").startsWith("'"), JSON.stringify(value));
  }
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("=A1,B1"), "\"'=A1,B1\"");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("Smith, J"), '"Smith, J"');
  assert.equal(csvCell('say "hi"', true), '"say ""hi"""');
  assert.equal(csvCell(null), "");
  assert.equal(csvRow(["a", "=b", 3], true), '"a","\'=b",3');
});

test("ADM-25: a written row parses back to the same text, apart from the formula guard", () => {
  const values = ["multi\nline", 'quote "x"', "comma, here", "plain"];
  assert.deepEqual(parseCsvRecords(csvRow(values)), [values]);
});

test("ADM-25: every CSV writer and the classic importer use the shared module", () => {
  const page = source("../../app/settings/import-export/page.tsx");
  assert.match(page, /const records = parseCsvRecords\(text\);/);
  assert.doesNotMatch(page, /function csvEscape|function splitCsvLine|normalized\.split\("\\n"\)/);
  assert.match(page, /csvRow\(headers\),\s*\.\.\.rows\.map\(\(row\) => csvRow\(headers\.map\(\(header\) => row\[header\]\)\)\),/);
  assert.match(source("../../app/settings/page.tsx"), /const escape = \(value: unknown\) => csvCell\(value, true\);/);
  assert.match(source("../../app/api/agency-training/events/[eventId]/report/route.ts"), /function csv\(value: unknown\) \{ return csvCell\(value, true\); \}/);
  assert.match(source("../../app/settings/import-export/ai-importer/page.tsx"), /return sharedCsvCell\(value, true\);/);
});
