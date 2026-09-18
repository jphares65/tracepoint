import { IMPORT_FIELDS } from "./catalog.ts";
import { normalizeLabel } from "./normalize.ts";
import { inferenceInput, isConfidence, isRecord, providerErrorCategory, type ImportInferenceProvider } from "./provider.ts";
import { recordAiInferenceEvent } from "./observability.ts";
import { IMPORT_DOMAINS, type ImportDomain, type ParsedSheet } from "./types.ts";
import type {
  WorkspaceInferenceSuggestions,
  WorkspaceMergeSuggestion,
  WorkspaceRelationshipSuggestion,
  WorkspaceRemediationSuggestion,
  WorkspaceSharedMappingSuggestion,
  WorkspaceSource,
} from "./workspace-types.ts";

export type WorkspaceInferenceSource = {
  sourceId: string;
  filename: string;
  size: number;
  sha256: string;
  mediaType: string;
  sheetName: string;
  uploadedAt: string;
  rowCount: number;
  domain: ImportDomain;
  headerRow: number;
  headers: string[];
  mappings: Array<{ sourceColumn: string; targetField: string | null; confidence: string }>;
  representativeRows: string[][];
};

export type WorkspaceInferenceInput = { sources: WorkspaceInferenceSource[] };
export const MAX_WORKSPACE_INFERENCE_SOURCES = 25;
export const MAX_WORKSPACE_INFERENCE_HEADERS = 40;
export const MAX_WORKSPACE_INFERENCE_SAMPLE_COLUMNS = 20;
const MAX_WORKSPACE_PROVIDER_SUGGESTIONS = 100;

export interface WorkspaceInferenceProvider extends ImportInferenceProvider {
  analyzeWorkspace?(input: WorkspaceInferenceInput): Promise<unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function text(value: unknown, maximum = 300) {
  if (typeof value !== "string") throw new Error("AI workspace inference returned malformed text.");
  return value.slice(0, maximum);
}

function sourceIds(value: unknown, input: WorkspaceInferenceInput) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 20 || value.some((item) => typeof item !== "string")) throw new Error("AI workspace inference returned malformed source references.");
  const ids = value as string[];
  if (new Set(ids).size !== ids.length || ids.some((id) => !input.sources.some((source) => source.sourceId === id))) throw new Error("AI workspace inference referenced an unavailable source.");
  return ids;
}

export function workspaceInferenceInput(sources: WorkspaceSource[], sourceLimit = MAX_WORKSPACE_INFERENCE_SOURCES): WorkspaceInferenceInput {
  return {
    sources: sources.slice(0, sourceLimit).map((source) => {
      const [minimized] = inferenceInput([{ name: source.sheetName, matrix: source.matrix, rowCount: Math.max(0, source.matrix.length - source.headerRow), columnCount: source.matrix[source.headerRow - 1]?.length ?? 0, probableHeaderRow: source.headerRow } satisfies ParsedSheet]).sheets;
      return {
        sourceId: source.id,
        filename: source.file.name,
        size: source.file.size,
        sha256: source.file.sha256,
        mediaType: source.file.type,
        sheetName: source.sheetName,
        uploadedAt: source.uploadedAt,
        rowCount: minimized.rowCount,
        domain: source.domain,
        headerRow: source.headerRow,
        headers: minimized.headers.slice(0, MAX_WORKSPACE_INFERENCE_HEADERS),
        mappings: source.mappings.slice(0, MAX_WORKSPACE_INFERENCE_HEADERS).map((mapping) => ({ sourceColumn: mapping.sourceColumn, targetField: mapping.targetField, confidence: mapping.confidence })),
        representativeRows: minimized.samples.map((row) => row.slice(0, MAX_WORKSPACE_INFERENCE_SAMPLE_COLUMNS)),
      };
    }),
  };
}

export function validateWorkspaceProviderOutput(value: unknown, input: WorkspaceInferenceInput) {
  if (!isRecord(value) || !exactKeys(value, ["relationships", "sharedMappings", "remediations", "merges"])) throw new Error("AI workspace inference returned an unexpected structure.");
  if (!Array.isArray(value.relationships) || !Array.isArray(value.sharedMappings) || !Array.isArray(value.remediations) || !Array.isArray(value.merges)) throw new Error("AI workspace inference returned malformed suggestion lists.");
  if ([value.relationships, value.sharedMappings, value.remediations, value.merges].some((suggestions) => suggestions.length > MAX_WORKSPACE_PROVIDER_SUGGESTIONS)) throw new Error("AI workspace inference returned too many suggestions.");

  const relationships = value.relationships.map((candidate): WorkspaceRelationshipSuggestion => {
    if (!isRecord(candidate) || !exactKeys(candidate, ["sourceIds", "relationship", "preferredSourceId", "confidence", "reason"])) throw new Error("AI workspace inference returned a malformed relationship.");
    const ids = sourceIds(candidate.sourceIds, input);
    if (!["same_domain", "older_newer", "overlapping", "probable_duplicate", "source_precedence"].includes(String(candidate.relationship))) throw new Error("AI workspace inference returned an unsupported relationship.");
    if (candidate.preferredSourceId !== null && (typeof candidate.preferredSourceId !== "string" || !ids.includes(candidate.preferredSourceId))) throw new Error("AI workspace inference returned an invalid preferred source.");
    if (!isConfidence(candidate.confidence)) throw new Error("AI workspace inference returned invalid confidence.");
    return { sourceIds: ids, relationship: candidate.relationship as WorkspaceRelationshipSuggestion["relationship"], preferredSourceId: candidate.preferredSourceId as string | null, confidence: candidate.confidence, reason: text(candidate.reason) };
  });

  const sharedMappings = value.sharedMappings.map((candidate): WorkspaceSharedMappingSuggestion => {
    if (!isRecord(candidate) || !exactKeys(candidate, ["domain", "sourceHeader", "targetField", "confidence", "reason"])) throw new Error("AI workspace inference returned a malformed shared mapping.");
    if (!IMPORT_DOMAINS.includes(candidate.domain as ImportDomain)) throw new Error("AI workspace inference returned an unsupported domain.");
    const domain = candidate.domain as ImportDomain;
    if (typeof candidate.sourceHeader !== "string" || !input.sources.some((source) => source.domain === domain && source.headers.includes(candidate.sourceHeader as string))) throw new Error("AI workspace inference mapped an unavailable source header.");
    if (candidate.targetField !== null && (typeof candidate.targetField !== "string" || !IMPORT_FIELDS[domain].some((field) => field.key === candidate.targetField))) throw new Error("AI workspace inference mapped an unsupported target field.");
    if (!isConfidence(candidate.confidence)) throw new Error("AI workspace inference returned invalid confidence.");
    return { domain, sourceHeader: candidate.sourceHeader, targetField: candidate.targetField as string | null, confidence: candidate.confidence, reason: text(candidate.reason) };
  });

  const remediations = value.remediations.map((candidate): WorkspaceRemediationSuggestion => {
    if (!isRecord(candidate) || !exactKeys(candidate, ["sourceId", "sourceColumn", "targetField", "sourceValue", "suggestedValue", "scope", "confidence", "reason"])) throw new Error("AI workspace inference returned a malformed remediation.");
    const source = input.sources.find((item) => item.sourceId === candidate.sourceId);
    if (!source || typeof candidate.sourceColumn !== "string") throw new Error("AI workspace inference remediation referenced an unavailable source.");
    const column = source.headers.indexOf(candidate.sourceColumn);
    const mapping = source.mappings.find((item) => item.sourceColumn === candidate.sourceColumn);
    if (!mapping?.targetField || candidate.targetField !== mapping.targetField || !IMPORT_FIELDS[source.domain].some((field) => field.key === candidate.targetField)) throw new Error("AI workspace inference remediation targeted an unsupported field.");
    if (typeof candidate.sourceValue !== "string" || !source.representativeRows.some((row) => row[column] === candidate.sourceValue)) throw new Error("AI workspace inference remediation referenced a missing source value.");
    if (typeof candidate.suggestedValue !== "string" || !candidate.suggestedValue.trim()) throw new Error("AI workspace inference remediation returned an invalid replacement.");
    if (!["column", "file", "workspace"].includes(String(candidate.scope)) || !isConfidence(candidate.confidence)) throw new Error("AI workspace inference remediation returned invalid scope or confidence.");
    return { sourceId: source.sourceId, sourceColumn: candidate.sourceColumn, targetField: mapping.targetField, sourceValue: candidate.sourceValue, suggestedValue: candidate.suggestedValue.slice(0, 120), scope: candidate.scope as WorkspaceRemediationSuggestion["scope"], confidence: candidate.confidence, reason: text(candidate.reason) };
  });

  const merges = value.merges.map((candidate): WorkspaceMergeSuggestion => {
    if (!isRecord(candidate) || !exactKeys(candidate, ["domain", "sourceIds", "strategy", "preferredSourceId", "field", "confidence", "reason"])) throw new Error("AI workspace inference returned a malformed merge suggestion.");
    if (!IMPORT_DOMAINS.includes(candidate.domain as ImportDomain)) throw new Error("AI workspace inference returned an unsupported merge domain.");
    const domain = candidate.domain as ImportDomain;
    const ids = sourceIds(candidate.sourceIds, input);
    if (ids.some((id) => input.sources.find((source) => source.sourceId === id)?.domain !== domain)) throw new Error("AI workspace inference mixed domains in a merge suggestion.");
    if (!["skip_exact_duplicates", "nonblank", "newest", "preferred_source", "field_source"].includes(String(candidate.strategy))) throw new Error("AI workspace inference returned an unsupported merge strategy.");
    if (candidate.preferredSourceId !== null && (typeof candidate.preferredSourceId !== "string" || !ids.includes(candidate.preferredSourceId))) throw new Error("AI workspace inference returned an invalid merge source.");
    if (candidate.field !== null && (typeof candidate.field !== "string" || !IMPORT_FIELDS[domain].some((field) => field.key === candidate.field))) throw new Error("AI workspace inference returned an unsupported merge field.");
    if (candidate.strategy === "preferred_source" && candidate.preferredSourceId === null) throw new Error("AI workspace inference omitted the preferred merge source.");
    if (candidate.strategy === "field_source" && (candidate.preferredSourceId === null || candidate.field === null)) throw new Error("AI workspace inference omitted a field-level merge choice.");
    if (!isConfidence(candidate.confidence)) throw new Error("AI workspace inference returned invalid confidence.");
    return { domain, sourceIds: ids, strategy: candidate.strategy as WorkspaceMergeSuggestion["strategy"], preferredSourceId: candidate.preferredSourceId as string | null, field: candidate.field as string | null, confidence: candidate.confidence, reason: text(candidate.reason) };
  });

  return { relationships, sharedMappings, remediations, merges };
}

export function parseWorkspaceInferenceSuggestions(value: unknown, sources: WorkspaceSource[]): WorkspaceInferenceSuggestions {
  if (!isRecord(value) || !exactKeys(value, ["provider", "usedFallback", "assistanceMode", "statusMessage", "relationships", "sharedMappings", "remediations", "merges"])) throw new Error("Workspace inference suggestions are malformed.");
  if (typeof value.provider !== "string" || typeof value.usedFallback !== "boolean" || !["ai-assisted", "deterministic"].includes(String(value.assistanceMode)) || typeof value.statusMessage !== "string") throw new Error("Workspace inference status is malformed.");
  return {
    ...validateWorkspaceProviderOutput({ relationships: value.relationships, sharedMappings: value.sharedMappings, remediations: value.remediations, merges: value.merges }, workspaceInferenceInput(sources, sources.length)),
    provider: value.provider.slice(0, 50),
    usedFallback: value.usedFallback,
    assistanceMode: value.assistanceMode as WorkspaceInferenceSuggestions["assistanceMode"],
    statusMessage: value.statusMessage.slice(0, 150),
  };
}

function deterministicSuggestions(input: WorkspaceInferenceInput) {
  const relationships: WorkspaceRelationshipSuggestion[] = [];
  const merges: WorkspaceMergeSuggestion[] = [];
  for (let index = 0; index < input.sources.length; index += 1) {
    for (let other = index + 1; other < input.sources.length; other += 1) {
      const left = input.sources[index];
      const right = input.sources[other];
      if (left.domain !== right.domain) continue;
      const exact = left.sha256 === right.sha256;
      relationships.push({ sourceIds: [left.sourceId, right.sourceId], relationship: exact ? "probable_duplicate" : "same_domain", preferredSourceId: null, confidence: exact ? "High" : "Needs Review", reason: exact ? "The staged files have the same SHA-256 hash." : "Deterministic classification placed both sources in the same domain." });
      if (exact) merges.push({ domain: left.domain, sourceIds: [left.sourceId, right.sourceId], strategy: "skip_exact_duplicates", preferredSourceId: null, field: null, confidence: "High", reason: "Matching file hashes indicate duplicate source content; administrator approval is still required." });
    }
  }
  const sharedMappings: WorkspaceSharedMappingSuggestion[] = [];
  for (const domain of IMPORT_DOMAINS) {
    const domainSources = input.sources.filter((source) => source.domain === domain);
    const candidates = new Map<string, { header: string; targets: Set<string | null>; count: number }>();
    for (const source of domainSources) for (const mapping of source.mappings) {
      const key = normalizeLabel(mapping.sourceColumn);
      const current = candidates.get(key) ?? { header: mapping.sourceColumn, targets: new Set<string | null>(), count: 0 };
      current.targets.add(mapping.targetField); current.count += 1; candidates.set(key, current);
    }
    for (const candidate of candidates.values()) if (candidate.count > 1 && candidate.targets.size === 1) sharedMappings.push({ domain, sourceHeader: candidate.header, targetField: [...candidate.targets][0], confidence: "High", reason: "The same normalized header has one deterministic mapping across multiple sources." });
  }
  return { relationships, sharedMappings, remediations: [] as WorkspaceRemediationSuggestion[], merges };
}

export async function inferWorkspace(sources: WorkspaceSource[], provider: WorkspaceInferenceProvider): Promise<WorkspaceInferenceSuggestions> {
  const input = workspaceInferenceInput(sources);
  const deterministicInput = workspaceInferenceInput(sources, sources.length);
  if (provider.hosted && provider.analyzeWorkspace) {
    try {
      return { ...validateWorkspaceProviderOutput(await provider.analyzeWorkspace(input), input), provider: provider.name, usedFallback: false, assistanceMode: "ai-assisted", statusMessage: "AI-assisted" };
    } catch (error) {
      recordAiInferenceEvent({ task: "workspace", provider: provider.name, status: "fallback", latencyMs: 0, errorCategory: providerErrorCategory(error) });
      return { ...deterministicSuggestions(deterministicInput), provider: "deterministic", usedFallback: true, assistanceMode: "deterministic", statusMessage: "AI assistance unavailable — deterministic mapping used." };
    }
  }
  return { ...deterministicSuggestions(deterministicInput), provider: provider.name, usedFallback: false, assistanceMode: "deterministic", statusMessage: "Deterministic fallback" };
}
