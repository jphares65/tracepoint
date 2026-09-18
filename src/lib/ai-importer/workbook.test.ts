import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { explicitApprovalComplete } from "./approval.ts";
import { DeterministicInferenceProvider, inferImport, inferenceInput, validateProviderOutput } from "./provider.ts";
import { parseImportDate } from "./normalize.ts";
import { parseImportPayload, validateMappings } from "./validation.ts";
import { inferHeaderRow, materializeSheet, parseWorkbook } from "./workbook.ts";

const encoder = new TextEncoder();

function file(domain = "personnel") {
  return { name: "agency.csv", size: 80, sha256: "a".repeat(64), type: "text/csv", sheetCount: 1, domain };
}

test("parses CSV safely, preserves quoted values, and infers a non-first header row", () => {
  const csv = "Agency roster export\r\nGenerated 9/1/2026\r\nBadge Number,First Name,Last Name,Email\r\n101,Jane,Doe,\"jane@example.gov\"\r\n";
  const sheets = parseWorkbook(encoder.encode(csv), "roster.csv");
  assert.equal(sheets.length, 1);
  assert.equal(inferHeaderRow(sheets[0].matrix), 3);
  const data = materializeSheet(sheets[0].matrix, 3);
  assert.equal(data.rows[0].source.Email, "jane@example.gov");
});

test("parses XLSX and legacy XLS workbooks with multiple worksheets", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Badge", "First Name", "Last Name"], ["1", "A", "B"]]), "Personnel");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["VIN", "Unit Number"], ["1HGCM82633A004352", "12"]]), "Fleet");
  const xlsx = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const xls = XLSX.write(workbook, { type: "array", bookType: "xls" }) as ArrayBuffer;
  assert.deepEqual(parseWorkbook(new Uint8Array(xlsx), "agency.xlsx").map((sheet) => sheet.name), ["Personnel", "Fleet"]);
  assert.equal(parseWorkbook(new Uint8Array(xls), "agency.xls").length, 2);
});

test("rejects unsupported and signature-mismatched files with clear errors", () => {
  assert.throws(() => parseWorkbook(encoder.encode("a,b"), "agency.txt"), /Unsupported file type/);
  assert.throws(() => parseWorkbook(encoder.encode("not a zip"), "agency.xlsx"), /valid XLSX/);
});

test("structured inference detects domains without relying on filenames", async () => {
  const sheets = parseWorkbook(encoder.encode("VIN,Unit Number,Make,Model\n1HGCM82633A004352,12,Ford,Explorer"), "data.csv");
  const result = await inferImport(sheets, new DeterministicInferenceProvider());
  assert.equal(result.domain, "vehicles");
  assert.equal(result.mappings.find((mapping) => mapping.sourceColumn === "VIN")?.targetField, "vin");
});

test("malformed or unavailable inference falls back while strict schema rejects tenant injection", async () => {
  const sheets = parseWorkbook(encoder.encode("Serial Number,Make,Model,Caliber\nABC,Glock,17,9mm"), "plain.csv");
  const fallback = await inferImport(sheets, { name: "broken", async infer() { return { departmentId: "forged" }; } });
  assert.equal(fallback.usedFallback, true);
  const unavailable = await inferImport(sheets, { name: "offline", async infer() { throw new Error("provider secret and raw row must not leak"); } });
  assert.equal(unavailable.usedFallback, true);
  assert.doesNotMatch(unavailable.notes.join(" "), /provider secret|raw row/);
  const input = inferenceInput(sheets);
  const valid = await new DeterministicInferenceProvider().infer(input) as Record<string, unknown>;
  assert.throws(() => validateProviderOutput({ ...valid, departmentId: "forged" }, input), /unexpected structure/);
});

test("manual mapping overrides, ignored unknown columns, and forged department IDs are deterministic", () => {
  const payload = parseImportPayload({
    file: file(), departmentId: "forged", domain: "personnel", sheetName: "Sheet1", headerRow: 1,
    matrix: [["Badge", "Given", "Surname", "Email", "Helper"], ["7", "Ann", "Lee", "ann@example.gov", "ignore me"]],
    mappings: [
      { sourceColumn: "Badge", targetField: "badgeNumber", confidence: "High", samples: [] },
      { sourceColumn: "Given", targetField: "firstName", confidence: "Needs Review", samples: [] },
      { sourceColumn: "Surname", targetField: "lastName", confidence: "Needs Review", samples: [] },
      { sourceColumn: "Email", targetField: "email", confidence: "High", samples: [] },
      { sourceColumn: "Helper", targetField: null, confidence: "Needs Review", samples: [] },
    ],
  });
  assert.equal("departmentId" in payload, false);
  const mapped = validateMappings(payload);
  assert.deepEqual(mapped.issues, []);
  assert.equal(mapped.mappedRows[0].values.firstName, "Ann");
  assert.equal("Helper" in mapped.mappedRows[0].values, false);
});

test("normalizes supported dates and flags ambiguous or malformed dates", () => {
  assert.equal(parseImportDate("2026-09-07").value, "2026-09-07");
  assert.equal(parseImportDate("9/7/2026").value, "2026-09-07");
  assert.match(parseImportDate("1/2/2026").warning ?? "", /Ambiguous/);
  assert.equal(parseImportDate("45500").value, "2024-07-27");
  assert.match(parseImportDate("not-a-date").error ?? "", /not a supported date/);
});

test("all four administrator approvals are mandatory", () => {
  assert.equal(explicitApprovalComplete(true), false);
  assert.equal(explicitApprovalComplete({ domain: true, mappings: true, validation: true, finalAction: false }), false);
  assert.equal(explicitApprovalComplete({ domain: true, mappings: true, validation: true, finalAction: true }), true);
});
