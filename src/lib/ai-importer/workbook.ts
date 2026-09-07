import * as XLSX from "xlsx";

import { IMPORT_FIELDS } from "./catalog.ts";
import { cleanText, normalizeLabel } from "./normalize.ts";
import type { ImportDomain, ParsedSheet } from "./types.ts";

export const MAX_IMPORT_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_IMPORT_SHEETS = 50;
export const MAX_IMPORT_ROWS_PER_SHEET = 10_000;
export const MAX_IMPORT_COLUMNS = 150;
export const MAX_IMPORT_CELL_LENGTH = 4_000;
export const MAX_IMPORT_TOTAL_CHARACTERS = 1_500_000;

const SUPPORTED_EXTENSIONS = new Set(["csv", "xlsx", "xls"]);

function extension(filename: string) {
  return filename.toLowerCase().split(".").pop() ?? "";
}

function validateSignature(bytes: Uint8Array, ext: string) {
  if (ext === "xlsx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error("The file does not appear to be a valid XLSX workbook.");
    }
  }
  if (ext === "xls") {
    const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (!ole.every((value, index) => bytes[index] === value)) {
      throw new Error("The file does not appear to be a valid legacy XLS workbook.");
    }
  }
}

function uniqueHeaderNames(row: string[]) {
  const seen = new Map<string, number>();
  return row.map((value, index) => {
    const base = cleanText(value, 250) || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

export function inferHeaderRow(matrix: string[][]) {
  const aliases = new Set(
    Object.values(IMPORT_FIELDS).flatMap((fields) =>
      fields.flatMap((field) => [field.label, ...field.aliases]).map(normalizeLabel),
    ),
  );
  let best = { row: 1, score: Number.NEGATIVE_INFINITY };
  const limit = Math.min(matrix.length, 25);

  for (let index = 0; index < limit; index += 1) {
    const values = (matrix[index] ?? []).map((value) => cleanText(value, 250));
    const nonempty = values.filter(Boolean);
    if (nonempty.length === 0) continue;
    const normalized = nonempty.map(normalizeLabel);
    const unique = new Set(normalized).size;
    const aliasMatches = normalized.filter((value) => aliases.has(value)).length;
    const textLike = nonempty.filter((value) => !/^[-+]?\d+(\.\d+)?$/.test(value)).length;
    const nextRows = matrix.slice(index + 1, index + 4);
    const populatedBelow = nextRows.filter((row) => row.filter((value) => cleanText(value)).length >= Math.max(1, Math.floor(nonempty.length / 2))).length;
    const score = nonempty.length * 2 + unique + aliasMatches * 7 + textLike + populatedBelow * 3 - index * 0.15;
    if (score > best.score) best = { row: index + 1, score };
  }

  return best.row;
}

export function materializeSheet(matrix: string[][], headerRow: number) {
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > matrix.length) {
    throw new Error("The selected header row is outside the worksheet.");
  }
  const headers = uniqueHeaderNames(matrix[headerRow - 1] ?? []);
  const rows = matrix
    .slice(headerRow)
    .map((values, offset) => ({ values, rowNumber: headerRow + offset + 1 }))
    .filter(({ values }) => values.some((value) => cleanText(value).length > 0))
    .map(({ values, rowNumber }) => ({
      rowNumber,
      source: Object.fromEntries(headers.map((header, index) => [header, cleanText(values[index] ?? "", MAX_IMPORT_CELL_LENGTH)])),
    }));
  return { headers, rows };
}

export function parseWorkbook(bytes: Uint8Array, filename: string): ParsedSheet[] {
  const ext = extension(filename);
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported file type. Upload a CSV, XLSX, or XLS file.");
  }
  if (bytes.byteLength === 0) throw new Error("The uploaded file is empty.");
  if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error(`The file is larger than the ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB import limit.`);
  }
  validateSignature(bytes, ext);

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      cellNF: false,
      cellStyles: false,
      bookVBA: false,
      password: undefined,
    });
  } catch {
    throw new Error("TracePoint could not safely read this spreadsheet. It may be damaged, encrypted, or unsupported.");
  }

  if (workbook.SheetNames.length === 0) throw new Error("The workbook does not contain any worksheets.");
  if (workbook.SheetNames.length > MAX_IMPORT_SHEETS) {
    throw new Error(`The workbook has more than ${MAX_IMPORT_SHEETS} worksheets.`);
  }

  let totalCharacters = 0;
  const sheets = workbook.SheetNames.map((name) => {
    const worksheet = workbook.Sheets[name];
    if (!worksheet) throw new Error(`Worksheet "${cleanText(name, 100)}" could not be read.`);
    const ref = worksheet["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      const claimedRows = range.e.r - range.s.r + 1;
      const claimedColumns = range.e.c - range.s.c + 1;
      if (claimedRows > MAX_IMPORT_ROWS_PER_SHEET + 25) throw new Error(`Worksheet "${cleanText(name, 100)}" exceeds the ${MAX_IMPORT_ROWS_PER_SHEET.toLocaleString()}-row limit.`);
      if (claimedColumns > MAX_IMPORT_COLUMNS) throw new Error(`Worksheet "${cleanText(name, 100)}" exceeds the ${MAX_IMPORT_COLUMNS}-column limit.`);
    }

    const raw = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    });
    const matrix = raw
      .map((row) => (Array.isArray(row) ? row.slice(0, MAX_IMPORT_COLUMNS).map((cell) => cleanText(cell, MAX_IMPORT_CELL_LENGTH)) : []))
      .filter((row, index, all) => row.some(Boolean) || index < all.findLastIndex((candidate) => candidate.some(Boolean)));
    for (const row of matrix) for (const cell of row) totalCharacters += cell.length;
    if (totalCharacters > MAX_IMPORT_TOTAL_CHARACTERS) throw new Error("The expanded workbook is too large to import safely.");
    const probableHeaderRow = inferHeaderRow(matrix);
    const data = materializeSheet(matrix, probableHeaderRow);
    return {
      name: cleanText(name, 100) || "Worksheet",
      matrix,
      rowCount: data.rows.length,
      columnCount: data.headers.length,
      probableHeaderRow,
    };
  }).filter((sheet) => sheet.matrix.some((row) => row.some(Boolean)));

  if (sheets.length === 0) throw new Error("The workbook does not contain any data rows.");
  return sheets;
}

export function domainScores(headers: string[]) {
  const normalized = headers.map(normalizeLabel);
  return Object.fromEntries(
    (Object.keys(IMPORT_FIELDS) as ImportDomain[]).map((domain) => {
      const fields = IMPORT_FIELDS[domain];
      let score = 0;
      for (const header of normalized) {
        for (const field of fields) {
          const aliases = [field.label, ...field.aliases].map(normalizeLabel);
          if (aliases.includes(header)) score += field.required ? 5 : 2;
          else if (aliases.some((alias) => alias.length > 3 && (header.includes(alias) || alias.includes(header)))) score += 1;
        }
      }
      return [domain, score];
    }),
  ) as Record<ImportDomain, number>;
}
