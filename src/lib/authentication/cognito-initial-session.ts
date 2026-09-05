import type { JwksCache } from 'aws-jwt-verify/jwk';
import type { IdentityMappingStore } from './provider-core';
import { createCognitoAuthenticationProvider, type CognitoVerificationConfig, type SessionActivityCheck } from './cognito-verifier';
import { createCognitoPkceTokenVerifier, type CognitoTokens } from './cognito-pkce';

type SessionKey = Parameters<SessionActivityCheck>[0];
export interface InitialCognitoSessionStore {
  registerVerified(input: SessionKey & { expiresAt: number }): Promise<void>;
  isActive: SessionActivityCheck;
}

// Disabled server composition. Call only from the one-time PKCE completion
// boundary with its stored nonce. The store must be durable and serialize
// registration with mapping/global revocation. Never use this for ordinary
// bearer-token validation: an established session must already be active.
export function createCognitoInitialSessionVerifier(
  config: CognitoVerificationConfig,
  mapping: IdentityMappingStore,
  sessions: InitialCognitoSessionStore,
  options: { jwksCache?: JwksCache } = {},
) {
  if (typeof sessions?.registerVerified !== 'function' || typeof sessions?.isActive !== 'function') {
    throw Error('Durable initial-session persistence is required.');
  }
  // Validate the configuration before a callback or persistence operation.
  createCognitoAuthenticationProvider(config, mapping, sessions.isActive, options);
  return async (tokens: CognitoTokens, nonce: string): Promise<{ userId: string }> => {
    try {
      const snapshot = Object.freeze({ ...tokens });
      // Each callback owns its verifier closure; concurrent sign-ins cannot
      // share token state. ID signature/client/nonce are checked first by the
      // PKCE verifier. Access signature/client/expiry and stable mapping are
      // checked before this session callback is invoked.
      const access = createCognitoAuthenticationProvider(config, mapping, async verified => {
        const claims = JSON.parse(Buffer.from(snapshot.accessToken.split('.')[1], 'base64url').toString('utf8'));
        const idClaims = JSON.parse(Buffer.from(snapshot.idToken.split('.')[1], 'base64url').toString('utf8'));
        if (idClaims.sub !== verified.subject || !Number.isInteger(claims.exp) || claims.sub !== verified.subject ||
            claims.jti !== verified.tokenId || claims.iat !== verified.issuedAt || claims.iss !== verified.issuer) {
          throw Error('Verified session claims mismatch.');
        }
        await sessions.registerVerified({ ...verified, expiresAt: claims.exp });
        return sessions.isActive(verified);
      }, options);
      return await createCognitoPkceTokenVerifier(config, access, options)(snapshot, nonce);
    } catch {
      throw Error('Initial Cognito session could not be established. Start a new sign-in.');
    }
  };
}
