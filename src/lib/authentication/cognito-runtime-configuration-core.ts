import type { CognitoVerificationConfig } from "./cognito-verifier";

export type CognitoEncryptionKeyring = {
  active: string;
  keys: ReadonlyMap<string, Uint8Array>;
};

export type CognitoRuntimeConfiguration = {
  verification: CognitoVerificationConfig;
  state: CognitoEncryptionKeyring;
  refresh: CognitoEncryptionKeyring;
};

const keyIdPattern = /^[A-Za-z0-9_-]{1,32}$/;

function parseKeyring(value: string | undefined, variable: string): CognitoEncryptionKeyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    throw new Error(`${variable} must be a valid encryption keyring.`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error(`${variable} must be a valid encryption keyring.`);
  const candidate = parsed as { active?: unknown; keys?: unknown };
  if (typeof candidate.active !== "string" || !keyIdPattern.test(candidate.active) ||
      !candidate.keys || typeof candidate.keys !== "object" || Array.isArray(candidate.keys)) {
    throw new Error(`${variable} must be a valid encryption keyring.`);
  }
  const entries = Object.entries(candidate.keys as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 3 || !entries.some(([id]) => id === candidate.active)) {
    throw new Error(`${variable} must be a valid encryption keyring.`);
  }
  const keys = new Map<string, Uint8Array>();
  for (const [id, encoded] of entries) {
    if (!keyIdPattern.test(id) || typeof encoded !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
      throw new Error(`${variable} must be a valid encryption keyring.`);
    }
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.byteLength !== 32) throw new Error(`${variable} must be a valid encryption keyring.`);
    keys.set(id, bytes);
  }
  return { active: candidate.active, keys };
}

export function parseCognitoRuntimeConfiguration(
  environment: Record<string, string | undefined>,
): CognitoRuntimeConfiguration {
  if (environment.TRACEPOINT_RUNTIME_PROVIDER_MODE !== "aws-native" ||
      environment.TRACEPOINT_DATA_PROVIDER !== "postgres" ||
      environment.TRACEPOINT_AUTH_PROVIDER !== "cognito") {
    throw new Error("Cognito runtime requires the complete AWS-native provider mode.");
  }
  const stage = environment.CONFIGURATION_ENVIRONMENT;
  if (stage !== "staging" && stage !== "production") throw new Error("Invalid Cognito environment boundary.");
  const account = environment.TRACEPOINT_AWS_ACCOUNT_ID ?? "";
  if (!/^\d{12}$/.test(account) || account === "265544358665" ||
      (stage === "staging" ? account !== "559054714699" : ["559054714699", "111111111111"].includes(account))) {
    throw new Error("Invalid Cognito account boundary.");
  }
  const region = environment.AWS_REGION ?? "";
  const userPoolId = environment.TRACEPOINT_COGNITO_USER_POOL_ID ?? "";
  const clientId = environment.TRACEPOINT_COGNITO_CLIENT_ID ?? "";
  if (region !== "us-east-1" || !/^us-east-1_[A-Za-z0-9]+$/.test(userPoolId) || !/^[A-Za-z0-9]{1,128}$/.test(clientId)) {
    throw new Error("Invalid Cognito provider target.");
  }
  return {
    verification: { environment: stage, account, region, userPoolId, clientId },
    state: parseKeyring(environment.TRACEPOINT_AUTH_STATE_KEYS, "TRACEPOINT_AUTH_STATE_KEYS"),
    refresh: parseKeyring(environment.TRACEPOINT_AUTH_REFRESH_KEYS, "TRACEPOINT_AUTH_REFRESH_KEYS"),
  };
}
