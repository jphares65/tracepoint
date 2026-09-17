export type TracePointEnvironment =
  | "staging"
  | "preview"
  | "development"
  | "unknown"
  | "production";

type EnvironmentSignals = {
  configurationEnvironment?: string;
  vercelEnvironment?: string;
  nodeEnvironment?: string;
};

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase();
}

/**
 * Resolves a safe, user-facing deployment label. Configuration environment is
 * authoritative so an AWS-staging-backed Vercel Preview is still STAGING.
 */
export function resolveTracePointEnvironment({
  configurationEnvironment,
  vercelEnvironment,
  nodeEnvironment,
}: EnvironmentSignals): TracePointEnvironment {
  const configuration = normalize(configurationEnvironment);
  const vercel = normalize(vercelEnvironment);
  const node = normalize(nodeEnvironment);

  if (configuration === "staging") return "staging";
  if (vercel === "preview") return "preview";
  if (configuration === "production" || vercel === "production") {
    return "production";
  }
  if (configuration) return "unknown";
  if (node === "development" || vercel === "development") {
    return "development";
  }
  return node === "production" ? "production" : "unknown";
}

export function getTracePointEnvironmentIndicator(
  signals: EnvironmentSignals,
) {
  const environment = resolveTracePointEnvironment(signals);

  if (environment === "production") return null;

  return {
    environment,
    label: environment.toUpperCase(),
    title: `Environment: ${environment[0].toUpperCase()}${environment.slice(1)}`,
  };
}
