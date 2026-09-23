import type {JwksCache} from 'aws-jwt-verify/jwk';
import type {IdentityMappingStore} from './provider-core';
import type {CognitoVerificationConfig} from './cognito-verifier';
import type {CognitoTokens} from './cognito-pkce';
import {createCognitoInitialSessionVerifier,type InitialCognitoSessionStore} from './cognito-initial-session';
import type {PostgresCognitoRefreshStore} from './postgres-refresh-sessions';
import {shadowCognitoDiagnostic} from './cognito-shadow-diagnostic';

// Disabled PKCE establish port. A browser receives a handle only after both
// signed-token verification and durable refresh-family registration succeed.
export function createCognitoSessionEstablisher(config:CognitoVerificationConfig,mapping:IdentityMappingStore,
 sessions:InitialCognitoSessionStore,refresh:Pick<PostgresCognitoRefreshStore,'createVerified'>,options:{jwksCache?:JwksCache}={}){
 const verify=createCognitoInitialSessionVerifier(config,mapping,sessions,options);
 if(typeof refresh?.createVerified!=='function')throw Error('Durable refresh registration required.');
 const issuer=`https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
 return async(tokens:CognitoTokens,nonce:string)=>{
  let branch='initial_session_verification';
  try {
   const snapshot=Object.freeze({...tokens});
   const identity=await verify(snapshot,nonce);
   // These exact snapshots have passed signature/client/subject/nonce checks.
   const id=JSON.parse(Buffer.from(snapshot.idToken.split('.')[1],'base64url').toString('utf8'));
   const access=JSON.parse(Buffer.from(snapshot.accessToken.split('.')[1],'base64url').toString('utf8'));
   const now=Math.floor(Date.now()/1000),authenticatedAt=id.auth_time;
   branch='authentication_time_consistency';
   if(!Number.isInteger(authenticatedAt)||authenticatedAt>now+30||authenticatedAt>id.iat||authenticatedAt>access.iat||
    authenticatedAt+86400<=now||access.auth_time!==authenticatedAt){shadowCognitoDiagnostic(branch,{authTimePresent:Number.isInteger(authenticatedAt),accessAuthTimeMatches:access.auth_time===authenticatedAt,authAgeSeconds:Number.isInteger(authenticatedAt)?now-authenticatedAt:null});throw Error();}
   // Cognito's configured one-day refresh lifetime is an absolute ceiling,
   // measured from original authentication, never from a later refresh iat.
   branch='refresh_session_registration';const receipt=await refresh.createVerified({userId:identity.userId,issuer,subject:id.sub,clientId:config.clientId,authenticatedAt,expiresAt:authenticatedAt+86400},snapshot.refreshToken);
   return {userId:identity.userId,handle:receipt.handle,expiresAt:receipt.expiresAt};
  }catch{shadowCognitoDiagnostic(branch);throw Error('Cognito session establishment failed. Start a new sign-in.');}
 };
}
