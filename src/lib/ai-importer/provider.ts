import { IMPORT_FIELDS } from "./catalog.ts";
import { normalizeLabel } from "./normalize.ts";
import { domainScores, materializeSheet } from "./workbook.ts";
import { IMPORT_DOMAINS, type ColumnMapping, type ImportDomain, type ImportInterpretation, type MappingConfidence, type ParsedSheet } from "./types.ts";

export type InferenceSheet = {
  name: string;
  probableHeaderRow: number;
  headers: string[];
  samples: string[][];
  rowCount: number;
  matrixRowCount: number;
};

export type InferenceInput = { sheets: InferenceSheet[] };

export interface ImportInferenceProvider {
  readonly name: string;
  infer(input: InferenceInput): Promise<unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isConfidence(value: unknown): value is MappingConfidence {
  return value === "High" || value === "Medium" || value === "Needs Review";
}

export function validateProviderOutput(value: unknown, input: InferenceInput): Omit<ImportInterpretation, "provider" | "usedFallback"> {
  if (!isRecord(value) || !exactKeys(value, ["domain", "sheetName", "headerRow", "mappings", "likelyDateFormats", "identifierColumns", "nameColumns", "ignoredColumns", "notes"])) {
    throw new Error("AI inference returned an unexpected structure.");
  }
  if (!IMPORT_DOMAINS.includes(value.domain as ImportDomain)) throw new Error("AI inference returned an unsupported domain.");
  const sheet = input.sheets.find((item) => item.name === value.sheetName);
  if (!sheet) throw new Error("AI inference returned an unknown worksheet.");
  if (!Number.isInteger(value.headerRow) || Number(value.headerRow) < 1 || Number(value.headerRow) > Math.min(25, sheet.matrixRowCount)) throw new Error("AI inference returned an invalid header row.");
  if (!Array.isArray(value.mappings)) throw new Error("AI inference mappings are invalid.");
  const allowedFields = new Set(IMPORT_FIELDS[value.domain as ImportDomain].map((field) => field.key));
  const mappings = value.mappings.map((mapping): ColumnMapping => {
    if (!isRecord(mapping) || !exactKeys(mapping, ["sourceColumn", "targetField", "confidence", "samples", "reason"])) throw new Error("AI inference returned a malformed mapping.");
    if (typeof mapping.sourceColumn !== "string" || !sheet.headers.includes(mapping.sourceColumn)) throw new Error("AI inference mapped an unknown source column.");
    if (mapping.targetField !== null && (typeof mapping.targetField !== "string" || !allowedFields.has(mapping.targetField))) throw new Error("AI inference mapped an unsupported target field.");
    if (!isConfidence(mapping.confidence)) throw new Error("AI inference returned an invalid confidence level.");
    if (!Array.isArray(mapping.samples) || mapping.samples.some((sample) => typeof sample !== "string")) throw new Error("AI inference samples are invalid.");
    if (typeof mapping.reason !== "string") throw new Error("AI inference mapping reason is invalid.");
    return { sourceColumn: mapping.sourceColumn.slice(0, 250), targetField: mapping.targetField, confidence: mapping.confidence, samples: mapping.samples.slice(0, 3).map((sample) => sample.slice(0, 250)), reason: mapping.reason.slice(0, 300) };
  });
  if (mappings.length !== sheet.headers.length || new Set(mappings.map((mapping) => mapping.sourceColumn)).size !== sheet.headers.length) throw new Error("AI inference must account for every source column exactly once.");
  const stringArray = (candidate: unknown, label: string) => {
    if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string")) throw new Error(`AI inference ${label} are invalid.`);
    return candidate.slice(0, 50).map((item) => String(item).slice(0, 300));
  };
  return {
    domain: value.domain as ImportDomain,
    sheetName: sheet.name,
    headerRow: Number(value.headerRow),
    mappings,
    likelyDateFormats: stringArray(value.likelyDateFormats, "date formats"),
    identifierColumns: stringArray(value.identifierColumns, "identifier columns").filter((column) => sheet.headers.includes(column)),
    nameColumns: stringArray(value.nameColumns, "name columns").filter((column) => sheet.headers.includes(column)),
    ignoredColumns: stringArray(value.ignoredColumns, "ignored columns").filter((column) => sheet.headers.includes(column)),
    notes: stringArray(value.notes, "notes"),
  };
}

function mappingFor(headers: string[], samples: string[][], domain: ImportDomain): ColumnMapping[] {
  const used = new Set<string>();
  return headers.map((sourceColumn, columnIndex) => {
    const normalized = normalizeLabel(sourceColumn);
    let targetField: string | null = null;
    let confidence: MappingConfidence = "Needs Review";
    let reason = "No reliable TracePoint field match was found; review or ignore this column.";
    for (const field of IMPORT_FIELDS[domain]) {
      if (used.has(field.key)) continue;
      const aliases = [field.label, ...field.aliases].map(normalizeLabel);
      if (aliases.includes(normalized)) {
        targetField = field.key;
        confidence = "High";
        reason = "The source heading matches a known agency term for this field.";
        break;
      }
    }
    if (!targetField) {
      const candidates = IMPORT_FIELDS[domain].filter((field) => !used.has(field.key) && [field.label, ...field.aliases].map(normalizeLabel).some((alias) => alias.length > 3 && (normalized.includes(alias) || alias.includes(normalized))));
      if (candidates.length === 1) {
        targetField = candidates[0].key;
        confidence = "Medium";
        reason = "The source heading is similar to a known agency term.";
      }
    }
    if (targetField) used.add(targetField);
    return { sourceColumn, targetField, confidence, samples: samples.map((row) => row[columnIndex] ?? "").filter(Boolean).slice(0, 3), reason };
  });
}

export class DeterministicInferenceProvider implements ImportInferenceProvider {
  readonly name = "deterministic-development";

  async infer(input: InferenceInput) {
    let selected: { sheet: InferenceSheet; domain: ImportDomain; score: number } | null = null;
    for (const sheet of input.sheets) {
      const scores = domainScores(sheet.headers);
      for (const domain of IMPORT_DOMAINS) {
        const score = scores[domain] + Math.min(sheet.rowCount, 25) * 0.02;
        if (!selected || score > selected.score) selected = { sheet, domain, score };
      }
    }
    if (!selected) throw new Error("No importable worksheet was found.");
    const { sheet, domain } = selected;
    const mappings = mappingFor(sheet.headers, sheet.samples, domain);
    const dateColumns = mappings.filter((mapping) => mapping.targetField && IMPORT_FIELDS[domain].find((field) => field.key === mapping.targetField)?.kind === "date").map((mapping) => mapping.sourceColumn);
    const identifierColumns = mappings.filter((mapping) => /id|number|serial|vin|plate|badge/i.test(mapping.targetField ?? "")).map((mapping) => mapping.sourceColumn);
    const nameColumns = mappings.filter((mapping) => /name|personnel|make|model|title|type/i.test(mapping.targetField ?? "")).map((mapping) => mapping.sourceColumn);
    const ignoredColumns = mappings.filter((mapping) => mapping.targetField === null).map((mapping) => mapping.sourceColumn);
    return {
      domain,
      sheetName: sheet.name,
      headerRow: sheet.probableHeaderRow,
      mappings,
      likelyDateFormats: dateColumns.length ? ["YYYY-MM-DD", "MM/DD/YYYY", "Excel date serial"] : [],
      identifierColumns,
      nameColumns,
      ignoredColumns,
      notes: ["Review all Needs Review mappings before validation.", "Empty incoming cells never erase existing TracePoint values."],
    };
  }
}

class UnavailableProvider implements ImportInferenceProvider {
  readonly name = "unavailable";
  async infer(): Promise<unknown> { throw new Error("Configured inference provider is unavailable."); }
}

export function configuredProvider(): ImportInferenceProvider {
  return process.env.TRACEPOINT_IMPORT_AI_PROVIDER === "unavailable"
    ? new UnavailableProvider()
    : new DeterministicInferenceProvider();
}

export function inferenceInput(sheets: ParsedSheet[]): InferenceInput {
  return {
    sheets: sheets.map((sheet) => {
      const materialized = materializeSheet(sheet.matrix, sheet.probableHeaderRow);
      return {
        name: sheet.name,
        probableHeaderRow: sheet.probableHeaderRow,
        headers: materialized.headers,
        samples: materialized.rows.slice(0, 3).map((row) => materialized.headers.map((header) => row.source[header] ?? "")),
        rowCount: materialized.rows.length,
        matrixRowCount: sheet.matrix.length,
      };
    }),
  };
}

export async function inferImport(sheets: ParsedSheet[], provider = configuredProvider()): Promise<ImportInterpretation> {
  const input = inferenceInput(sheets);
  try {
    const output = validateProviderOutput(await provider.infer(input), input);
    return { ...output, provider: provider.name, usedFallback: false };
  } catch {
    const fallback = new DeterministicInferenceProvider();
    const output = validateProviderOutput(await fallback.infer(input), input);
    return { ...output, provider: fallback.name, usedFallback: true, notes: [...output.notes, "AI inference was unavailable or invalid, so TracePoint used deterministic field matching."] };
  }
}
