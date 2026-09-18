export type ImportAiConfiguration =
  | { provider: "deterministic"; valid: true; deterministicFallbackAvailable: true }
  | { provider: "bedrock"; valid: boolean; deterministicFallbackAvailable: true; region: string; modelId: string; timeoutMs: number; maxTokens: number; errors: string[] }
  | { provider: "invalid"; valid: false; deterministicFallbackAvailable: true; errors: string[] };

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function validateImportAiConfiguration(environment: Record<string, string | undefined> = process.env): ImportAiConfiguration {
  const selected = (environment.TRACEPOINT_IMPORT_AI_PROVIDER || "deterministic").trim().toLowerCase();
  if (selected === "deterministic") return { provider: "deterministic", valid: true, deterministicFallbackAvailable: true };
  if (selected !== "bedrock") return { provider: "invalid", valid: false, deterministicFallbackAvailable: true, errors: ["TRACEPOINT_IMPORT_AI_PROVIDER must be deterministic or bedrock."] };
  const region = (environment.TRACEPOINT_IMPORT_BEDROCK_REGION || "").trim();
  const modelId = (environment.TRACEPOINT_IMPORT_BEDROCK_MODEL_ID || "").trim();
  const errors: string[] = [];
  if (!region) errors.push("TRACEPOINT_IMPORT_BEDROCK_REGION is required when Bedrock is selected.");
  if (!modelId) errors.push("TRACEPOINT_IMPORT_BEDROCK_MODEL_ID is required when Bedrock is selected.");
  return {
    provider: "bedrock",
    valid: errors.length === 0,
    deterministicFallbackAvailable: true,
    region,
    modelId,
    timeoutMs: boundedInteger(environment.TRACEPOINT_IMPORT_BEDROCK_TIMEOUT_MS, 20_000, 1_000, 60_000),
    maxTokens: boundedInteger(environment.TRACEPOINT_IMPORT_BEDROCK_MAX_TOKENS, 4_096, 512, 8_192),
    errors,
  };
}
