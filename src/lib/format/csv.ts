export type CsvValue = string | number | boolean | null | undefined;

// RFC 4180 records: quoted fields may contain commas, quotes ("") and line
// breaks. CRLF, LF and CR all end a record outside quotes. A leading BOM is
// dropped and blank lines are skipped. Cells are returned untrimmed.
export function parseCsvRecords(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  const endRecord = () => {
    record.push(field);
    if (record.length > 1 || record[0].trim().length > 0) records.push(record);
    record = [];
    field = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      endRecord();
    } else {
      field += character;
    }
  }
  if (field.length > 0 || record.length > 0) endRecord();
  return records;
}

// Spreadsheet applications evaluate a cell that starts with = + - @ (or a tab
// or carriage return before one) as a formula. Such text is prefixed with an
// apostrophe so it opens as text. Finite numbers are written as numbers.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown, alwaysQuote = false) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return alwaysQuote || /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

export function csvRow(values: readonly unknown[], alwaysQuote = false) {
  return values.map((value) => csvCell(value, alwaysQuote)).join(",");
}
