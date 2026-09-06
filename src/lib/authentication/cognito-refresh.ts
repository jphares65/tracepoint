import {CognitoJwtVerifier} from 'aws-jwt-verify';
import type {JwksCache} from 'aws-jwt-verify/jwk';
import type {IdentityMappingStore} from './provider-core';
import {createCognitoAuthenticationProvider, type CognitoVerificationConfig} from './cognito-verifier';
import type {InitialCognitoSessionStore} from './cognito-initial-session';
import type {CognitoTokens} from './cognito-pkce';
import type {PostgresCognitoRefreshStore} from './postgres-refresh-sessions';

type RefreshStore=Pick<PostgresCognitoRefreshStore,'consume'|'completeVerified'|'revokeFamily'>;

// Disabled server composition. The exchange port must target the configured
// Cognito client and have retries disabled. No refresh token leaves this module.
export function createCognitoRefreshRotator(config:CognitoVerificationConfig,
 mapping:IdentityMappingStore,sessions:InitialCognitoSessionStore,refresh:RefreshStore,
 exchange:(refreshToken:string)=>Promise<CognitoTokens>,options:{jwksCache?:JwksCache}={}) {
 createCognitoAuthenticationProvider(config,mapping,sessions?.isActive,options);
 if(typeof sessions.registerVerified!=='function'||typeof exchange!=='function'||
  ['consume','completeVerified','revokeFamily'].some(key=>typeof refresh?.[key as keyof RefreshStore]!=='function'))throw Error('Durable refresh composition required.');
 const issuer=`https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
 const idVerifier=CognitoJwtVerifier.create({userPoolId:config.userPoolId,clientId:config.clientId,tokenUse:'id',includeRawJwtInErrors:false,graceSeconds:0,
  customJwtCheck:({header,payload})=>{const now=Math.floor(Date.now()/1000);
   if(header.alg!=='RS256'||typeof payload.iat!=='number'||typeof payload.exp!=='number'||!Number.isInteger(payload.iat)||!Number.isInteger(payload.exp)||payload.iat>now+30||payload.exp<=payload.iat||payload.exp-payload.iat>900)throw Error('Invalid rotated ID token.');}
 },options.jwksCache?{jwksCache:options.jwksCache}:undefined);
 return async(handle:string)=>{
  let consumed:Awaited<ReturnType<RefreshStore['consume']>>=null;
  try {
   // This durable consume commits before the only provider exchange attempt.
   consumed=await refresh.consume(handle);
   if(!consumed||consumed.issuer!==issuer||consumed.clientId!==config.clientId||consumed.expiresAt<=Math.floor(Date.now()/1000))throw Error();
   const original=Object.freeze({...consumed});
   const tokens=Object.freeze({...await exchange(original.refreshToken)});
   if(!Number.isInteger(tokens.expiresIn)||tokens.expiresIn<1||tokens.expiresIn>900||
    [tokens.accessToken,tokens.idToken,tokens.refreshToken].some(token=>typeof token!=='string'||!token.length||token.length>16384||/[\s\x00-\x1f]/.test(token))||tokens.refreshToken===original.refreshToken)throw Error();
   const id=await idVerifier.verify(tokens.idToken);
   if(id.sub!==original.subject||id.auth_time!==original.authenticatedAt)throw Error();
   const access=createCognitoAuthenticationProvider(config,mapping,async verified=>{
    // Decode only inside the callback reached after access signature validation.
    const claims=JSON.parse(Buffer.from(tokens.accessToken.split('.')[1],'base64url').toString('utf8'));
    if(verified.userId!==original.userId||verified.subject!==original.subject||verified.issuer!==original.issuer||
     claims.auth_time!==original.authenticatedAt||!Number.isInteger(claims.exp))throw Error();
    await sessions.registerVerified({...verified,expiresAt:claims.exp});
    return sessions.isActive(verified);
   },options);
   if(!(await access.verifySession(tokens.accessToken)))throw Error();
   // The store serializes with identity removal/global logout and checks the
   // original authentication watermark again after the network exchange.
   const receipt=await refresh.completeVerified(original,tokens.refreshToken);
   return {userId:original.userId,handle:receipt.handle,expiresAt:receipt.expiresAt};
  } catch {
   if(consumed)await refresh.revokeFamily(consumed.familyId,{userId:consumed.userId,issuer:consumed.issuer}).catch(()=>{});
   // Even if revocation persistence is unavailable, consume left no reusable
   // refresh payload. Never retry an ambiguous exchange or return provider errors.
   throw Error('Cognito refresh failed. Start a new sign-in.');
  }
 };
}
