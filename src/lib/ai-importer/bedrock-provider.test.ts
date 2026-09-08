import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ConverseCommand, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

import { BedrockInferenceError, BedrockInferenceProvider, sanitizedBedrockErrorClass } from "./bedrock-provider.ts";
import { validateImportAiConfiguration } from "./configuration.ts";
import { DeterministicInferenceProvider, inferImport, inferenceInput, MAX_INFERENCE_CELL_LENGTH, MAX_INFERENCE_SAMPLE_ROWS, validateProviderOutput } from "./provider.ts";
import { IMPORT_INFERENCE_JSON_SCHEMA, WORKSPACE_INFERENCE_JSON_SCHEMA } from "./schemas.ts";
import { inferWorkspace, validateWorkspaceProviderOutput, workspaceInferenceInput } from "./workspace-inference.ts";
import type { ParsedSheet } from "./types.ts";
import type { WorkspaceSource } from "./workspace-types.ts";

function sheet(matrix: string[][], name = "Roster"): ParsedSheet {
  return { name, matrix, rowCount: Math.max(0, matrix.length - 1), columnCount: matrix[0]?.length ?? 0, probableHeaderRow: 1 };
}

function response(value: unknown): ConverseCommandOutput {
  return { stopReason: "end_turn", output: { message: { role: "assistant", content: [{ text: JSON.stringify(value) }] } }, usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }, metrics: { latencyMs: 10 }, $metadata: {} };
}

function mockClient(handler: (command: ConverseCommand, signal?: AbortSignal) => Promise<ConverseCommandOutput>) {
  const calls: ConverseCommand[] = [];
  return {
    calls,
    client: {
      async send(command: ConverseCommand, options?: { abortSignal?: AbortSignal }) {
        calls.push(command);
        return handler(command, options?.abortSignal);
      },
    },
  };
}

async function deterministicOutput(sheets: ParsedSheet[]) {
  const input = inferenceInput(sheets);
  return await new DeterministicInferenceProvider().infer(input) as unknown as Record<string, unknown>;
}

function unsupportedBedrockSchemaKeywords(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => unsupportedBedrockSchemaKeywords(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => {
    const currentPath = `${path}.${key}`;
    const unsupported = ["minimum", "maximum", "multipleOf", "maxItems"].includes(key) || (key === "minItems" && (typeof item !== "number" || item > 1));
    return [...(unsupported ? [currentPath] : []), ...unsupportedBedrockSchemaKeywords(item, currentPath)];
  });
}

test("Bedrock-facing schemas use only supported numeric and array cardinality keywords", () => {
  assert.deepEqual(unsupportedBedrockSchemaKeywords(IMPORT_INFERENCE_JSON_SCHEMA), []);
  assert.deepEqual(unsupportedBedrockSchemaKeywords(WORKSPACE_INFERENCE_JSON_SCHEMA), []);
});

test("runtime validation preserves constraints removed from the Bedrock-facing import schema", async () => {
  const sheets = [sheet([["Badge"], ["1"]])];
  const input = inferenceInput(sheets);
  const valid = await deterministicOutput(sheets);

  for (const headerRow of [0, 26]) {
    assert.throws(() => validateProviderOutput({ ...valid, headerRow }, input), /invalid header row/);
  }
  assert.throws(() => validateProviderOutput({ ...valid, mappings: Array.from({ length: 151 }, () => (valid.mappings as unknown[])[0]) }, input), /mappings are invalid/);

  const excessiveSamples = structuredClone(valid);
  (excessiveSamples.mappings as Array<Record<string, unknown>>)[0].samples = ["1", "2", "3", "4"];
  assert.throws(() => validateProviderOutput(excessiveSamples, input), /samples are invalid/);
  assert.throws(() => validateProviderOutput({ ...valid, notes: Array.from({ length: 51 }, () => "note") }, input), /notes are invalid/);
  assert.throws(() => validateProviderOutput({ ...valid, sheetAssessments: Array.from({ length: 51 }, () => (valid.sheetAssessments as unknown[])[0]) }, input), /assessments are incomplete/);
  assert.throws(() => validateProviderOutput({ ...valid, normalizationSuggestions: Array.from({ length: 51 }, () => ({})) }, input), /normalization suggestions are invalid/);
});

test("runtime validation preserves constraints removed from the Bedrock-facing workspace schema", () => {
  const first = workspaceSource("00000001-0000-4000-8000-000000000000", "old.csv", "2025-01-01T00:00:00.000Z");
  const second = workspaceSource("00000002-0000-4000-8000-000000000000", "new.csv", "2026-01-01T00:00:00.000Z");
  const input = workspaceInferenceInput([first, second]);
  const relationship = { sourceIds: [first.id, second.id], relationship: "older_newer", preferredSourceId: second.id, confidence: "High", reason: "Later source timestamp." };
  const valid = { relationships: [relationship], sharedMappings: [], remediations: [], merges: [] };

  assert.throws(() => validateWorkspaceProviderOutput({ ...valid, relationships: [{ ...relationship, sourceIds: [first.id] }] }, input), /malformed source references/);
  for (const key of ["relationships", "sharedMappings", "remediations", "merges"] as const) {
    assert.throws(() => validateWorkspaceProviderOutput({ ...valid, [key]: Array.from({ length: 101 }, () => ({})) }, input), /too many suggestions/);
  }
});

test("Bedrock Converse uses structured output and returns domain, qualitative mappings, and remediation suggestions", async () => {
  const sheets = [sheet([["Shield", "Status"], ["101", "IN SERVICE"]])];
  const output = await deterministicOutput(sheets);
  output.normalizationSuggestions = [{ sourceColumn: "Status", targetField: "active", sourceValue: "IN SERVICE", suggestedValue: "Active", confidence: "High", reason: "Agency status terminology." }];
  const mock = mockClient(async () => response(output));
  const provider = new BedrockInferenceProvider({ region: "us-east-1", modelId: "us.example.model", client: mock.client });
  const result = await inferImport(sheets, provider);
  assert.equal(result.assistanceMode, "ai-assisted");
  assert.equal(result.domain, "personnel");
  assert.equal(result.mappings.find((mapping) => mapping.sourceColumn === "Shield")?.targetField, "badgeNumber");
  assert.equal(result.mappings[0].confidence, "High");
  assert.equal(result.normalizationSuggestions[0].suggestedValue, "Active");
  const request = mock.calls[0].input;
  assert.equal(request.modelId, "us.example.model");
  assert.equal(request.inferenceConfig?.maxTokens, 4096);
  assert.equal(request.outputConfig?.textFormat?.type, "json_schema");
  const structure = request.outputConfig?.textFormat?.structure;
  assert.ok(structure && "jsonSchema" in structure && structure.jsonSchema?.schema?.includes("normalizationSuggestions"));
});

test("workspace structured inference validates relationship and merge suggestions without applying them", async () => {
  const first = workspaceSource("00000001-0000-4000-8000-000000000000", "old.csv", "2025-01-01T00:00:00.000Z");
  const second = workspaceSource("00000002-0000-4000-8000-000000000000", "new.csv", "2026-01-01T00:00:00.000Z");
  const raw = {
    relationships: [{ sourceIds: [first.id, second.id], relationship: "older_newer", preferredSourceId: second.id, confidence: "High", reason: "Later source timestamp." }],
    sharedMappings: [{ domain: "vehicles", sourceHeader: "Car #", targetField: "unitNumber", confidence: "High", reason: "Agency vehicle identifier." }],
    remediations: [{ sourceId: first.id, sourceColumn: "Status", targetField: "status", sourceValue: "IN SERVICE", suggestedValue: "Available", scope: "workspace", confidence: "High", reason: "Canonical fleet status." }],
    merges: [{ domain: "vehicles", sourceIds: [first.id, second.id], strategy: "newest", preferredSourceId: second.id, field: null, confidence: "Medium", reason: "Newer export likely supersedes older values." }],
  };
  const mock = mockClient(async () => response(raw));
  const provider = new BedrockInferenceProvider({ region: "us-east-1", modelId: "us.example.model", client: mock.client });
  const result = await inferWorkspace([first, second], provider);
  assert.equal(result.assistanceMode, "ai-assisted");
  assert.equal(result.relationships[0].relationship, "older_newer");
  assert.equal(result.remediations[0].suggestedValue, "Available");
  assert.equal(result.merges[0].strategy, "newest");
  assert.equal(result.sharedMappings[0].targetField, "unitNumber");
  assert.equal(workspaceInferenceInput([first, second]).sources[0].representativeRows.length, 1);
  assert.equal(first.mappings[0].targetField, "unitNumber", "suggestions never mutate staged mappings");
});

test("timeouts, AccessDenied, and throttling are sanitized and categorized", async () => {
  const timeoutMock = mockClient(async (_command, signal) => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(Object.assign(new Error("private timeout detail"), { name: "AbortError" })), { once: true })));
  const timeout = new BedrockInferenceProvider({ region: "us-east-1", modelId: "model", timeoutMs: 5, client: timeoutMock.client });
  await assert.rejects(timeout.infer(inferenceInput([sheet([["Badge"], ["1"]])])), (error: unknown) => error instanceof BedrockInferenceError && error.category === "timeout" && !error.message.includes("private"));
  for (const [name, category] of [["AccessDeniedException", "access_denied"], ["ThrottlingException", "throttled"]] as const) {
    const mock = mockClient(async () => { throw Object.assign(new Error("sensitive service response"), { name }); });
    const provider = new BedrockInferenceProvider({ region: "us-east-1", modelId: "model", client: mock.client });
    await assert.rejects(provider.infer(inferenceInput([sheet([["Badge"], ["1"]])])), (error: unknown) => error instanceof BedrockInferenceError && error.category === category && !error.message.includes("sensitive"));
  }
});

test("privacy-safe diagnostics report provider resolution and preserve the AWS failure category", async () => {
  const entries: string[] = [];
  const originalInfo = console.info;
  console.info = (...values: unknown[]) => entries.push(values.map(String).join(" "));
  try {
    const mock = mockClient(async () => { throw Object.assign(new Error("sensitive service response"), { name: "ResourceNotFoundException" }); });
    const result = await inferImport([sheet([["Badge"], ["1"]])], new BedrockInferenceProvider({ region: "us-east-1", modelId: "us.example.model", client: mock.client }));
    assert.equal(result.usedFallback, true);
  } finally {
    console.info = originalInfo;
  }

  const events = entries.map((entry) => JSON.parse(entry.slice(entry.indexOf("{") )) as Record<string, unknown>);
  const failure = events.find((event) => event.status === "failure");
  const fallback = events.find((event) => event.status === "fallback");
  assert.deepEqual(failure && {
    provider: failure.provider,
    modelId: failure.modelId,
    region: failure.region,
    credentialProvider: failure.credentialProvider,
    credentialResolutionStatus: failure.credentialResolutionStatus,
    errorCategory: failure.errorCategory,
    errorClass: failure.errorClass,
  }, {
    provider: "bedrock",
    modelId: "us.example.model",
    region: "us-east-1",
    credentialProvider: "injected",
    credentialResolutionStatus: "resolved",
    errorCategory: "configuration",
    errorClass: "ResourceNotFoundException",
  });
  assert.equal(fallback?.errorCategory, "configuration");
  assert.doesNotMatch(entries.join("\n"), /sensitive service response/);
  assert.equal(sanitizedBedrockErrorClass(Object.assign(new Error("private"), { name: "UnexpectedPrivateError" })), "UnknownError");
});

test("malformed JSON and invalid schema fall back safely without blocking manual mapping", async () => {
  const malformed = mockClient(async () => ({ ...response({}), output: { message: { role: "assistant", content: [{ text: "not-json" }] } } }));
  const malformedResult = await inferImport([sheet([["Weapon S/N", "Make"], ["ABC", "Glock"]])], new BedrockInferenceProvider({ region: "us-east-1", modelId: "model", client: malformed.client }));
  assert.equal(malformedResult.usedFallback, true);
  assert.equal(malformedResult.statusMessage, "AI assistance unavailable — deterministic mapping used.");
  assert.equal(malformedResult.mappings[0].targetField, "serialNumber");

  const invalid = mockClient(async () => response({ departmentId: "forged", domain: "personnel" }));
  const invalidResult = await inferImport([sheet([["Badge"], ["1"]])], new BedrockInferenceProvider({ region: "us-east-1", modelId: "model", client: invalid.client }));
  assert.equal(invalidResult.usedFallback, true);
  assert.equal(invalidResult.domain, "personnel");

  const fabricatedOutput = await deterministicOutput([sheet([["Badge"], ["1"]])]);
  (fabricatedOutput.mappings as Array<Record<string, unknown>>)[0].targetField = "departmentId";
  const fabricated = mockClient(async () => response(fabricatedOutput));
  const fabricatedResult = await inferImport([sheet([["Badge"], ["1"]])], new BedrockInferenceProvider({ region: "us-east-1", modelId: "model", client: fabricated.client }));
  assert.equal(fabricatedResult.usedFallback, true);
  assert.equal(fabricatedResult.mappings[0].targetField, "badgeNumber");
});

test("model input is minimized, redacted, capped, truncated, and never contains workbook bytes or tenant authority", async () => {
  const long = "x".repeat(500);
  const sheets = [sheet([["Badge", "Full Name", "Notes", "Email"], ["1", "Jane Secret", "sensitive narrative", "jane@example.gov"], ["2", "Pat Secret", long, "pat@example.gov"], ["3", "Lee Secret", "note", "lee@example.gov"], ["4", "Sam Secret", "extra", "sam@example.gov"]])];
  const output = await deterministicOutput(sheets);
  const mock = mockClient(async () => response(output));
  await inferImport(sheets, new BedrockInferenceProvider({ region: "us-east-1", modelId: "model", client: mock.client }));
  const prompt = mock.calls[0].input.messages?.[0].content?.[0].text ?? "";
  assert.doesNotMatch(prompt, /Jane Secret|sensitive narrative|jane@example\.gov|departmentId|department_id|UEsDB/);
  assert.match(prompt, /\[redacted-person-name\]|\[redacted\]/);
  const input = inferenceInput(sheets);
  assert.equal(input.sheets[0].samples.length, MAX_INFERENCE_SAMPLE_ROWS);
  assert.ok(input.sheets[0].samples.flat().every((value) => value.length <= MAX_INFERENCE_CELL_LENGTH));
});

test("provider selection validates required configuration and Bedrock remains server-only", async () => {
  assert.deepEqual(validateImportAiConfiguration({ TRACEPOINT_IMPORT_AI_PROVIDER: "deterministic" }), { provider: "deterministic", valid: true, deterministicFallbackAvailable: true });
  const missing = validateImportAiConfiguration({ TRACEPOINT_IMPORT_AI_PROVIDER: "bedrock" });
  assert.equal(missing.valid, false);
  const valid = validateImportAiConfiguration({ TRACEPOINT_IMPORT_AI_PROVIDER: "bedrock", TRACEPOINT_IMPORT_BEDROCK_REGION: "us-east-1", TRACEPOINT_IMPORT_BEDROCK_MODEL_ID: "us.example.model" });
  assert.equal(valid.valid, true);
  const [factory, clientPage, workspacePage, providerSource] = await Promise.all([
    readFile("src/lib/ai-importer/server/provider-factory.ts", "utf8"),
    readFile("src/app/settings/import-export/ai-importer/page.tsx", "utf8"),
    readFile("src/app/settings/import-export/migration/page.tsx", "utf8"),
    readFile("src/lib/ai-importer/bedrock-provider.ts", "utf8"),
  ]);
  assert.match(factory, /import "server-only"/);
  assert.match(factory, /BedrockInferenceProvider/);
  assert.doesNotMatch(clientPage + workspacePage, /client-bedrock-runtime|BedrockInferenceProvider|TRACEPOINT_IMPORT_BEDROCK/);
  assert.doesNotMatch(providerSource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|departmentId|department_id/);
});

function workspaceSource(id: string, filename: string, uploadedAt: string): WorkspaceSource {
  return {
    id,
    fileId: `${id.slice(0, 8)}-1111-4000-8000-000000000000`,
    file: { name: filename, size: 100, sha256: id.replaceAll("-", "").repeat(2).slice(0, 64), type: "text/csv", sheetCount: 1 },
    sheetName: "Fleet",
    matrix: [["Car #", "Status"], ["12", "IN SERVICE"]],
    domain: "vehicles",
    headerRow: 1,
    mappings: [{ sourceColumn: "Car #", targetField: "unitNumber", confidence: "High", samples: ["12"] }, { sourceColumn: "Status", targetField: "status", confidence: "High", samples: ["IN SERVICE"] }],
    excluded: false,
    headerConfidence: "High",
    uploadedAt,
  };
}
