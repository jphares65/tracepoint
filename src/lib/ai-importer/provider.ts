import { IMPORT_FIELDS } from "./catalog.ts";
import { normalizeLabel } from "./normalize.ts";
import { recordAiInferenceEvent } from "./observability.ts";
import { domainScores, materializeSheet } from "./workbook.ts";
import {
  IMPORT_DOMAINS,
  type ColumnMapping,
  type ImportDomain,
  type ImportInterpretation,
  type MappingConfidence,
  type NormalizationSuggestion,
  type ParsedSheet,
  type SheetAssessment,
  type SheetDisposition,
} from "./types.ts";

export const MAX_INFERENCE_SAMPLE_ROWS = 3;
export const MAX_INFERENCE_CELL_LENGTH = 120;

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
  readonly hosted?: boolean;
  infer(input: InferenceInput): Promise<unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isConfidence(value: unknown): value is MappingConfidence {
  return value === "High" || value === "Medium" || value === "Needs Review";
}

function safeText(value: unknown, maximum = 300) {
  if (typeof value !== "string") throw new Error("AI inference returned malformed text.");
  return value.slice(0, maximum);
}

function validateStringArray(candidate: unknown, label: string) {
  if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string")) throw new Error(`AI inference ${label} are invalid.`);
  return candidate.slice(0, 50).map((item) => String(item).slice(0, 300));
}

export function validateProviderOutput(value: unknown, input: InferenceInput): Omit<ImportInterpretation, "provider" | "usedFallback" | "assistanceMode" | "statusMessage"> {
  const keys = ["domain", "sheetName", "headerRow", "mappings", "likelyDateFormats", "identifierColumns", "nameColumns", "ignoredColumns", "notes", "sheetAssessments", "normalizationSuggestions"];
  if (!isRecord(value) || !exactKeys(value, keys)) throw new Error("AI inference returned an unexpected structure.");
  if (!IMPORT_DOMAINS.includes(value.domain as ImportDomain)) throw new Error("AI inference returned an unsupported domain.");
  const domain = value.domain as ImportDomain;
  const sheet = input.sheets.find((item) => item.name === value.sheetName);
  if (!sheet) throw new Error("AI inference returned an unknown worksheet.");
  if (!Number.isInteger(value.headerRow) || Number(value.headerRow) < 1 || Number(value.headerRow) > Math.min(25, sheet.matrixRowCount)) throw new Error("AI inference returned an invalid header row.");
  if (!Array.isArray(value.mappings)) throw new Error("AI inference mappings are invalid.");
  const allowedFields = new Set(IMPORT_FIELDS[domain].map((field) => field.key));
  const mappings = value.mappings.map((mapping): ColumnMapping => {
    if (!isRecord(mapping) || !exactKeys(mapping, ["sourceColumn", "targetField", "confidence", "samples", "reason"])) throw new Error("AI inference returned a malformed mapping.");
    if (typeof mapping.sourceColumn !== "string" || !sheet.headers.includes(mapping.sourceColumn)) throw new Error("AI inference mapped an unknown source column.");
    if (mapping.targetField !== null && (typeof mapping.targetField !== "string" || !allowedFields.has(mapping.targetField))) throw new Error("AI inference mapped an unsupported target field.");
    if (!isConfidence(mapping.confidence)) throw new Error("AI inference returned an invalid confidence level.");
    if (!Array.isArray(mapping.samples) || mapping.samples.some((sample) => typeof sample !== "string")) throw new Error("AI inference samples are invalid.");
    const columnIndex = sheet.headers.indexOf(mapping.sourceColumn);
    return { sourceColumn: mapping.sourceColumn, targetField: mapping.targetField, confidence: mapping.confidence, samples: sheet.samples.map((row) => row[columnIndex] ?? "").filter(Boolean).slice(0, MAX_INFERENCE_SAMPLE_ROWS), reason: safeText(mapping.reason) };
  });
  if (mappings.length !== sheet.headers.length || new Set(mappings.map((mapping) => mapping.sourceColumn)).size !== sheet.headers.length) throw new Error("AI inference must account for every source column exactly once.");

  if (!Array.isArray(value.sheetAssessments) || value.sheetAssessments.length !== input.sheets.length) throw new Error("AI inference worksheet assessments are incomplete.");
  const sheetAssessments = value.sheetAssessments.map((candidate): SheetAssessment => {
    if (!isRecord(candidate) || !exactKeys(candidate, ["sheetName", "disposition", "domain", "headerRow", "confidence", "reason"])) throw new Error("AI inference returned a malformed worksheet assessment.");
    const assessed = input.sheets.find((item) => item.name === candidate.sheetName);
    if (!assessed) throw new Error("AI inference assessed an unknown worksheet.");
    if (!["useful", "junk", "archive", "instructions"].includes(String(candidate.disposition))) throw new Error("AI inference returned an invalid worksheet disposition.");
    if (candidate.domain !== null && !IMPORT_DOMAINS.includes(candidate.domain as ImportDomain)) throw new Error("AI inference returned an unsupported worksheet domain.");
    if (!Number.isInteger(candidate.headerRow) || Number(candidate.headerRow) < 1 || Number(candidate.headerRow) > Math.min(25, assessed.matrixRowCount)) throw new Error("AI inference returned an invalid worksheet header row.");
    if (!isConfidence(candidate.confidence)) throw new Error("AI inference returned an invalid worksheet confidence.");
    return { sheetName: assessed.name, disposition: candidate.disposition as SheetDisposition, domain: candidate.domain as ImportDomain | null, headerRow: Number(candidate.headerRow), confidence: candidate.confidence, reason: safeText(candidate.reason) };
  });
  if (new Set(sheetAssessments.map((assessment) => assessment.sheetName)).size !== input.sheets.length) throw new Error("AI inference must assess every worksheet exactly once.");
  const selectedAssessment = sheetAssessments.find((assessment) => assessment.sheetName === sheet.name);
  if (!selectedAssessment || selectedAssessment.disposition !== "useful" || selectedAssessment.domain !== domain) throw new Error("AI inference selected a worksheet inconsistent with its assessments.");

  if (!Array.isArray(value.normalizationSuggestions)) throw new Error("AI inference normalization suggestions are invalid.");
  const normalizationSuggestions = value.normalizationSuggestions.slice(0, 50).map((candidate): NormalizationSuggestion => {
    if (!isRecord(candidate) || !exactKeys(candidate, ["sourceColumn", "targetField", "sourceValue", "suggestedValue", "confidence", "reason"])) throw new Error("AI inference returned a malformed normalization suggestion.");
    const mapping = mappings.find((item) => item.sourceColumn === candidate.sourceColumn);
    if (!mapping?.targetField || mapping.targetField !== candidate.targetField || !allowedFields.has(mapping.targetField)) throw new Error("AI inference normalization targets an unsupported mapping.");
    const columnIndex = sheet.headers.indexOf(mapping.sourceColumn);
    const samples = sheet.samples.map((row) => row[columnIndex] ?? "");
    if (typeof candidate.sourceValue !== "string" || !samples.includes(candidate.sourceValue)) throw new Error("AI inference normalization references a missing source value.");
    if (typeof candidate.suggestedValue !== "string" || !candidate.suggestedValue.trim()) throw new Error("AI inference normalization returned an invalid replacement.");
    if (!isConfidence(candidate.confidence)) throw new Error("AI inference normalization returned an invalid confidence.");
    return { sourceColumn: mapping.sourceColumn, targetField: mapping.targetField, sourceValue: candidate.sourceValue, suggestedValue: candidate.suggestedValue.slice(0, MAX_INFERENCE_CELL_LENGTH), confidence: candidate.confidence, reason: safeText(candidate.reason) };
  });

  return {
    domain,
    sheetName: sheet.name,
    headerRow: Number(value.headerRow),
    mappings,
    likelyDateFormats: validateStringArray(value.likelyDateFormats, "date formats"),
    identifierColumns: validateStringArray(value.identifierColumns, "identifier columns").filter((column) => sheet.headers.includes(column)),
    nameColumns: validateStringArray(value.nameColumns, "name columns").filter((column) => sheet.headers.includes(column)),
    ignoredColumns: validateStringArray(value.ignoredColumns, "ignored columns").filter((column) => sheet.headers.includes(column)),
    notes: validateStringArray(value.notes, "notes"),
    sheetAssessments,
    normalizationSuggestions,
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
      if (aliases.includes(normalized)) { targetField = field.key; confidence = "High"; reason = "The source heading matches a known agency term for this field."; break; }
    }
    if (!targetField) {
      const candidates = IMPORT_FIELDS[domain].filter((field) => !used.has(field.key) && [field.label, ...field.aliases].map(normalizeLabel).some((alias) => alias.length > 3 && (normalized.includes(alias) || alias.includes(normalized))));
      if (candidates.length === 1) { targetField = candidates[0].key; confidence = "Medium"; reason = "The source heading is similar to a known agency term."; }
    }
    if (targetField) used.add(targetField);
    return { sourceColumn, targetField, confidence, samples: samples.map((row) => row[columnIndex] ?? "").filter(Boolean).slice(0, MAX_INFERENCE_SAMPLE_ROWS), reason };
  });
}

function deterministicDisposition(sheet: InferenceSheet): SheetDisposition {
  const name = normalizeLabel(sheet.name);
  if (/instruction|read me|help|legend|lookup|template/.test(name)) return "instructions";
  if (/archive|old|backup|prior/.test(name)) return "archive";
  return sheet.rowCount > 0 ? "useful" : "junk";
}

export class DeterministicInferenceProvider implements ImportInferenceProvider {
  readonly name = "deterministic";
  readonly hosted = false;

  async infer(input: InferenceInput) {
    let selected: { sheet: InferenceSheet; domain: ImportDomain; score: number } | null = null;
    const assessments: SheetAssessment[] = [];
    for (const sheet of input.sheets) {
      const scores = domainScores(sheet.headers);
      const ranked = IMPORT_DOMAINS.map((domain) => ({ domain, score: scores[domain] })).sort((left, right) => right.score - left.score);
      const disposition = deterministicDisposition(sheet);
      const domain = ranked[0]?.domain ?? "personnel";
      assessments.push({ sheetName: sheet.name, disposition, domain: disposition === "useful" ? domain : null, headerRow: sheet.probableHeaderRow, confidence: ranked[0]?.score > 4 ? "High" : ranked[0]?.score > 0 ? "Medium" : "Needs Review", reason: disposition === "useful" ? "Deterministic header aliases indicate an importable worksheet." : "The worksheet name indicates supporting or historical content." });
      if (disposition !== "useful") continue;
      for (const candidate of IMPORT_DOMAINS) {
        const score = scores[candidate] + Math.min(sheet.rowCount, 25) * 0.02;
        if (!selected || score > selected.score) selected = { sheet, domain: candidate, score };
      }
    }
    if (!selected && input.sheets[0]) {
      const fallbackSheet = input.sheets[0];
      const scores = domainScores(fallbackSheet.headers);
      const domain = IMPORT_DOMAINS.map((candidate) => ({ candidate, score: scores[candidate] })).sort((left, right) => right.score - left.score)[0]?.candidate ?? "personnel";
      selected = { sheet: fallbackSheet, domain, score: scores[domain] };
      const fallbackAssessment = assessments.find((assessment) => assessment.sheetName === fallbackSheet.name);
      if (fallbackAssessment) fallbackAssessment.disposition = "useful";
    }
    if (!selected) throw new Error("No importable worksheet was found.");
    const { sheet, domain } = selected;
    const mappings = mappingFor(sheet.headers, sheet.samples, domain);
    const selectedAssessment = assessments.find((assessment) => assessment.sheetName === sheet.name);
    if (selectedAssessment) selectedAssessment.domain = domain;
    const dateColumns = mappings.filter((mapping) => mapping.targetField && IMPORT_FIELDS[domain].find((field) => field.key === mapping.targetField)?.kind === "date").map((mapping) => mapping.sourceColumn);
    const identifierColumns = mappings.filter((mapping) => /id|number|serial|vin|plate|badge/i.test(mapping.targetField ?? "")).map((mapping) => mapping.sourceColumn);
    const nameColumns = mappings.filter((mapping) => /name|personnel|make|model|title|type/i.test(mapping.targetField ?? "")).map((mapping) => mapping.sourceColumn);
    return { domain, sheetName: sheet.name, headerRow: sheet.probableHeaderRow, mappings, likelyDateFormats: dateColumns.length ? ["YYYY-MM-DD", "MM/DD/YYYY", "Excel date serial"] : [], identifierColumns, nameColumns, ignoredColumns: mappings.filter((mapping) => mapping.targetField === null).map((mapping) => mapping.sourceColumn), notes: ["Review all Needs Review mappings before validation.", "Empty incoming cells never erase existing TracePoint values."], sheetAssessments: assessments, normalizationSuggestions: [] };
  }
}

function redactCell(header: string, value: string) {
  const normalizedHeader = normalizeLabel(header);
  const text = value.trim().slice(0, MAX_INFERENCE_CELL_LENGTH);
  if (!text) return "";
  if (/notes?|comments?|remarks?|narrative|description|password|token|secret/.test(normalizedHeader)) return "[redacted]";
  if (/full name|first name|middle name|last name|officer name|employee name|personnel name/.test(normalizedHeader)) return "[redacted-person-name]";
  if (/email/.test(normalizedHeader) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return "[redacted-email]";
  if (/phone|mobile|cell/.test(normalizedHeader) || /^\+?[\d().\s-]{10,}$/.test(text)) return "[redacted-phone]";
  return text;
}

export function inferenceInput(sheets: ParsedSheet[]): InferenceInput {
  return { sheets: sheets.map((sheet) => {
    const materialized = materializeSheet(sheet.matrix, sheet.probableHeaderRow);
    return { name: sheet.name.slice(0, 100), probableHeaderRow: sheet.probableHeaderRow, headers: materialized.headers.map((header) => header.slice(0, 250)), samples: materialized.rows.slice(0, MAX_INFERENCE_SAMPLE_ROWS).map((row) => materialized.headers.map((header) => redactCell(header, row.source[header] ?? ""))), rowCount: materialized.rows.length, matrixRowCount: sheet.matrix.length };
  }) };
}

export async function inferImport(sheets: ParsedSheet[], provider: ImportInferenceProvider = new DeterministicInferenceProvider()): Promise<ImportInterpretation> {
  const input = inferenceInput(sheets);
  try {
    const output = validateProviderOutput(await provider.infer(input), input);
    const hosted = provider.hosted === true;
    return { ...output, provider: provider.name, usedFallback: false, assistanceMode: hosted ? "ai-assisted" : "deterministic", statusMessage: hosted ? "AI-assisted" : "Deterministic fallback" };
  } catch {
    if (provider.hosted) recordAiInferenceEvent({ task: "import", provider: provider.name, status: "fallback", latencyMs: 0, errorCategory: "invalid_response" });
    const fallback = new DeterministicInferenceProvider();
    const output = validateProviderOutput(await fallback.infer(input), input);
    return { ...output, provider: fallback.name, usedFallback: true, assistanceMode: "deterministic", statusMessage: "AI assistance unavailable — deterministic mapping used.", notes: [...output.notes, "AI assistance was unavailable or invalid, so TracePoint used deterministic field matching."] };
  }
}
