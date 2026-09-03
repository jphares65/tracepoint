const requiredSecrets = [
  "SUPABASE_SECRET_KEY",
  "BREVO_API_KEY",
  "NOTIFICATION_DISPATCH_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
];

const requiredSafeConfiguration = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
];

const requiredProviders = {
  TRACEPOINT_DATA_PROVIDER: "supabase",
  TRACEPOINT_EMAIL_PROVIDER: "brevo",
  TRACEPOINT_STORAGE_PROVIDER: "supabase",
};

export function validateTracePointRuntimeConfig(environment = process.env) {
  const missing = [...requiredSecrets, ...requiredSafeConfiguration].filter(
    (name) => typeof environment[name] !== "string" || environment[name].trim() === "",
  );
  const invalidProviders = Object.entries(requiredProviders)
    .filter(([name, expected]) => environment[name]?.trim().toLowerCase() !== expected)
    .map(([name]) => name);
  const invalidSafeConfiguration = [];
  if (
    environment.NEXT_PUBLIC_SITE_URL?.trim() &&
    environment.NEXT_PUBLIC_SITE_URL.trim() !== "https://staging.tracepointhq.com"
  ) {
    invalidSafeConfiguration.push("NEXT_PUBLIC_SITE_URL");
  }

  if (missing.length || invalidProviders.length || invalidSafeConfiguration.length) {
    const parts = [];
    if (missing.length) parts.push(`missing required variables: ${missing.join(", ")}`);
    if (invalidProviders.length) {
      parts.push(`unsupported provider controls: ${invalidProviders.join(", ")}`);
    }
    if (invalidSafeConfiguration.length) {
      parts.push(`invalid safe configuration: ${invalidSafeConfiguration.join(", ")}`);
    }
    throw new Error(`TracePoint runtime configuration is invalid (${parts.join("; ")}).`);
  }
}
