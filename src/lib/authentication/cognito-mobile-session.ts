import "server-only";

import { CognitoIdentityProviderClient, GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { getPostgresPool } from "@/lib/database/postgres-pool";
import { createCognitoAuthenticationProvider } from "./cognito-verifier";
import { resolveVerifiedMobileBearer } from "./cognito-mobile-session-core";
import { parseCognitoMobileTargetConfiguration } from "./cognito-runtime-configuration-core";
import { PostgresIdentityMappingStore } from "./postgres-mapping";
import { PostgresCognitoSessionStore } from "./postgres-sessions";
import type { AuthenticatedPrincipal } from "./request-session-core";

function verifiedSessionCheck(store: PostgresCognitoSessionStore, establish: boolean) {
  return async (input: Parameters<PostgresCognitoSessionStore["isActive"]>[0]) => {
    if (await store.isActive(input)) return true;
    if (!establish || typeof input.expiresAt !== "number") return false;
    try {
      await store.registerVerified({ ...input, expiresAt: input.expiresAt });
      return await store.isActive(input);
    } catch {
      return false;
    }
  };
}

function decodeVerifiedTokenKey(token: string) {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof claims.jti === "string" && typeof claims.iat === "number" && typeof claims.exp === "number"
      ? { tokenId: claims.jti, issuedAt: claims.iat, expiresAt: claims.exp } : null;
  } catch { return null; }
}

async function resolve(token: string, environment: Record<string, string | undefined>, establish: boolean): Promise<AuthenticatedPrincipal | null> {
  const configuration = parseCognitoMobileTargetConfiguration(environment);
  const pool = getPostgresPool(environment as NodeJS.ProcessEnv);
  const sessions = new PostgresCognitoSessionStore(pool);
  const provider = createCognitoAuthenticationProvider(configuration.verification, new PostgresIdentityMappingStore(pool), verifiedSessionCheck(sessions, establish));
  return resolveVerifiedMobileBearer(token, provider, async (accessToken) => {
    const client = new CognitoIdentityProviderClient({ region: configuration.verification.region, maxAttempts: 2 });
    return Boolean((await client.send(new GetUserCommand({ AccessToken: accessToken }))).Username);
  });
}

export function resolveRuntimeCognitoMobileBearer(
  token: string,
  environment = process.env,
  options: { establish?: boolean } = {},
) {
  return resolve(token, environment, options.establish === true);
}

export async function revokeRuntimeCognitoMobileBearer(token: string, environment = process.env) {
  const principal = await resolve(token, environment, false);
  const key = decodeVerifiedTokenKey(token);
  if (!principal || !key) return false;
  try {
    await new PostgresCognitoSessionStore(getPostgresPool(environment as NodeJS.ProcessEnv)).revokeToken({ ...key, userId: principal.userId, issuer: principal.issuer, subject: principal.subject });
    return true;
  } catch { return false; }
}
