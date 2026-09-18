import type { JwksCache } from "aws-jwt-verify/jwk";

import {
  createCognitoAuthenticationProvider,
  type CognitoVerificationConfig,
  type SessionActivityCheck,
} from "./cognito-verifier";
import type { IdentityMappingStore, TracePointIdentity } from "./provider-core";

type SupabaseResult<T> = { data: T | null; error: { message: string } | null };
type SupabaseAdmin = { rpc(name: string, args: Record<string, unknown>): Promise<SupabaseResult<unknown>> };
type SessionKey = Parameters<SessionActivityCheck>[0];

export type MobileCognitoPrincipal = TracePointIdentity & {
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
};

export type MobileCognitoSessionStore = {
  isActive: SessionActivityCheck;
  revokeToken(input: SessionKey): Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUER = /^https:\/\/cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/;
const opaqueSubject = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 256;

function validSessionKey(input: SessionKey) {
  const now = Math.floor(Date.now() / 1000);
  return UUID.test(input.userId)
    && opaqueSubject(input.subject)
    && UUID.test(input.tokenId)
    && ISSUER.test(input.issuer)
    && Number.isInteger(input.issuedAt)
    && Number.isInteger(input.expiresAt)
    && input.issuedAt <= now + 30
    && input.expiresAt > now
    && input.expiresAt > input.issuedAt
    && input.expiresAt - input.issuedAt <= 900;
}

export class SupabaseCognitoIdentityMappingStore implements IdentityMappingStore {
  constructor(private readonly admin: SupabaseAdmin) {}

  async findActive(issuer: string, subject: string): Promise<{ userId: string } | null> {
    if (!ISSUER.test(issuer) || !opaqueSubject(subject)) return null;
    const result = await this.admin.rpc("mobile_cognito_resolve_identity", {
      p_issuer: issuer,
      p_subject: subject,
    }) as SupabaseResult<{ tracepoint_user_id?: string }[]>;
    const rows = Array.isArray(result.data) ? result.data : [];
    if (result.error || rows.length !== 1 || !UUID.test(String(rows[0]?.tracepoint_user_id ?? ""))) return null;
    return { userId: String(rows[0].tracepoint_user_id) };
  }
}

export class SupabaseCognitoMobileSessionStore {
  constructor(private readonly admin: SupabaseAdmin, private readonly mapping: IdentityMappingStore) {}

  readonly isActive: SessionActivityCheck = async (input) => {
    if (!validSessionKey(input)) return false;
    const issuedAt = new Date(input.issuedAt * 1000).toISOString();
    const expiresAt = new Date(input.expiresAt * 1000).toISOString();
    try {
      const result = await this.admin.rpc("mobile_cognito_register_access_session", {
        p_issuer: input.issuer,
        p_subject: input.subject,
        p_user_id: input.userId,
        p_token_id: input.tokenId,
        p_issued_at: issuedAt,
        p_expires_at: expiresAt,
      }) as SupabaseResult<boolean>;
      return result.error == null && result.data === true;
    } catch {
      return false;
    }
  };

  async revokeToken(input: SessionKey) {
    if (!validSessionKey(input)) return false;
    try {
      const result = await this.admin.rpc("mobile_cognito_revoke_access_session", {
        p_issuer: input.issuer,
        p_subject: input.subject,
        p_user_id: input.userId,
        p_token_id: input.tokenId,
      }) as SupabaseResult<boolean>;
      return result.error == null && result.data === true;
    } catch {
      return false;
    }
  }
}

export function stagingMobileCognitoConfiguration(environment: NodeJS.ProcessEnv): CognitoVerificationConfig | null {
  if (environment.CONFIGURATION_ENVIRONMENT !== "staging" || environment.TRACEPOINT_MOBILE_COGNITO_ENABLED !== "true") return null;
  const account = environment.TRACEPOINT_MOBILE_COGNITO_ACCOUNT;
  const region = environment.TRACEPOINT_MOBILE_COGNITO_REGION;
  const userPoolId = environment.TRACEPOINT_MOBILE_COGNITO_USER_POOL_ID;
  const clientId = environment.TRACEPOINT_MOBILE_COGNITO_CLIENT_ID;
  if (!account || !region || !userPoolId || !clientId) return null;
  return { environment: "staging", account, region, userPoolId, clientId };
}

export function isStagingCognitoBearerCandidate(token: string, environment: NodeJS.ProcessEnv) {
  const config = stagingMobileCognitoConfiguration(environment);
  if (!config || token.length > 16384) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { iss?: unknown };
    return payload.iss === `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  } catch {
    return false;
  }
}

export function createMobileCognitoBearerResolver(
  config: CognitoVerificationConfig,
  mapping: IdentityMappingStore,
  sessions: MobileCognitoSessionStore,
  options: { jwksCache?: JwksCache } = {},
) {
  const provider = createCognitoAuthenticationProvider(config, mapping, sessions.isActive, options);
  return {
    async resolve(token: string): Promise<MobileCognitoPrincipal | null> {
      const identity = await provider.verifySession(token);
      if (!identity) return null;
      const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
      if (!UUID.test(String(claims.jti ?? "")) || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) return null;
      return { ...identity, tokenId: String(claims.jti), issuedAt: Number(claims.iat), expiresAt: Number(claims.exp) };
    },
    revokeToken: sessions.revokeToken.bind(sessions),
  };
}
