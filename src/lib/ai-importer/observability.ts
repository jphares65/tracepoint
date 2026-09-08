export type AiInferenceErrorCategory = "access_denied" | "configuration" | "credentials" | "invalid_response" | "service_unavailable" | "throttled" | "timeout" | "unknown";

export type AiInferenceErrorClass =
  | "AbortError"
  | "AccessDeniedException"
  | "CredentialsProviderError"
  | "InternalServerException"
  | "InvalidResponse"
  | "ModelTimeoutException"
  | "ResourceNotFoundException"
  | "ServiceUnavailableException"
  | "ThrottlingException"
  | "UnknownError"
  | "ValidationException";

export type AiCredentialResolutionStatus = "failed" | "resolved" | "unknown";

export type AiInferenceEvent = {
  task: "import" | "workspace";
  provider: string;
  modelId?: string;
  region?: string;
  credentialProvider?: "default-node-chain" | "injected";
  credentialResolutionStatus?: AiCredentialResolutionStatus;
  status: "success" | "failure" | "fallback";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCategory?: AiInferenceErrorCategory;
  errorClass?: AiInferenceErrorClass;
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
