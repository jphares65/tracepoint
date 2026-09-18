import assert from 'node:assert/strict';import {test} from 'node:test';
import {createCognitoTransport,type CognitoTransportPorts} from './cognito-transport';
import {createCognitoPkce,type AuthorizationTransaction} from './cognito-pkce';
const config={environment:'staging' as const,account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient'},origin='https://staging.tracepointhq.com';
const userId='11111111-1111-4111-8111-111111111111',handle='H'.repeat(43),nextHandle='J'.repeat(43);
function fixture(enabled=true){
 const transactions=new Map<string,AuthorizationTransaction>(),calls={establish:0,rotate:0,revoke:0,exchange:0};
 const pkce=createCognitoPkce(config,{async put(k,v){transactions.set(k,v);},async take(k){const value=transactions.get(k);transactions.delete(k);return value??null;}},async()=>{calls.exchange++;return Response.json({access_token:'provider-access-secret',id_token:'provider-id-secret',refresh_token:'provider-refresh-secret',expires_in:300,token_type:'Bearer'});});
 const ports:CognitoTransportPorts={pkce,async establish(tokens,nonce){calls.establish++;assert.equal(tokens.refreshToken,'provider-refresh-secret');assert.equal(nonce.length,43);return {userId,handle,expiresAt:Math.floor(Date.now()/1000)+3600};},async rotate(value){calls.rotate++;assert.equal(value,handle);return {userId,handle:nextHandle,expiresAt:Math.floor(Date.now()/1000)+3600};},async revoke(value){calls.revoke++;assert.equal(value,handle);}};
 return {api:createCognitoTransport(config,ports,{enabled}),ports,calls};
}
function post(path:string,headers:Record<string,string>={},body?:string){return new Request(origin+'/api/auth/cognito/'+path,{method:'POST',headers:{origin,'sec-fetch-site':'same-origin',...headers},body});}
test('disabled provider rejects before any port call',async()=>{const f=fixture(false);for(const [name,path] of [['begin','login'],['refresh','refresh'],['logout','logout']] as const)assert.equal((await f.api[name](post(path))).status,503);assert.deepEqual(f.calls,{establish:0,rotate:0,revoke:0,exchange:0});});
test('login requires same-origin POST and returns only hardened PKCE cookie',async()=>{
 const f=fixture();assert.equal((await f.api.begin(new Request(origin+'/api/auth/cognito/login'))).status,405);for(const foreign of ['https://evil.invalid','null',''])assert.equal((await f.api.begin(post('login',{origin:foreign}))).status,403);
 assert.equal((await f.api.begin(post('login',{'sec-fetch-site':'cross-site'}))).status,403);
 const response=await f.api.begin(post('login'));assert.equal(response.status,303);assert.equal(new URL(response.headers.get('location')!).origin,'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com');const cookie=response.headers.get('set-cookie')!;for(const required of ['__Host-tracepoint-cognito-flow=','HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=300'])assert.ok(cookie.includes(required));assert.equal(cookie.includes('Domain='),false);assert.ok(response.headers.get('cache-control')?.includes('no-store'));
});
test('callback consumes PKCE and returns opaque session without provider tokens or redirect injection',async()=>{
 const f=fixture(),begin=await f.api.begin(post('login',{},'next=%2Fsettings%3Ftab%3Dusers')),url=new URL(begin.headers.get('location')!);const flow=begin.headers.get('set-cookie')!.split(';')[0];
 const request=new Request(origin+'/api/auth/cognito/callback?'+new URLSearchParams({state:url.searchParams.get('state')!,code:'synthetic-code',returnTo:'https://evil.invalid'}),{headers:{cookie:flow}});
 const response=await f.api.callback(request);assert.equal(response.status,303);assert.equal(response.headers.get('location'),origin+'/settings?tab=users');assert.equal(response.headers.getSetCookie().length,2);assert.ok(response.headers.getSetCookie()[1].startsWith('__Host-tracepoint-cognito-session='+handle));assert.equal((await response.text()).includes('provider-'),false);assert.equal((await f.api.callback(request)).status,401);assert.equal(f.calls.establish,1);assert.equal(f.calls.exchange,1);
});
test('callback duplicate cookies or query values cannot reach token exchange',async()=>{
 const f=fixture();for(const query of ['state=a&state=b&code=c','state=a&code=b&error=denied','state=a&code=b']){const request=new Request(origin+'/api/auth/cognito/callback?'+query,{headers:{cookie:'__Host-tracepoint-cognito-flow='+handle+'; __Host-tracepoint-cognito-flow='+nextHandle}});assert.equal((await f.api.callback(request)).status,401);}assert.equal(f.calls.exchange,0);
});
test('refresh rejects CSRF and malformed cookies; successful rotation issues a new opaque handle',async()=>{
 const f=fixture(),cookie='__Host-tracepoint-cognito-session='+handle;assert.equal((await f.api.refresh(post('refresh',{cookie,origin:'https://evil.invalid'}))).status,403);assert.equal(f.calls.rotate,0);
 assert.equal((await f.api.refresh(post('refresh',{cookie:'__Host-tracepoint-cognito-session=../bad'}))).status,401);assert.equal(f.calls.rotate,0);
 const response=await f.api.refresh(post('refresh',{cookie}));assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie')?.includes(nextHandle));assert.equal(f.calls.rotate,1);
 f.ports.rotate=async()=>{throw Error('private provider response');};const denied=await f.api.refresh(post('refresh',{cookie}));assert.equal(denied.status,401);assert.ok(denied.headers.get('set-cookie')?.includes('Max-Age=0'));assert.equal((await denied.text()).includes('private'),false);
});
test('logout persists revocation before hosted logout redirect and never claims success on failure',async()=>{
 const f=fixture(),request=post('logout',{cookie:'__Host-tracepoint-cognito-session='+handle});const response=await f.api.logout(request);assert.equal(f.calls.revoke,1);assert.equal(response.status,303);const location=new URL(response.headers.get('location')!);assert.equal(location.pathname,'/logout');assert.equal(location.searchParams.get('logout_uri'),origin+'/login');assert.equal(response.headers.getSetCookie().length,4);
 f.ports.revoke=async()=>{throw Error('private store failure');};const failed=await f.api.logout(request);assert.equal(failed.status,503);assert.equal(failed.headers.has('location'),false);assert.equal((await failed.text()).includes('private'),false);
});
test('receipt lifetime and target boundary cannot be widened by transport ports',async()=>{
 const f=fixture();f.ports.rotate=async()=>({userId,handle,expiresAt:Math.floor(Date.now()/1000)+86401});assert.equal((await f.api.refresh(post('refresh',{cookie:'__Host-tracepoint-cognito-session='+handle}))).status,401);assert.throws(()=>createCognitoTransport({...config,account:'265544358665'},f.ports),/target/);
});
