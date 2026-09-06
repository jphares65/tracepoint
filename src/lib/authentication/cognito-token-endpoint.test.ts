import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCognitoTokenEndpoint} from './cognito-token-endpoint';
const config={environment:'staging' as const,account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient'};
const response={token_type:'Bearer',expires_in:300,access_token:'synthetic-access',id_token:'synthetic-id',refresh_token:'synthetic-rotated'};
test('refresh posts once to the fixed client and domain with redirects and caching disabled',async()=>{
 let calls=0;const endpoint=createCognitoTokenEndpoint(config,async(url,options)=>{
  calls++;assert.equal(url,'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com/oauth2/token');
  assert.equal(options?.method,'POST');assert.equal(options?.redirect,'error');assert.equal(options?.credentials,'omit');assert.equal(options?.cache,'no-store');assert.ok(options?.signal);
  assert.deepEqual(Object.fromEntries(options?.body as URLSearchParams),{grant_type:'refresh_token',refresh_token:'synthetic-original',client_id:config.clientId});
  return Response.json(response);
 });
 assert.deepEqual(await endpoint.refresh('synthetic-original'),{accessToken:response.access_token,idToken:response.id_token,refreshToken:response.refresh_token,expiresIn:300});assert.equal(calls,1);
});
test('transport errors and non-success statuses are sanitized and never retried',async()=>{
 for(const status of [0,302,400,429,500]){let calls=0;const endpoint=createCognitoTokenEndpoint(config,async()=>{calls++;if(!status)throw Error('private provider detail');return new Response('private provider detail',{status});});
  await assert.rejects(endpoint.refresh('synthetic-original'),{message:'Cognito token exchange failed. Do not retry; start a new sign-in.'});assert.equal(calls,1);
 }
});
test('unrotated missing malformed and excessive token responses fail closed',async()=>{
 for(const value of [{...response,refresh_token:'synthetic-original'},{...response,refresh_token:undefined},{...response,access_token:'bad token'},{...response,expires_in:901},{...response,token_type:'Basic'},{...response,id_token:'x'.repeat(16385)},null]){
  const endpoint=createCognitoTokenEndpoint(config,async()=>Response.json(value));await assert.rejects(endpoint.refresh('synthetic-original'));
 }
 const endpoint=createCognitoTokenEndpoint(config,async()=>new Response('x'.repeat(65537)));await assert.rejects(endpoint.refresh('synthetic-original'));
});
test('invalid input and wrong environment fail before network access',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{calls++;return Response.json(response);};
 for(const patch of [{account:'265544358665'},{account:'111111111111'},{region:'us-west-2'},{clientId:'client&injected=true'}])assert.throws(()=>createCognitoTokenEndpoint({...config,...patch},fetcher));
 const endpoint=createCognitoTokenEndpoint(config,fetcher);for(const token of ['', 'bad token','x'.repeat(16385)]){await assert.rejects(endpoint.refresh(token));await assert.rejects(endpoint.revoke(token));}assert.equal(calls,0);
});
test('revocation uses the configured client and reports ambiguous acceptance',async()=>{
 let calls=0;const endpoint=createCognitoTokenEndpoint(config,async(url,options)=>{calls++;assert.ok(String(url).endsWith('/oauth2/revoke'));assert.deepEqual(Object.fromEntries(options?.body as URLSearchParams),{token:'synthetic-original',client_id:config.clientId});return new Response(null,{status:200});});
 await endpoint.revoke('synthetic-original');assert.equal(calls,1);
 const failing=createCognitoTokenEndpoint(config,async()=>{throw Error('sensitive');});await assert.rejects(failing.revoke('synthetic-original'),{message:'Cognito provider revocation is unconfirmed.'});
});
