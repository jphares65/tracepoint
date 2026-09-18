import "server-only";

import { BedrockInferenceProvider } from "../bedrock-provider.ts";
import { validateImportAiConfiguration } from "../configuration.ts";
import { DeterministicInferenceProvider, type ImportInferenceProvider } from "../provider.ts";

class InvalidConfiguredProvider implements ImportInferenceProvider {
  readonly name = "bedrock";
  readonly hosted = true;
  async infer(): Promise<unknown> { throw new Error("AI provider configuration is unavailable."); }
}

export function configuredProvider(): ImportInferenceProvider & { analyzeWorkspace?: BedrockInferenceProvider["analyzeWorkspace"] } {
  const configuration = validateImportAiConfiguration();
  if (configuration.provider === "deterministic") return new DeterministicInferenceProvider();
  if (configuration.provider !== "bedrock" || !configuration.valid) return new InvalidConfiguredProvider();
  return new BedrockInferenceProvider(configuration);
}
