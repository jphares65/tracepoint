import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { JwksCache } from 'aws-jwt-verify/jwk';
import type { AuthenticationProvider, IdentityMappingStore, TracePointIdentity } from './provider-core';
export type CognitoVerificationConfig = { environment: 'staging' | 'production'; account: string; region: string; userPoolId: string; clientId: string };
export type SessionActivityCheck = (input: { userId: string; issuer: string; subject: string; tokenId: string; issuedAt: number }) => Promise<boolean>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Prepared server composition only; no application selector enables Cognito.
// Groups, email, custom user IDs and department claims never grant access.
export function createCognitoAuthenticationProvider(config: CognitoVerificationConfig, mapping: IdentityMappingStore,
  isSessionActive: SessionActivityCheck, options: { jwksCache?: JwksCache } = {}): AuthenticationProvider {
  if (!/^\d{12}$/.test(config.account) || config.account === '265544358665' || config.region !== 'us-east-1' ||
    (config.environment === 'staging' ? config.account !== '559054714699' : config.environment !== 'production' || ['559054714699', '111111111111'].includes(config.account)) ||
    !/^us-east-1_[A-Za-z0-9]+$/.test(config.userPoolId) || !/^[A-Za-z0-9]{1,128}$/.test(config.clientId) || typeof isSessionActive !== 'function') throw new Error('Invalid Cognito verification boundary.');
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
  const verifier = CognitoJwtVerifier.create({ userPoolId: config.userPoolId, clientId: config.clientId, tokenUse: 'access',
    includeRawJwtInErrors: false, graceSeconds: 0,
    customJwtCheck: ({ header, payload }) => {
      const now = Math.floor(Date.now() / 1000);
      if (header.alg !== 'RS256' || payload.iss !== issuer || typeof payload.iat !== 'number' || typeof payload.exp !== 'number' ||
        payload.iat > now + 30 || payload.exp - payload.iat > 900 || payload.exp <= payload.iat ||
        typeof payload.jti !== 'string' || !uuid.test(payload.jti) || typeof payload.sub !== 'string' || !uuid.test(payload.sub)) throw new Error('Invalid access token claims.');
    },
  }, options.jwksCache ? { jwksCache: options.jwksCache } : undefined);
  return { async verifySession(token?: string): Promise<TracePointIdentity | null> {
    if (!token || token.length > 16384) return null;
    try {
      const claims = await verifier.verify(token);
      const linked = await mapping.findActive(issuer, claims.sub);
      if (!linked || !uuid.test(linked.userId)) return null;
      if (await isSessionActive({ userId: linked.userId, issuer, subject: claims.sub, tokenId: String(claims.jti), issuedAt: claims.iat }) !== true) return null;
      return { userId: linked.userId, provider: 'cognito', issuer, subject: claims.sub };
    } catch { return null; }
  } };
}
