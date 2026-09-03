const requiredSecrets = [
  "SUPABASE_SECRET_KEY",
  "BREVO_API_KEY",
  "NOTIFICATION_DISPATCH_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
];

const requiredProviders = {
  TRACEPOINT_DATA_PROVIDER: "supabase",
  TRACEPOINT_EMAIL_PROVIDER: "brevo",
  TRACEPOINT_STORAGE_PROVIDER: "supabase",
};

export function validateTracePointRuntimeConfig(environment = process.env) {
  const missing = requiredSecrets.filter(
    (name) => typeof environment[name] !== "string" || environment[name].trim() === "",
  );
  const invalidProviders = Object.entries(requiredProviders)
    .filter(([name, expected]) => environment[name]?.trim().toLowerCase() !== expected)
    .map(([name]) => name);

  if (missing.length || invalidProviders.length) {
    const parts = [];
    if (missing.length) parts.push(`missing required variables: ${missing.join(", ")}`);
    if (invalidProviders.length) {
      parts.push(`unsupported provider controls: ${invalidProviders.join(", ")}`);
    }
    throw new Error(`TracePoint runtime configuration is invalid (${parts.join("; ")}).`);
  }
}
