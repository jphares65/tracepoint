import {assertCognitoConfiguration,type CognitoTokens} from './cognito-pkce';
import type {CognitoVerificationConfig} from './cognito-verifier';
import {cognitoManagedLoginOrigin} from './cognito-endpoints';

const validToken=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=16384&&!/[\s\x00-\x1f]/.test(value);

// Server-only, disabled composition. Hosted PKCE sessions use a public app
// client, so no client secret or IAM credential is accepted here. All endpoints
// are derived from reviewed configuration, never request parameters.
export function createCognitoTokenEndpoint(config:CognitoVerificationConfig,fetchImpl:typeof fetch=fetch){
 assertCognitoConfiguration(config);
 const domain=cognitoManagedLoginOrigin(config.environment,config.account,config.region);
 async function post(path:string,parameters:Record<string,string>){
  return fetchImpl(domain+path,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000),
   headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...parameters,client_id:config.clientId})});
 }
 return {
  async refresh(refreshToken:string):Promise<CognitoTokens>{
   try {
    if(!validToken(refreshToken))throw Error();
    // Exactly one request. Caller must consume durable state BEFORE invoking.
    const response=await post('/oauth2/token',{grant_type:'refresh_token',refresh_token:refreshToken});
    if(response.status!==200){await response.body?.cancel();throw Error();}
    const reader=response.body?.getReader();if(!reader)throw Error();const chunks:Uint8Array[]=[];let length=0;
    try {for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>65536)throw Error();chunks.push(part.value);}}
    finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(value?.token_type!=='Bearer'||!Number.isInteger(value.expires_in)||value.expires_in<1||value.expires_in>900||
     !validToken(value.access_token)||!validToken(value.id_token)||!validToken(value.refresh_token)||value.refresh_token===refreshToken)throw Error();
    // This response is unverified and must flow directly into the signed-token
    // refresh coordinator, never into a browser cookie or authorization check.
    return {accessToken:value.access_token,idToken:value.id_token,refreshToken:value.refresh_token,expiresIn:value.expires_in};
   } catch {throw Error('Cognito token exchange failed. Do not retry; start a new sign-in.');}
  },
  async revoke(refreshToken:string):Promise<void>{
   try {
    if(!validToken(refreshToken))throw Error();
    const response=await post('/oauth2/revoke',{token:refreshToken});
    await response.body?.cancel();if(response.status!==200)throw Error();
   } catch {throw Error('Cognito provider revocation is unconfirmed.');}
  }
 };
}
