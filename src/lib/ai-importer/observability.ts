export type AiInferenceErrorCategory = "access_denied" | "configuration" | "credentials" | "invalid_response" | "service_unavailable" | "throttled" | "timeout" | "unknown";

export type AiInferenceEvent = {
  task: "import" | "workspace";
  provider: string;
  modelId?: string;
  status: "success" | "failure" | "fallback";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCategory?: AiInferenceErrorCategory;
};

const counters = { invocations: 0, fallbacks: 0 };

export function recordAiInferenceEvent(event: AiInferenceEvent) {
  if (event.status === "fallback") counters.fallbacks += 1;
  else counters.invocations += 1;
  console.info("[tracepoint-import-ai]", JSON.stringify(event));
}

export function aiInferenceMetricsSnapshot() {
  return { ...counters };
}
