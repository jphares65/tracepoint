import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {CognitoJwtVerifier} from 'aws-jwt-verify';
import type {JwksCache} from 'aws-jwt-verify/jwk';
import type {AuthenticationProvider} from './provider-core';
import type {CognitoVerificationConfig} from './cognito-verifier';
import {validatedCognitoOrigin,type CognitoRedirectConfig} from './cognito-redirect-origin';
import {shadowCognitoDiagnostic} from './cognito-shadow-diagnostic';
export type AuthorizationTransaction={state:string;verifier:string;nonce:string;expiresAt:number;clientId:string;callback:string};
export const COGNITO_FLOW_LIFETIME_SECONDS=600;
export interface AuthorizationTransactionStore {
 // Server-only encrypted storage. take must atomically delete/consume even if
 // token exchange fails; TTL cleanup alone is not replay protection.
 put(handle:string,transaction:AuthorizationTransaction):Promise<void>;
 take(handle:string):Promise<AuthorizationTransaction|null>;
}
export type CognitoTokens={accessToken:string;idToken:string;refreshToken:string;expiresIn:number};
export function assertCognitoConfiguration(config:CognitoVerificationConfig){
 if(config.region!=='us-east-1'||!/^\d{12}$/.test(config.account)||config.account==='265544358665'||
  (config.environment==='staging'?config.account!=='559054714699':config.environment!=='production'||['559054714699','111111111111'].includes(config.account))||
  !/^us-east-1_[A-Za-z0-9]+$/.test(config.userPoolId)||!/^[A-Za-z0-9]{1,128}$/.test(config.clientId))throw Error('Invalid Cognito PKCE boundary.');
}
export function createCognitoPkce(config:CognitoRedirectConfig,store:AuthorizationTransactionStore,fetchImpl:typeof fetch=fetch,now:()=>number=Date.now){
 assertCognitoConfiguration(config);if(typeof store?.put!=='function'||typeof store?.take!=='function')throw Error('Invalid transaction store.');
 const domain='https://tracepoint-'+config.environment+'-'+config.account+'.auth.us-east-1.amazoncognito.com';
 const callback=validatedCognitoOrigin(config)+'/api/auth/cognito/callback';
 const random=()=>randomBytes(32).toString('base64url');
 return {
  async begin(){
   const handle=random(),state=random(),verifier=random(),nonce=random();
   try{await store.put(handle,{state,verifier,nonce,expiresAt:now()+COGNITO_FLOW_LIFETIME_SECONDS*1000,clientId:config.clientId,callback});}catch{throw Error('Cognito authorization could not be started.');}
   const url=new URL(domain+'/oauth2/authorize');url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:callback,scope:'openid email',state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
   // The handle must be installed only as a Secure, HttpOnly, SameSite=Lax,
   // Path=/ cookie with this __Host- name; never expose the verifier to a browser.
   return {url:url.toString(),cookie:{name:'__Host-tracepoint-cognito-flow',value:handle,httpOnly:true as const,secure:true as const,sameSite:'lax' as const,path:'/',maxAge:COGNITO_FLOW_LIFETIME_SECONDS}};
  },
  async complete(input:{handle:string;state:string;code:string},verifyTokens:(tokens:CognitoTokens,nonce:string)=>Promise<{userId:string}>){
   let branch='pkce_input';
   try{
    if(!/^[A-Za-z0-9_-]{43}$/.test(input.handle)||!/^[A-Za-z0-9_-]{43}$/.test(input.state)||typeof input.code!=='string'||input.code.length<1||input.code.length>2048||/[\s\x00-\x1f]/.test(input.code)||typeof verifyTokens!=='function')throw Error();
    branch='pkce_transaction_take';
    const transaction=await store.take(input.handle);
    branch='pkce_transaction_validation';
    const present=!!transaction,expired=present&&transaction.expiresAt<=now(),future=present&&transaction.expiresAt>now()+COGNITO_FLOW_LIFETIME_SECONDS*1000;
    const clientMatches=present&&transaction.clientId===config.clientId,callbackMatches=present&&transaction.callback===callback;
    const stateMatches=present&&/^[A-Za-z0-9_-]{43}$/.test(transaction.state)&&timingSafeEqual(Buffer.from(transaction.state),Buffer.from(input.state));
    if(!transaction||expired||future||!clientMatches||!callbackMatches||!/^[A-Za-z0-9_-]{43}$/.test(transaction.verifier)||!/^[A-Za-z0-9_-]{43}$/.test(transaction.nonce)||!stateMatches){
      shadowCognitoDiagnostic(branch,{present,expired,future,clientMatches,callbackMatches,stateMatches});throw Error();
    }
    branch='authorization_code_exchange';
    const response=await fetchImpl(domain+'/oauth2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,code:input.code,redirect_uri:callback,code_verifier:transaction.verifier})});
    // No retries: acceptance is ambiguous after transport failure. Begin again.
    if(response.status!==200){shadowCognitoDiagnostic(branch,{httpStatus:response.status});await response.body?.cancel();throw Error();}
    branch='token_response_body';
    const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>65536)throw Error();chunks.push(chunk.value);}}finally{await reader.cancel().catch(()=>{});}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    branch='token_response_validation';
    if(value.token_type!=='Bearer'||!Number.isInteger(value.expires_in)||value.expires_in<1||value.expires_in>900||['access_token','id_token','refresh_token'].some(k=>typeof value[k]!=='string'||value[k].length<1||value[k].length>16384)){
      shadowCognitoDiagnostic(branch,{bearer:value.token_type==='Bearer',expiresIn:Number.isInteger(value.expires_in)?value.expires_in:null});throw Error();
    }
    // Mandatory server verifier must validate both JWTs (issuer/client/type,
    // signature/expiry, matching subjects and nonce), stable identity mapping,
    // and durable session policy. Tokens are never returned by this boundary.
    branch='verified_session_establishment';const identity=await verifyTokens({accessToken:value.access_token,idToken:value.id_token,refreshToken:value.refresh_token,expiresIn:value.expires_in},transaction.nonce);
    branch='verified_identity_shape';if(!identity||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity.userId))throw Error();
    return {userId:identity.userId};
   }catch{shadowCognitoDiagnostic(branch);throw Error('Cognito authorization could not be completed. Start a new sign-in.');}
  }
 };
}

// Compose with the existing access-token verifier, stable mapping and mandatory
// durable session check. JWT claims never supply a department or permission.
export function createCognitoPkceTokenVerifier(config:CognitoVerificationConfig,access:AuthenticationProvider,options:{jwksCache?:JwksCache}={}){
 assertCognitoConfiguration(config);
 const issuer='https://cognito-idp.'+config.region+'.amazonaws.com/'+config.userPoolId;
 const verifier=CognitoJwtVerifier.create({userPoolId:config.userPoolId,clientId:config.clientId,tokenUse:'id',includeRawJwtInErrors:false,graceSeconds:0,
  customJwtCheck:({header,payload})=>{const now=Math.floor(Date.now()/1000),duration=typeof payload.iat==='number'&&typeof payload.exp==='number'?payload.exp-payload.iat:null;
   if(header.alg!=='RS256'||duration===null||typeof payload.iat!=='number'||payload.iat>now+30||duration<=0||duration>900){shadowCognitoDiagnostic('id_token_claim_policy',{algorithmMatches:header.alg==='RS256',duration,issuedInFuture:typeof payload.iat==='number'&&payload.iat>now+30});throw Error('Invalid ID token.');}}
 },options.jwksCache?{jwksCache:options.jwksCache}:undefined);
 return async(tokens:CognitoTokens,nonce:string)=>{
  let branch='id_token_signature_issuer_audience';
  try{
   const claims=await verifier.verify(tokens.idToken);
   branch='id_token_nonce';if(!/^[A-Za-z0-9_-]{43}$/.test(nonce)||claims.nonce!==nonce)throw Error();
   shadowCognitoDiagnostic('id_token_verified',{idDuration:typeof claims.exp==='number'&&typeof claims.iat==='number'?claims.exp-claims.iat:null});
   branch='access_token_verification';
   const identity=await access.verifySession(tokens.accessToken);
   branch='id_access_identity_consistency';if(!identity||identity.provider!=='cognito'||identity.issuer!==issuer||identity.subject!==claims.sub){
    shadowCognitoDiagnostic(branch,{mappingPresent:!!identity,issuerMatches:identity?.issuer===issuer,subjectMatches:identity?.subject===claims.sub});throw Error();
   }
   return {userId:identity.userId};
  }catch{shadowCognitoDiagnostic(branch);throw Error('Cognito callback token verification failed.');}
 };
}
