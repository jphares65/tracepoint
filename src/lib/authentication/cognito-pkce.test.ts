import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createCognitoAuthenticationProvider} from './cognito-verifier';
import {SimpleJwksCache,type Jwk} from 'aws-jwt-verify/jwk';
import {createCognitoPkce,createCognitoPkceTokenVerifier,type AuthorizationTransaction,type AuthorizationTransactionStore} from './cognito-pkce';
const config={environment:'staging' as const,account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient'};
const userId='11111111-1111-4111-8111-111111111111';
function fixture(fetcher?:typeof fetch){
 const transactions=new Map<string,AuthorizationTransaction>();let clock=Date.now(),calls=0;
 const store:AuthorizationTransactionStore={async put(k,v){transactions.set(k,v)},async take(k){const v=transactions.get(k);transactions.delete(k);return v??null}};
 const api=createCognitoPkce(config,store,fetcher??(async()=>{calls++;return Response.json({access_token:'synthetic-access',id_token:'synthetic-id',refresh_token:'synthetic-refresh',token_type:'Bearer',expires_in:300})}),()=>clock);
 return {api,transactions,advance(){clock+=300001},calls:()=>calls};
}
async function input(f:ReturnType<typeof fixture>){const begin=await f.api.begin();return {begin,callback:{handle:begin.cookie.value,state:new URL(begin.url).searchParams.get('state')!,code:'synthetic-code'}};}
test('PKCE challenge, nonce and hardened cookie bind the fixed staging callback',async()=>{
 const f=fixture();const {begin,callback}=await input(f),url=new URL(begin.url),tx=f.transactions.get(callback.handle)!;
 assert.equal(url.origin,'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com');
 assert.equal(url.searchParams.get('redirect_uri'),'https://staging.tracepointhq.com/api/auth/cognito/callback');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(tx.verifier).digest('base64url'));assert.equal(url.searchParams.get('nonce'),tx.nonce);assert.equal(begin.url.includes(tx.verifier),false);
 assert.deepEqual({...begin.cookie,value:'hidden'},{name:'__Host-tracepoint-cognito-flow',value:'hidden',httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:300});
 let verified=false;assert.deepEqual(await f.api.complete(callback,async(tokens,nonce)=>{assert.equal(nonce,tx.nonce);assert.equal(tokens.refreshToken,'synthetic-refresh');verified=true;return {userId}}),{userId});assert.equal(verified,true);
 await assert.rejects(f.api.complete(callback,async()=>({userId})),/new sign-in/);assert.equal(f.calls(),1);
});
test('state mismatch, expired transaction and concurrent replay cannot exchange twice',async()=>{
 for(const mode of ['mismatch','expiry','replay']){const f=fixture();const {callback}=await input(f);if(mode==='mismatch')callback.state='A'.repeat(43);if(mode==='expiry')f.advance();
 if(mode==='replay'){const outcomes=await Promise.allSettled([f.api.complete(callback,async()=>({userId})),f.api.complete(callback,async()=>({userId}))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.calls(),1);}
 else{await assert.rejects(f.api.complete(callback,async()=>({userId})),/new sign-in/);assert.equal(f.calls(),0);}
 }
});
test('ambiguous token exchange consumes transaction and is never automatically retried',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw Error('private transport detail')});const {callback}=await input(f);await assert.rejects(f.api.complete(callback,async()=>({userId})),{message:'Cognito authorization could not be completed. Start a new sign-in.'});await assert.rejects(f.api.complete(callback,async()=>({userId})));assert.equal(calls,1);
});
test('malformed responses and failed identity verification never return tokens or authenticate',async()=>{
 for(const body of [{token_type:'Basic'}, {token_type:'Bearer',expires_in:3600,access_token:'a',id_token:'b',refresh_token:'c'}]){const f=fixture(async()=>Response.json(body));await assert.rejects(f.api.complete((await input(f)).callback,async()=>({userId})));}
 const f=fixture();await assert.rejects(f.api.complete((await input(f)).callback,async()=>{throw Error('signature or mapping rejected')}),/new sign-in/);
});
test('exact environment, account and client boundaries reject before storing a transaction',()=>{
 const store={async put(){throw Error('unexpected')},async take(){return null}};
 for(const patch of [{account:'265544358665'},{account:'111111111111'},{environment:'production' as const},{region:'us-west-2'},{clientId:'client&redirect=evil'}])assert.throws(()=>createCognitoPkce({...config,...patch},store),/boundary/);
});

test('real signatures bind ID-token nonce and subject to active stable access identity',async()=>{
 const issuer='https://cognito-idp.us-east-1.amazonaws.com/'+config.userPoolId,nonce='N'.repeat(43),subject='22222222-2222-4222-8222-222222222222';
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const cache=new SimpleJwksCache({fetcher:{async fetch(){throw Error('Network disabled')}}});cache.addJwks(issuer+'/.well-known/jwks.json',{keys:[{...publicKey.export({format:'jwk'}),kid:'fixture',alg:'RS256',use:'sig'} as Jwk]});
 const jwt=(kind:'id'|'access',patch:Record<string,unknown>={})=>{const now=Math.floor(Date.now()/1000);const header=Buffer.from(JSON.stringify({kid:'fixture',alg:'RS256'})).toString('base64url');const body=Buffer.from(JSON.stringify({iss:issuer,sub:subject,token_use:kind,iat:now,exp:now+300,jti:'33333333-3333-4333-8333-333333333333',...(kind==='id'?{aud:config.clientId,nonce}:{client_id:config.clientId}),...patch})).toString('base64url');const unsigned=header+'.'+body;return unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');};
 const access=createCognitoAuthenticationProvider(config,{async findActive(){return {userId}}},async()=>true,{jwksCache:cache});const verify=createCognitoPkceTokenVerifier(config,access,{jwksCache:cache});
 const tokens={accessToken:jwt('access'),idToken:jwt('id'),refreshToken:'unused-synthetic',expiresIn:300};assert.deepEqual(await verify(tokens,nonce),{userId});
 for(const patch of [{nonce:'other'},{sub:userId},{aud:'other'},{token_use:'access'},{exp:1}])await assert.rejects(verify({...tokens,idToken:jwt('id',patch)},nonce),/verification failed/);
 const invalid=tokens.idToken.slice(0,-8)+'tampered';await assert.rejects(verify({...tokens,idToken:invalid},nonce));
 const revoked=createCognitoAuthenticationProvider(config,{async findActive(){return {userId}}},async()=>false,{jwksCache:cache});await assert.rejects(createCognitoPkceTokenVerifier(config,revoked,{jwksCache:cache})(tokens,nonce));
});
