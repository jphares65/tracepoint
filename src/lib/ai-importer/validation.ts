import { IMPORT_FIELDS } from "./catalog.ts";
import { cleanText } from "./normalize.ts";
import { annotateResolvableIssues, applyValueOverrides, importScopeIsSafe } from "./remediation.ts";
import { materializeSheet, MAX_IMPORT_COLUMNS, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS_PER_SHEET, MAX_IMPORT_SHEETS, MAX_IMPORT_TOTAL_CHARACTERS } from "./workbook.ts";
import { IMPORT_DOMAINS, type ColumnMapping, type ImportDomain, type ImportPayload, type ImportReferenceData, type PreviewRow, type PreviewSummary, type RowDecision, type ValidationIssue, type ValueOverride } from "./types.ts";
import { validateCertifications } from "./adapters/certifications.ts";
import { validateEquipment } from "./adapters/equipment.ts";
import { validateFirearms } from "./adapters/firearms.ts";
import { validatePersonnel } from "./adapters/personnel.ts";
import { validateVehicles } from "./adapters/vehicles.ts";
import type { MappedInputRow } from "./adapters/common.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseImportPayload(value: unknown): ImportPayload {
  if (!isRecord(value) || !isRecord(value.file)) throw new Error("Import request is malformed.");
  if (!IMPORT_DOMAINS.includes(value.domain as ImportDomain)) throw new Error("Select a supported import domain.");
  if (typeof value.sheetName !== "string" || !cleanText(value.sheetName, 100)) throw new Error("Select a worksheet.");
  if (!Number.isInteger(value.headerRow) || Number(value.headerRow) < 1 || Number(value.headerRow) > 25) throw new Error("Select a valid header row in the first 25 rows.");
  if (!Array.isArray(value.matrix) || value.matrix.length > MAX_IMPORT_ROWS_PER_SHEET + 25) throw new Error("Worksheet data is missing or exceeds the row limit.");
  let totalCharacters = 0;
  const matrix = value.matrix.map((row) => {
    if (!Array.isArray(row) || row.length > MAX_IMPORT_COLUMNS || row.some((cell) => typeof cell !== "string")) throw new Error("Worksheet cells are malformed.");
    return row.map((cell) => {
      const cleaned = cleanText(cell, 4000);
      totalCharacters += cleaned.length;
      if (totalCharacters > MAX_IMPORT_TOTAL_CHARACTERS) throw new Error("The expanded worksheet exceeds the safe import limit.");
      return cleaned;
    });
  });
  if (!Array.isArray(value.mappings) || value.mappings.length > MAX_IMPORT_COLUMNS) throw new Error("Column mappings are missing or exceed the column limit.");
  const mappings = value.mappings.map((candidate): ColumnMapping => {
    if (!isRecord(candidate) || typeof candidate.sourceColumn !== "string" || (candidate.targetField !== null && typeof candidate.targetField !== "string")) throw new Error("A column mapping is malformed.");
    const confidence = candidate.confidence;
    if (confidence !== "High" && confidence !== "Medium" && confidence !== "Needs Review") throw new Error("A mapping confidence level is invalid.");
    return {
      sourceColumn: cleanText(candidate.sourceColumn, 250),
      targetField: candidate.targetField ? cleanText(candidate.targetField, 100) : null,
      confidence,
      samples: Array.isArray(candidate.samples) ? candidate.samples.filter((sample): sample is string => typeof sample === "string").slice(0, 3).map((sample) => cleanText(sample, 250)) : [],
      reason: cleanText(candidate.reason, 300),
    };
  });
  const file = value.file;
  if (typeof file.name !== "string" || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(file.sha256) || typeof file.size !== "number" || file.size < 1 || file.size > MAX_IMPORT_FILE_BYTES || typeof file.type !== "string" || typeof file.sheetCount !== "number" || !Number.isInteger(file.sheetCount) || file.sheetCount < 1 || file.sheetCount > MAX_IMPORT_SHEETS) throw new Error("File metadata is malformed.");
  const payload: ImportPayload = {
    file: { name: cleanText(file.name, 250), size: file.size, sha256: file.sha256.toLowerCase(), type: cleanText(file.type, 150), sheetCount: file.sheetCount },
    domain: value.domain as ImportDomain,
    sheetName: cleanText(value.sheetName, 100),
    headerRow: Number(value.headerRow),
    matrix,
    mappings,
  };
  const materialized = materializeSheet(payload.matrix, payload.headerRow);
  const mappedSource = new Map(payload.mappings.filter((mapping) => mapping.targetField).map((mapping) => [mapping.targetField!, mapping.sourceColumn]));
  const sourceByRow = new Map(materialized.rows.map((row) => [row.rowNumber, row.source]));
  if (value.overrides !== undefined && !Array.isArray(value.overrides)) throw new Error("Import remediation overrides are malformed.");
  if (value.rowDecisions !== undefined && !Array.isArray(value.rowDecisions)) throw new Error("Import conflict decisions are malformed.");
  if ((value.overrides?.length ?? 0) > MAX_IMPORT_ROWS_PER_SHEET || (value.rowDecisions?.length ?? 0) > MAX_IMPORT_ROWS_PER_SHEET) throw new Error("Import remediation exceeds the safe limit.");
  payload.overrides = (value.overrides ?? []).map((candidate): ValueOverride => {
    if (!isRecord(candidate) || !Number.isInteger(candidate.rowNumber) || typeof candidate.sourceColumn !== "string" || typeof candidate.targetField !== "string" || typeof candidate.originalValue !== "string" || typeof candidate.replacementValue !== "string" || !["row", "column", "import"].includes(String(candidate.scope))) throw new Error("An import remediation override is malformed.");
    const targetField = cleanText(candidate.targetField, 100);
    const sourceColumn = cleanText(candidate.sourceColumn, 250);
    const rowNumber = Number(candidate.rowNumber);
    if (mappedSource.get(targetField) !== sourceColumn) throw new Error("A remediation override must target its mapped source column.");
    if (sourceByRow.get(rowNumber)?.[sourceColumn] !== candidate.originalValue) throw new Error("A remediation override does not match the immutable source value.");
    const scope = candidate.scope as ValueOverride["scope"];
    if (scope === "import" && !importScopeIsSafe(payload, targetField)) throw new Error("Cross-column remediation is not safe for this field. Use the mapped column scope.");
    return { rowNumber, sourceColumn, targetField, originalValue: cleanText(candidate.originalValue, 4000), replacementValue: cleanText(candidate.replacementValue, 4000), scope, approvedAt: typeof candidate.approvedAt === "string" ? cleanText(candidate.approvedAt, 50) : undefined };
  });
  payload.rowDecisions = (value.rowDecisions ?? []).map((candidate): RowDecision => {
    if (!isRecord(candidate) || !Number.isInteger(candidate.rowNumber) || !Number.isInteger(candidate.sourceConflictRowNumber) || !["keep_first", "keep_later", "skip_row"].includes(String(candidate.resolution))) throw new Error("An import conflict decision is malformed.");
    const rowNumber = Number(candidate.rowNumber);
    const sourceConflictRowNumber = Number(candidate.sourceConflictRowNumber);
    if (!sourceByRow.has(rowNumber) || !sourceByRow.has(sourceConflictRowNumber)) throw new Error("An import conflict decision references a row outside the selected worksheet.");
    return { rowNumber, sourceConflictRowNumber, resolution: candidate.resolution as RowDecision["resolution"], approvedAt: typeof candidate.approvedAt === "string" ? cleanText(candidate.approvedAt, 50) : undefined };
  });
  return payload;
}

export function validateMappings(payload: ImportPayload) {
  const { headers, rows } = materializeSheet(payload.matrix, payload.headerRow);
  const sourceSet = new Set(headers);
  const targetSet = new Set(IMPORT_FIELDS[payload.domain].map((field) => field.key));
  const usedTargets = new Set<string>();
  const usedSources = new Set<string>();
  const issues: ValidationIssue[] = [];
  for (const mapping of payload.mappings) {
    if (!sourceSet.has(mapping.sourceColumn)) {
      issues.push({ severity: "error", message: `Source column "${mapping.sourceColumn}" is not present on the selected header row.` });
      continue;
    }
    if (usedSources.has(mapping.sourceColumn)) issues.push({ severity: "error", message: `Source column "${mapping.sourceColumn}" is mapped more than once.` });
    usedSources.add(mapping.sourceColumn);
    if (!mapping.targetField) continue;
    if (!targetSet.has(mapping.targetField)) {
      issues.push({ severity: "error", field: mapping.targetField, message: `Target field "${mapping.targetField}" is not supported for ${payload.domain}.` });
      continue;
    }
    if (usedTargets.has(mapping.targetField)) issues.push({ severity: "error", field: mapping.targetField, message: "A TracePoint field can only be mapped once." });
    usedTargets.add(mapping.targetField);
  }
  for (const field of IMPORT_FIELDS[payload.domain].filter((item) => item.required)) {
    if (!usedTargets.has(field.key)) issues.push({ severity: "error", field: field.key, message: `${field.label} must be mapped before validation.` });
  }
  const mappingByTarget = new Map(payload.mappings.filter((mapping) => mapping.targetField).map((mapping) => [mapping.targetField!, mapping.sourceColumn]));
  const originalMappedRows: MappedInputRow[] = rows.map((row) => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(IMPORT_FIELDS[payload.domain].map((field) => [field.key, mappingByTarget.has(field.key) ? row.source[mappingByTarget.get(field.key)!] ?? "" : ""])),
  }));
  const mappedRows = applyValueOverrides(originalMappedRows, originalMappedRows, payload);
  return { issues, mappedRows, originalMappedRows };
}

const EMPTY_REFERENCE: ImportReferenceData = {
  people: [], firearms: [], firearmAssignments: [], certificationTypes: [], certifications: [], vehicles: [], fleetEquipment: [], equipmentTypes: [], equipment: [],
};

export function validateImport(payload: ImportPayload, reference: ImportReferenceData = EMPTY_REFERENCE) {
  const mapped = validateMappings(payload);
  let rows: PreviewRow[];
  if (mapped.issues.some((issue) => issue.severity === "error")) {
    rows = mapped.mappedRows.map((row) => ({ rowNumber: row.rowNumber, status: "blocked", action: "CONFLICT", values: row.values, issues: [{ severity: "error", message: "Resolve mapping errors before this row can be validated." }], changes: [] }));
  } else {
    const validateRows = (input: MappedInputRow[]) => payload.domain === "personnel" ? validatePersonnel(input, reference)
      : payload.domain === "firearms" ? validateFirearms(input, reference)
      : payload.domain === "certifications" ? validateCertifications(input, reference)
      : payload.domain === "vehicles" ? validateVehicles(input, reference)
      : validateEquipment(input, reference);
    const initialRows = validateRows(mapped.mappedRows);
    const initialByRow = new Map(initialRows.map((row) => [row.rowNumber, row]));
    const approvedSkips = new Set<number>();
    for (const decision of payload.rowDecisions ?? []) {
      const source = initialByRow.get(decision.sourceConflictRowNumber);
      const target = initialByRow.get(decision.rowNumber);
      const duplicatePointsToTarget = source?.issues.some((issue) => issue.conflict?.kind === "duplicate" && issue.conflict.conflictingRowNumber === decision.rowNumber);
      const valid = Boolean(source && target && (
        (decision.resolution === "keep_first" && decision.rowNumber === decision.sourceConflictRowNumber && source.action === "CONFLICT") ||
        (decision.resolution === "keep_later" && duplicatePointsToTarget) ||
        (decision.resolution === "skip_row" && decision.rowNumber === decision.sourceConflictRowNumber && source.action === "CONFLICT")
      ));
      if (valid) approvedSkips.add(decision.rowNumber);
      else mapped.issues.push({ severity: "error", message: `The conflict decision for row ${decision.rowNumber} no longer matches the validated data. Review the conflict again.` });
    }
    const activeRows = mapped.mappedRows.filter((row) => !approvedSkips.has(row.rowNumber));
    rows = validateRows(activeRows);
    for (const rowNumber of approvedSkips) {
      const mappedRow = mapped.mappedRows.find((row) => row.rowNumber === rowNumber)!;
      rows.push({ rowNumber, status: "valid", action: "SKIP", values: mappedRow.values, issues: [], changes: [], matchReason: "Administrator explicitly skipped this conflicting row." });
    }
    rows.sort((left, right) => left.rowNumber - right.rowNumber);
  }
  rows = annotateResolvableIssues(payload, rows, mapped.mappedRows, mapped.originalMappedRows, reference);
  return { mappingIssues: mapped.issues, rows, summary: summarizePreview(rows) };
}

export function summarizePreview(rows: PreviewRow[]): PreviewSummary {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === "valid").length,
    warnings: rows.filter((row) => row.status === "warning").length,
    blocked: rows.filter((row) => row.status === "blocked").length,
    create: rows.filter((row) => row.action === "CREATE").length,
    update: rows.filter((row) => row.action === "UPDATE").length,
    skip: rows.filter((row) => row.action === "SKIP").length,
    conflict: rows.filter((row) => row.action === "CONFLICT").length,
  };
}
