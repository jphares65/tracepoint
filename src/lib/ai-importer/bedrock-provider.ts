import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

import { recordAiInferenceEvent, type AiInferenceErrorCategory } from "./observability.ts";
import { buildImportInferenceTask, buildWorkspaceInferenceTask, IMPORT_INFERENCE_SYSTEM_PROMPT, WORKSPACE_INFERENCE_SYSTEM_PROMPT } from "./prompts.ts";
import { IMPORT_INFERENCE_JSON_SCHEMA, WORKSPACE_INFERENCE_JSON_SCHEMA } from "./schemas.ts";
import type { ImportInferenceProvider, InferenceInput } from "./provider.ts";
import type { WorkspaceInferenceInput, WorkspaceInferenceProvider } from "./workspace-inference.ts";

type BedrockSender = {
  send(command: ConverseCommand, options?: { abortSignal?: AbortSignal }): Promise<ConverseCommandOutput>;
};

export type BedrockProviderOptions = {
  region: string;
  modelId: string;
  timeoutMs?: number;
  maxTokens?: number;
  client?: BedrockSender;
};

export class BedrockInferenceError extends Error {
  readonly category: AiInferenceErrorCategory;

  constructor(category: AiInferenceErrorCategory) {
    super("AI assistance is temporarily unavailable.");
    this.name = "BedrockInferenceError";
    this.category = category;
  }
}

export function categorizeBedrockError(error: unknown): AiInferenceErrorCategory {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "AbortError" || name === "ModelTimeoutException") return "timeout";
  if (name === "AccessDeniedException") return "access_denied";
  if (name === "CredentialsProviderError" || /credential/i.test(name)) return "credentials";
  if (name === "ThrottlingException") return "throttled";
  if (["ServiceUnavailableException", "InternalServerException"].includes(name)) return "service_unavailable";
  if (["ValidationException", "ResourceNotFoundException"].includes(name)) return "configuration";
  return "unknown";
}

function responseText(response: ConverseCommandOutput) {
  if (response.stopReason !== "end_turn" && response.stopReason !== "stop_sequence") throw new BedrockInferenceError("invalid_response");
  const content = response.output?.message?.content ?? [];
  const text = content.map((block) => block.text ?? "").join("").trim();
  if (!text) throw new BedrockInferenceError("invalid_response");
  try { return JSON.parse(text) as unknown; }
  catch { throw new BedrockInferenceError("invalid_response"); }
}

export class BedrockInferenceProvider implements ImportInferenceProvider, WorkspaceInferenceProvider {
  readonly name = "bedrock";
  readonly hosted = true;
  readonly modelId: string;
  private readonly client: BedrockSender;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;

  constructor(options: BedrockProviderOptions) {
    this.modelId = options.modelId;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxTokens = options.maxTokens ?? 4_096;
    this.client = options.client ?? new BedrockRuntimeClient({ region: options.region, maxAttempts: 5, retryMode: "adaptive" });
  }

  infer(input: InferenceInput) {
    return this.converse("import", IMPORT_INFERENCE_SYSTEM_PROMPT, buildImportInferenceTask(input), IMPORT_INFERENCE_JSON_SCHEMA, "tracepoint_import_inference");
  }

  analyzeWorkspace(input: WorkspaceInferenceInput) {
    return this.converse("workspace", WORKSPACE_INFERENCE_SYSTEM_PROMPT, buildWorkspaceInferenceTask(input), WORKSPACE_INFERENCE_JSON_SCHEMA, "tracepoint_workspace_inference");
  }

  private async converse(task: "import" | "workspace", systemPrompt: string, taskPrompt: string, schema: object, schemaName: string) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.client.send(new ConverseCommand({
        modelId: this.modelId,
        system: [{ text: systemPrompt }],
        messages: [{ role: "user", content: [{ text: taskPrompt }] }],
        inferenceConfig: { maxTokens: this.maxTokens, temperature: 0 },
        outputConfig: { textFormat: { type: "json_schema", structure: { jsonSchema: { schema: JSON.stringify(schema), name: schemaName, description: "Strict TracePoint import inference output" } } } },
      }), { abortSignal: controller.signal });
      const parsed = responseText(response);
      recordAiInferenceEvent({ task, provider: this.name, modelId: this.modelId, status: "success", latencyMs: Date.now() - started, inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens });
      return parsed;
    } catch (error) {
      const category = error instanceof BedrockInferenceError ? error.category : categorizeBedrockError(error);
      recordAiInferenceEvent({ task, provider: this.name, modelId: this.modelId, status: "failure", latencyMs: Date.now() - started, errorCategory: category });
      throw new BedrockInferenceError(category);
    } finally {
      clearTimeout(timer);
    }
  }
}
