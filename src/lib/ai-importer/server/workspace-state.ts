import "server-only";

import { IMPORT_FIELDS } from "../catalog.ts";
import { cleanText } from "../normalize.ts";
import { parseImportPayload } from "../validation.ts";
import { IMPORT_DOMAINS, type ImportDomain } from "../types.ts";
import { materializeSheet } from "../workbook.ts";
import { EMPTY_WORKSPACE_STATE, type MigrationWorkspaceState, type SharedMappingRule, type WorkspaceMergeRule, type WorkspaceRemediationRule, type WorkspaceSource } from "../workspace-types.ts";

export const MAX_WORKSPACE_FILES = 50;
export const MAX_WORKSPACE_BYTES = 25 * 1024 * 1024;
export const MAX_WORKSPACE_ROWS = 50_000;
export const MAX_WORKSPACE_SOURCES = 200;
export const MAX_WORKSPACE_TOTAL_CHARACTERS = 15_000_000;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function domain(value: unknown): ImportDomain {
  if (!IMPORT_DOMAINS.includes(value as ImportDomain)) throw new Error("A workspace source has an unsupported domain.");
  return value as ImportDomain;
}

export function parseWorkspaceState(value: unknown): MigrationWorkspaceState {
  if (!record(value)) throw new Error("Migration workspace state is malformed.");
  if (!Array.isArray(value.sources) || value.sources.length > MAX_WORKSPACE_SOURCES) throw new Error("Migration workspace sources are missing or exceed the safe limit.");
  const sources = value.sources.map((candidate): WorkspaceSource => {
    if (!record(candidate) || typeof candidate.id !== "string" || !/^[a-f0-9-]{36}$/i.test(candidate.id) || typeof candidate.fileId !== "string" || !/^[a-f0-9-]{36}$/i.test(candidate.fileId) || typeof candidate.sheetName !== "string" || typeof candidate.excluded !== "boolean" || typeof candidate.uploadedAt !== "string" || !["High", "Medium", "Needs Review"].includes(String(candidate.headerConfidence))) throw new Error("A migration source is malformed.");
    const parsed = parseImportPayload({ file: candidate.file, domain: domain(candidate.domain), sheetName: candidate.sheetName, headerRow: candidate.headerRow, matrix: candidate.matrix, mappings: candidate.mappings });
    return { id: candidate.id, fileId: candidate.fileId, file: parsed.file, sheetName: parsed.sheetName, matrix: parsed.matrix, domain: parsed.domain, headerRow: parsed.headerRow, mappings: parsed.mappings, excluded: candidate.excluded, headerConfidence: candidate.headerConfidence as WorkspaceSource["headerConfidence"], uploadedAt: cleanText(candidate.uploadedAt, 50) };
  });
  if (new Set(sources.map((source) => source.id)).size !== sources.length) throw new Error("Migration workspace source identifiers must be unique.");
  for (const source of sources) {
    if (sources.some((candidate) => candidate.fileId === source.fileId && JSON.stringify(candidate.file) !== JSON.stringify(source.file))) throw new Error("Worksheets sharing a workspace file identifier must share immutable file metadata.");
  }
  const fileCount = new Set(sources.map((source) => source.fileId)).size;
  const totalBytes = [...new Map(sources.map((source) => [source.fileId, source.file.size])).values()].reduce((sum, size) => sum + size, 0);
  const totalRows = sources.reduce((sum, source) => sum + Math.max(0, source.matrix.length - source.headerRow), 0);
  const totalCharacters = sources.reduce((sum, source) => sum + source.matrix.reduce((matrixSum, row) => matrixSum + row.reduce((rowSum, cell) => rowSum + cell.length, 0), 0), 0);
  if (fileCount > MAX_WORKSPACE_FILES || totalBytes > MAX_WORKSPACE_BYTES || totalRows > MAX_WORKSPACE_ROWS || totalCharacters > MAX_WORKSPACE_TOTAL_CHARACTERS) throw new Error("Migration workspace exceeds the safe aggregate file, byte, row, or expanded-character limit.");
  if (!Array.isArray(value.sharedMappings) || !Array.isArray(value.remediations) || !Array.isArray(value.mergeRules)) throw new Error("Migration workspace rules are malformed.");
  const sharedMappings = value.sharedMappings.map((candidate): SharedMappingRule => {
    if (!record(candidate) || typeof candidate.sourceHeader !== "string" || (candidate.targetField !== null && typeof candidate.targetField !== "string") || typeof candidate.approvedAt !== "string") throw new Error("A shared mapping rule is malformed.");
    const ruleDomain = domain(candidate.domain);
    if (candidate.targetField && !IMPORT_FIELDS[ruleDomain].some((field) => field.key === candidate.targetField)) throw new Error("A shared mapping rule targets an unsupported field.");
    return { domain: ruleDomain, sourceHeader: cleanText(candidate.sourceHeader, 250), targetField: candidate.targetField ? cleanText(candidate.targetField, 100) : null, approvedAt: cleanText(candidate.approvedAt, 50) };
  });
  const remediations = value.remediations.map((candidate): WorkspaceRemediationRule => {
    if (!record(candidate) || typeof candidate.sourceId !== "string" || !Number.isInteger(candidate.rowNumber) || typeof candidate.sourceColumn !== "string" || typeof candidate.targetField !== "string" || typeof candidate.originalValue !== "string" || typeof candidate.replacementValue !== "string" || typeof candidate.approvedAt !== "string" || !["row", "column", "file", "workspace"].includes(String(candidate.scope))) throw new Error("A shared remediation rule is malformed.");
    const source = sources.find((item) => item.id === candidate.sourceId);
    if (!source) throw new Error("A remediation rule references an unavailable source.");
    const mapping = source.mappings.find((item) => item.targetField === candidate.targetField && item.sourceColumn === candidate.sourceColumn);
    const sourceValue = materializeSheet(source.matrix, source.headerRow).rows.find((row) => row.rowNumber === Number(candidate.rowNumber))?.source[mapping?.sourceColumn ?? ""];
    if (!mapping || sourceValue !== candidate.originalValue) throw new Error("A remediation rule does not match its immutable source cell.");
    return { sourceId: source.id, rowNumber: Number(candidate.rowNumber), sourceColumn: mapping.sourceColumn, targetField: mapping.targetField!, originalValue: cleanText(candidate.originalValue, 4000), replacementValue: cleanText(candidate.replacementValue, 4000), scope: candidate.scope as WorkspaceRemediationRule["scope"], approvedAt: cleanText(candidate.approvedAt, 50) };
  });
  const mergeRules = value.mergeRules.map((candidate): WorkspaceMergeRule => {
    if (!record(candidate) || !["skip_exact_duplicates", "nonblank", "newest", "preferred_source", "existing", "field_source"].includes(String(candidate.strategy)) || typeof candidate.approvedAt !== "string") throw new Error("A merge precedence rule is malformed.");
    const ruleDomain = domain(candidate.domain);
    if (candidate.preferredSourceId !== undefined && (typeof candidate.preferredSourceId !== "string" || !sources.some((source) => source.id === candidate.preferredSourceId && source.domain === ruleDomain))) throw new Error("A merge rule references an unavailable source.");
    if (candidate.field !== undefined && (typeof candidate.field !== "string" || !IMPORT_FIELDS[ruleDomain].some((field) => field.key === candidate.field))) throw new Error("A merge rule targets an unsupported field.");
    return { domain: ruleDomain, strategy: candidate.strategy as WorkspaceMergeRule["strategy"], groupKey: typeof candidate.groupKey === "string" ? cleanText(candidate.groupKey, 64) : undefined, preferredSourceId: candidate.preferredSourceId as string | undefined, field: candidate.field as string | undefined, approvedAt: cleanText(candidate.approvedAt, 50) };
  });
  return { ...EMPTY_WORKSPACE_STATE, version: 1, sources, sharedMappings, remediations, mergeRules };
}
