import type { CognitoVerificationConfig } from "./cognito-verifier";
import { validatedCognitoOrigin, type CognitoRedirectConfig } from "./cognito-redirect-origin";
import { isCognitoPoolForRegion, isCognitoRegion } from "./cognito-endpoints";

export type CognitoEncryptionKeyring = {
  active: string;
  keys: ReadonlyMap<string, Uint8Array>;
};

export type CognitoRuntimeConfiguration = {
  verification: CognitoRedirectConfig;
  state: CognitoEncryptionKeyring;
  refresh: CognitoEncryptionKeyring;
};

export type CognitoTargetConfiguration = {
  verification: CognitoVerificationConfig;
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

export function parseCognitoTargetConfiguration(
  environment: Record<string, string | undefined>,
): CognitoTargetConfiguration {
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
  const mobileClientId = environment.TRACEPOINT_COGNITO_MOBILE_CLIENT_ID?.trim();
  const rehearsalMode = environment.TRACEPOINT_REHEARSAL_APP_MODE;
  const clientIds = mobileClientId ? [clientId, mobileClientId] : [clientId];
  if (!isCognitoRegion(region) || (stage === "staging" && region !== "us-east-1") || !isCognitoPoolForRegion(userPoolId, region) ||
      clientIds.some(value => !/^[A-Za-z0-9]{1,128}$/.test(value)) || new Set(clientIds).size !== clientIds.length) {
    throw new Error("Invalid Cognito provider target.");
  }
  if (rehearsalMode !== undefined && (rehearsalMode !== 'object-smoke' || stage !== 'production' ||
      account !== '193644343389' || region !== 'us-east-1' || userPoolId === 'us-east-1_diFmWDMe9' || mobileClientId))
    throw new Error('Invalid rehearsal Cognito provider target.');
  if (stage === 'production' && account === '193644343389' && rehearsalMode === undefined &&
      environment.TRACEPOINT_NOTIFICATION_MODE === 'normal' &&
      (region !== 'us-east-1' || userPoolId !== 'us-east-1_diFmWDMe9' ||
        clientId !== '9tfp383dgjuvanhnh94bstafr')) {
    throw new Error('Production Cognito pool or client does not match the reviewed authority.');
  }
  return { verification: { environment: stage, account, region, userPoolId, clientId,
    ...(rehearsalMode === 'object-smoke' ? { rehearsalMode } : {}),
    ...(mobileClientId ? { trustedClientIds: clientIds } : {}) } };
}

export function parseCognitoRuntimeConfiguration(
  environment: Record<string, string | undefined>,
): CognitoRuntimeConfiguration {
  const target = parseCognitoTargetConfiguration(environment);
  const verification: CognitoRedirectConfig = {
    ...target.verification,
    siteOrigin: environment.NEXT_PUBLIC_SITE_URL ?? "",
    notificationMode: environment.TRACEPOINT_NOTIFICATION_MODE as "normal" | "shadow",
  };
  validatedCognitoOrigin(verification);
  return {
    verification,
    state: parseKeyring(environment.TRACEPOINT_AUTH_STATE_KEYS, "TRACEPOINT_AUTH_STATE_KEYS"),
    refresh: parseKeyring(environment.TRACEPOINT_AUTH_REFRESH_KEYS, "TRACEPOINT_AUTH_REFRESH_KEYS"),
  };
}
