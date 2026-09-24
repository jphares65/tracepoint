import type { CognitoVerificationConfig } from "./cognito-verifier";

export type CognitoRedirectConfig = CognitoVerificationConfig & {
  siteOrigin: string;
  notificationMode: "normal" | "shadow";
};

export function validatedCognitoOrigin(config: CognitoRedirectConfig): string {
  const origin = config.siteOrigin;
  if (config.rehearsalMode === 'object-smoke') {
    if (config.environment !== 'production' || config.account !== '193644343389' ||
        config.region !== 'us-east-1' || config.userPoolId === 'us-east-1_diFmWDMe9' ||
        config.notificationMode !== 'shadow' || origin !== 'https://shadow-rehearsal.tracepointhq.com')
      throw new Error('Invalid rehearsal Cognito redirect origin.');
    return origin;
  }
  const allowed = config.notificationMode === "shadow"
    ? config.environment === "production" && /^https:\/\/shadow(?:-[a-z0-9-]+)?\.tracepointhq\.com$/.test(origin)
    : config.notificationMode === "normal" && origin === (
      config.environment === "staging"
        ? "https://staging.tracepointhq.com"
        : "https://tracepointhq.com"
    );
  if (!allowed) throw new Error("Invalid Cognito redirect origin.");
  return origin;
}
