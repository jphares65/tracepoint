const commonRequired = [
  "CONFIGURATION_ENVIRONMENT",
  "NEXT_PUBLIC_SITE_URL",
  "NOTIFICATION_DISPATCH_SECRET",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "TRACEPOINT_DATA_PROVIDER",
  "TRACEPOINT_AUTH_PROVIDER",
  "TRACEPOINT_EMAIL_PROVIDER",
  "TRACEPOINT_STORAGE_PROVIDER",
  "TRACEPOINT_RUNTIME_PROVIDER_MODE",
];

const bridgeRequired = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "BREVO_API_KEY",
];

const awsNativeRequired = [
  "AWS_REGION",
  "TRACEPOINT_DATABASE_CA_PATH",
  "TRACEPOINT_DATABASE_SECRET_JSON",
  "TRACEPOINT_IMPORT_APPROVAL_SECRET",
  "TRACEPOINT_AUTH_STATE_KEYS",
  "TRACEPOINT_AUTH_REFRESH_KEYS",
  "TRACEPOINT_AWS_ACCOUNT_ID",
  "TRACEPOINT_COGNITO_USER_POOL_ID",
  "TRACEPOINT_COGNITO_CLIENT_ID",
  "TRACEPOINT_SES_CONFIGURATION_SET",
  "TRACEPOINT_FROM_EMAIL",
  "TRACEPOINT_S3_BUCKET",
  "TRACEPOINT_S3_EXPECTED_OWNER",
];

export const LEGACY_PROVIDER_EXPLICIT_NAMES = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "BREVO_API_KEY",
]);
export const LEGACY_PROVIDER_KEY_PATTERN = /(^|_)(SUPABASE|VERCEL|BREVO)(_|$)/i;
export const LEGACY_PROVIDER_ENDPOINT_PATTERN = /(?:\.supabase\.co|\.vercel\.app|api\.brevo\.com)/i;

export function classifyLegacyProviderRuntimeEntry(name, rawValue) {
  const providers = new Set();
  const reasons = [];
  const keyMatch = String(name).match(LEGACY_PROVIDER_KEY_PATTERN);
  if (LEGACY_PROVIDER_EXPLICIT_NAMES.includes(name) || keyMatch) {
    if (keyMatch?.[2]) providers.add(keyMatch[2].toLowerCase());
    else if (name.includes("BREVO")) providers.add("brevo");
    else if (name.includes("VERCEL")) providers.add("vercel");
    else providers.add("supabase");
    reasons.push("legacy-provider-name");
  }
  const value = String(rawValue ?? "");
  if (/\.supabase\.co/i.test(value)) providers.add("supabase");
  if (/\.vercel\.app/i.test(value)) providers.add("vercel");
  if (/api\.brevo\.com/i.test(value)) providers.add("brevo");
  if (LEGACY_PROVIDER_ENDPOINT_PATTERN.test(value)) reasons.push("legacy-provider-endpoint");
  return { providers: [...providers].sort(), reasons: [...new Set(reasons)].sort() };
}

const providerTuples = {
  bridge: {
    TRACEPOINT_DATA_PROVIDER: "supabase",
    TRACEPOINT_AUTH_PROVIDER: "supabase",
    TRACEPOINT_EMAIL_PROVIDER: "brevo",
    TRACEPOINT_STORAGE_PROVIDER: new Set(["supabase", "s3"]),
  },
  "aws-native": {
    TRACEPOINT_DATA_PROVIDER: "postgres",
    TRACEPOINT_AUTH_PROVIDER: "cognito",
    TRACEPOINT_EMAIL_PROVIDER: "ses",
    TRACEPOINT_STORAGE_PROVIDER: new Set(["s3"]),
  },
};

const targets = {
  staging: {
    site: "https://staging.tracepointhq.com",
    supabase: "https://wztqqqashilusoppddxi.supabase.co",
    account: "559054714699",
  },
  production: {
    site: "https://tracepointhq.com",
    supabase: "https://izlkwggluhlhzlumtzes.supabase.co",
  },
};

function present(environment, name) {
  return typeof environment[name] === "string" && environment[name].trim().length > 0;
}

function value(environment, name) {
  return environment[name]?.trim().toLowerCase();
}

function validateS3(environment, target, invalid) {
  const account = environment.TRACEPOINT_S3_EXPECTED_OWNER;
  const stage = environment.CONFIGURATION_ENVIRONMENT;
  if (!account || !/^\d{12}$/.test(account) || account === "265544358665") invalid.push("TRACEPOINT_S3_EXPECTED_OWNER");
  if (stage === "staging" && account !== target?.account) invalid.push("TRACEPOINT_S3_EXPECTED_OWNER");
  if (stage === "production" && account === targets.staging.account) invalid.push("TRACEPOINT_S3_EXPECTED_OWNER");
  if (!["us-east-1", "us-gov-east-1", "us-gov-west-1"].includes(environment.AWS_REGION)) invalid.push("AWS_REGION");
  if (stage === "staging" && environment.AWS_REGION !== "us-east-1") invalid.push("AWS_REGION");
  if (environment.TRACEPOINT_S3_BUCKET !== `tracepoint-${stage}-private-${account}`) invalid.push("TRACEPOINT_S3_BUCKET");
}

function validatePostgres(environment, invalid) {
  if (!/^\/app\/[A-Za-z0-9._/-]+\.pem$/.test(environment.TRACEPOINT_DATABASE_CA_PATH ?? "")) invalid.push("TRACEPOINT_DATABASE_CA_PATH");
  let secret;
  try {
    secret = JSON.parse(environment.TRACEPOINT_DATABASE_SECRET_JSON ?? "");
  } catch {
    invalid.push("TRACEPOINT_DATABASE_SECRET_JSON");
    return;
  }
  const validHost = typeof secret?.host === "string" && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.rds(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(secret.host);
  const validUser = typeof secret?.username === "string" && /^[a-z][a-z0-9_]{2,62}$/.test(secret.username);
  if (!validHost || secret?.port !== 5432 || !validUser || typeof secret?.password !== "string" || secret.password.length < 20 || secret?.dbname !== "tracepoint") invalid.push("TRACEPOINT_DATABASE_SECRET_JSON");
}

function validateKeyring(environment, name, invalid) {
  let parsed;
  try {
    parsed = JSON.parse(environment[name] ?? "");
  } catch {
    invalid.push(name);
    return;
  }
  const entries = parsed?.keys && typeof parsed.keys === "object" && !Array.isArray(parsed.keys)
    ? Object.entries(parsed.keys)
    : [];
  if (typeof parsed?.active !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(parsed.active) ||
      entries.length < 1 || entries.length > 3 || !entries.some(([id]) => id === parsed.active) ||
      entries.some(([id, encoded]) => !/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof encoded !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encoded))) {
    invalid.push(name);
  }
}

export function validateTracePointRuntimeConfig(environment = process.env) {
  const stage = environment.CONFIGURATION_ENVIRONMENT;
  const target = targets[stage];
  const mode = environment.TRACEPOINT_RUNTIME_PROVIDER_MODE?.trim().toLowerCase() ||
    (value(environment, "TRACEPOINT_DATA_PROVIDER") === "postgres" ? "aws-native" : "bridge");
  const tuple = providerTuples[mode];
  const required = [...commonRequired, ...(mode === "aws-native" ? awsNativeRequired : bridgeRequired)];
  const missing = required.filter((name) => !present(environment, name));
  const invalidProviders = [];
  const invalid = [];

  if (!tuple) {
    invalidProviders.push("TRACEPOINT_RUNTIME_PROVIDER_MODE");
  } else {
    for (const [name, expected] of Object.entries(tuple)) {
      const actual = value(environment, name);
      if (expected instanceof Set ? !expected.has(actual) : actual !== expected) invalidProviders.push(name);
    }
  }

  if (!target) invalid.push("CONFIGURATION_ENVIRONMENT");
  if (!target || environment.NEXT_PUBLIC_SITE_URL !== target.site) invalid.push("NEXT_PUBLIC_SITE_URL");

  if (mode === "bridge" && (!target || environment.NEXT_PUBLIC_SUPABASE_URL !== target.supabase)) {
    invalid.push("NEXT_PUBLIC_SUPABASE_URL");
  }

  if (value(environment, "TRACEPOINT_STORAGE_PROVIDER") === "s3") validateS3(environment, target, invalid);

  if (mode === "aws-native") {
    validatePostgres(environment, invalid);
    validateKeyring(environment, "TRACEPOINT_AUTH_STATE_KEYS", invalid);
    validateKeyring(environment, "TRACEPOINT_AUTH_REFRESH_KEYS", invalid);
    for (const name of LEGACY_PROVIDER_EXPLICIT_NAMES) if (present(environment, name)) invalid.push(name);
    for (const [name, raw] of Object.entries(environment)) {
      if (!present(environment, name)) continue;
      const classification = classifyLegacyProviderRuntimeEntry(name, raw);
      if (classification.reasons.length) invalid.push(name);
    }
    const region = environment.AWS_REGION ?? "";
    if (!new RegExp(`^${region.replaceAll("-", "\\-")}_[A-Za-z0-9]+$`).test(environment.TRACEPOINT_COGNITO_USER_POOL_ID ?? "")) invalid.push("TRACEPOINT_COGNITO_USER_POOL_ID");
    if (!/^\d{12}$/.test(environment.TRACEPOINT_AWS_ACCOUNT_ID ?? "") || environment.TRACEPOINT_AWS_ACCOUNT_ID !== environment.TRACEPOINT_S3_EXPECTED_OWNER) invalid.push("TRACEPOINT_AWS_ACCOUNT_ID");
    if (!/^[A-Za-z0-9]{1,128}$/.test(environment.TRACEPOINT_COGNITO_CLIENT_ID ?? "")) invalid.push("TRACEPOINT_COGNITO_CLIENT_ID");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(environment.TRACEPOINT_SES_CONFIGURATION_SET ?? "")) invalid.push("TRACEPOINT_SES_CONFIGURATION_SET");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(environment.TRACEPOINT_FROM_EMAIL ?? "")) invalid.push("TRACEPOINT_FROM_EMAIL");
  }

  const uniqueInvalid = [...new Set(invalid)];
  if (missing.length || invalidProviders.length || uniqueInvalid.length) {
    throw new Error(`TracePoint runtime configuration is invalid (missing required variables: ${missing.join(", ")}; unsupported provider controls: ${invalidProviders.join(", ")}; invalid safe configuration: ${uniqueInvalid.join(", ")}).`);
  }
}
