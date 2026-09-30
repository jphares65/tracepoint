import assert from 'node:assert/strict';import {test} from 'node:test';
import {createCognitoTransport,inspectFlowCookie,type CognitoTransportPorts} from './cognito-transport';
import {createCognitoPkce,type AuthorizationTransaction} from './cognito-pkce';
const config={environment:'staging' as const,account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient',siteOrigin:'https://staging.tracepointhq.com',notificationMode:'normal' as const},origin='https://staging.tracepointhq.com';
const userId='11111111-1111-4111-8111-111111111111',handle='H'.repeat(43),nextHandle='J'.repeat(43);
function fixture(enabled=true){
 const transactions=new Map<string,AuthorizationTransaction>(),calls={establish:0,rotate:0,revoke:0,exchange:0};
 const pkce=createCognitoPkce(config,{async put(k,v){transactions.set(k,v);},async take(k){const value=transactions.get(k);transactions.delete(k);return value??null;}},async()=>{calls.exchange++;return Response.json({access_token:'provider-access-secret',id_token:'provider-id-secret',refresh_token:'provider-refresh-secret',expires_in:300,token_type:'Bearer'});});
 const ports:CognitoTransportPorts={pkce,async establish(tokens,nonce){calls.establish++;assert.equal(tokens.refreshToken,'provider-refresh-secret');assert.equal(nonce.length,43);return {userId,handle,expiresAt:Math.floor(Date.now()/1000)+3600};},async rotate(value){calls.rotate++;assert.equal(value,handle);return {userId,handle:nextHandle,expiresAt:Math.floor(Date.now()/1000)+3600};},async revoke(value){calls.revoke++;assert.equal(value,handle);}};
 return {api:createCognitoTransport(config,ports,{enabled}),ports,calls};
}
function post(path:string,headers:Record<string,string>={}){return new Request(origin+'/api/auth/cognito/'+path,{method:'POST',headers:{origin,'sec-fetch-site':'same-origin',...headers}});}
test('disabled provider rejects before any port call',async()=>{const f=fixture(false);for(const [name,path] of [['begin','login'],['refresh','refresh'],['logout','logout']] as const)assert.equal((await f.api[name](post(path))).status,503);assert.deepEqual(f.calls,{establish:0,rotate:0,revoke:0,exchange:0});});
test('login requires same-origin POST and returns only hardened PKCE cookie',async()=>{
 const f=fixture();assert.equal((await f.api.begin(new Request(origin+'/api/auth/cognito/login'))).status,405);for(const foreign of ['https://evil.invalid','null',''])assert.equal((await f.api.begin(post('login',{origin:foreign}))).status,403);
 assert.equal((await f.api.begin(post('login',{'sec-fetch-site':'cross-site'}))).status,403);
 const response=await f.api.begin(post('login'));assert.equal(response.status,303);assert.equal(new URL(response.headers.get('location')!).origin,'https://tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com');const cookie=response.headers.get('set-cookie')!;for(const required of ['__Host-tracepoint-cognito-flow=','HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=600'])assert.ok(cookie.includes(required));assert.equal(cookie.includes('Domain='),false);assert.ok(response.headers.get('cache-control')?.includes('no-store'));
});
test('dedicated rehearsal login redirects only to its hosted pool',async()=>{
 const rehearsal={...config,environment:'production' as const,account:'193644343389',
  userPoolId:'us-east-1_Dedicated',siteOrigin:'https://shadow-rehearsal.tracepointhq.com',
  notificationMode:'shadow' as const,rehearsalMode:'object-smoke' as const};
 const pkce=createCognitoPkce(rehearsal,{async put(){},async take(){return null}});
 const api=createCognitoTransport(rehearsal,{pkce,async establish(){throw Error('not reached')},
  async rotate(){throw Error('not reached')},async revoke(){}},{enabled:true});
 const response=await api.begin(new Request(rehearsal.siteOrigin+'/api/auth/cognito/login',
  {method:'POST',headers:{origin:rehearsal.siteOrigin,'sec-fetch-site':'same-origin'}}));
 assert.equal(response.status,303);
 assert.equal(new URL(response.headers.get('location')!).origin,
  'https://tracepoint-phase3c-rehearsal-193644343389.auth.us-east-1.amazoncognito.com');
});
test('callback consumes PKCE and returns opaque session without provider tokens or redirect injection',async()=>{
 const f=fixture(),begin=await f.api.begin(post('login')),url=new URL(begin.headers.get('location')!);const flow=begin.headers.get('set-cookie')!.split(';')[0];
 const request=new Request(origin+'/api/auth/cognito/callback?'+new URLSearchParams({state:url.searchParams.get('state')!,code:'synthetic-code',returnTo:'https://evil.invalid'}),{headers:{cookie:flow}});
 const response=await f.api.callback(request);assert.equal(response.status,303);assert.equal(response.headers.get('location'),origin+'/');assert.equal(response.headers.getSetCookie().length,2);assert.ok(response.headers.getSetCookie()[1].startsWith('__Host-tracepoint-cognito-session='+handle));assert.equal((await response.text()).includes('provider-'),false);assert.equal((await f.api.callback(request)).status,401);assert.equal(f.calls.establish,1);assert.equal(f.calls.exchange,1);
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
 const f=fixture(),request=post('logout',{cookie:'__Host-tracepoint-cognito-session='+handle});const response=await f.api.logout(request);assert.equal(f.calls.revoke,1);assert.equal(response.status,303);const location=new URL(response.headers.get('location')!);assert.equal(location.pathname,'/logout');assert.equal(location.searchParams.get('logout_uri'),origin+'/login');
 const cookies=response.headers.getSetCookie();assert.equal(cookies.length,4);
 for(const name of ['tracepoint_department_id','tracepoint_support_department_id'])
  assert.ok(cookies.some(value=>value.startsWith(name+'=;')&&value.includes('Max-Age=0')&&value.includes('HttpOnly')&&value.includes('Secure')));
 f.ports.revoke=async()=>{throw Error('private store failure');};const failed=await f.api.logout(request);assert.equal(failed.status,503);assert.equal(failed.headers.has('location'),false);assert.equal((await failed.text()).includes('private'),false);
 assert.equal(failed.headers.getSetCookie().length,4);
});
test('transport refuses a PKCE cookie lifetime divergent from the server contract',async()=>{
 const f=fixture(),begin=f.ports.pkce.begin;
 f.ports.pkce.begin=async()=>{const flow=await begin();return {...flow,cookie:{...flow.cookie,maxAge:601}}};
 assert.equal((await f.api.begin(post('login'))).status,503);
});
test('shadow cookie inspection distinguishes missing, duplicate, empty, malformed and valid without returning values to diagnostics',()=>{
 const callback=origin+'/api/auth/cognito/callback?state=hidden&code=hidden';
 const inspect=(cookie?:string)=>inspectFlowCookie(new Request(callback,{headers:cookie?{cookie}:{}}));
 assert.deepEqual(inspect(),{present:false,count:0,empty:false,malformed:false,valid:false,handle:null});
 assert.equal(inspect('__Host-tracepoint-cognito-flow=').empty,true);
 assert.equal(inspect('__Host-tracepoint-cognito-flow=bad').malformed,true);
 assert.equal(inspect('__Host-tracepoint-cognito-flow='+handle).valid,true);
 assert.equal(inspect('__Host-tracepoint-cognito-flow='+handle+'; __Host-tracepoint-cognito-flow='+nextHandle).count,2);
});
test('shadow transport never redirects login or logout to the production site',async()=>{
 const shadow='https://shadow.tracepointhq.com';
 const shadowConfig={...config,environment:'production' as const,account:'193644343389',siteOrigin:shadow,notificationMode:'shadow' as const};
 const pkce=createCognitoPkce(shadowConfig,{async put(){},async take(){return null}});
 const api=createCognitoTransport(shadowConfig,{pkce,async establish(){throw Error('not reached')},async rotate(){throw Error('not reached')},async revoke(){}},{enabled:true});
 const login=await api.begin(new Request(shadow+'/api/auth/cognito/login',{method:'POST',headers:{origin:shadow,'sec-fetch-site':'same-origin'}}));
 assert.equal(login.status,303);
 assert.equal(new URL(login.headers.get('location')!).searchParams.get('redirect_uri'),shadow+'/api/auth/cognito/callback');
 const logout=await api.logout(new Request(shadow+'/api/auth/cognito/logout',{method:'POST',headers:{origin:shadow,'sec-fetch-site':'same-origin',cookie:'__Host-tracepoint-cognito-session='+handle}}));
 assert.equal(logout.status,303);
 assert.equal(new URL(logout.headers.get('location')!).searchParams.get('logout_uri'),shadow+'/login');
 assert.equal((await api.begin(new Request(origin+'/api/auth/cognito/login',{method:'POST',headers:{origin}}))).status,400);
});
test('shadow accepts only its exact ALB-forwarded HTTPS origin when Next exposes the internal ECS URL',async()=>{
 const shadow='https://shadow.tracepointhq.com';
 const shadowConfig={...config,environment:'production' as const,account:'193644343389',siteOrigin:shadow,notificationMode:'shadow' as const};
 const pkce=createCognitoPkce(shadowConfig,{async put(){},async take(){return null}});
 const api=createCognitoTransport(shadowConfig,{pkce,async establish(){throw Error('not reached')},async rotate(){throw Error('not reached')},async revoke(){}},{enabled:true});
 const internal='https://ip-10-40-0-90.ec2.internal:3000/api/auth/cognito/login';
 const boundAddress='https://0.0.0.0:3000/api/auth/cognito/login';
 const headers={host:'shadow.tracepointhq.com','x-forwarded-host':'shadow.tracepointhq.com','x-forwarded-proto':'https',origin:shadow,'sec-fetch-site':'same-origin'};
 const begin=(url:string,overrides:Record<string,string>={})=>api.begin(new Request(url,{method:'POST',headers:{...headers,...overrides}}));
 const accepted=await begin(internal);assert.equal(accepted.status,303);
 assert.equal(new URL(accepted.headers.get('location')!).searchParams.get('redirect_uri'),shadow+'/api/auth/cognito/callback');
 assert.equal((await begin(boundAddress)).status,303);
 for(const target of [internal,boundAddress])
  for(const overrides of ([{'x-forwarded-host':'tracepointhq.com'},{'x-forwarded-proto':'http'},{host:'tracepointhq.com'}] as Record<string,string>[]))
   assert.equal((await begin(target,overrides)).status,400);
 assert.equal((await begin('http://0.0.0.0:3000/api/auth/cognito/login')).status,400);
 assert.equal((await begin('https://0.0.0.0:3001/api/auth/cognito/login')).status,400);
 const callback=await api.callback(new Request('https://0.0.0.0:3000/api/auth/cognito/callback?state=a&code=b',{headers}));
 assert.equal(callback.status,401); // Passed the origin guard; absent flow cookie fails closed.
 assert.equal((await begin(internal,{origin:'https://tracepointhq.com'})).status,403);
 assert.equal((await begin(internal,{'sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await begin('https://evil.invalid:3000/api/auth/cognito/login')).status,400);
 const productionConfig={...shadowConfig,siteOrigin:'https://tracepointhq.com',notificationMode:'normal' as const};
 const production=createCognitoTransport(productionConfig,{pkce,async establish(){throw Error('not reached')},async rotate(){throw Error('not reached')},async revoke(){}},{enabled:true});
 assert.equal((await production.begin(new Request(boundAddress,{method:'POST',headers:{...headers,origin:'https://tracepointhq.com'}}))).status,400);
});
test('production accepts only the exact HTTPS-forwarded container hop for login start',async()=>{
 const site='https://tracepointhq.com';
 const productionConfig={...config,environment:'production' as const,account:'193644343389',siteOrigin:site,notificationMode:'normal' as const};
 const pkce=createCognitoPkce(productionConfig,{async put(){},async take(){return null}});
 const api=createCognitoTransport(productionConfig,{pkce,async establish(){throw Error('not reached')},async rotate(){throw Error('not reached')},async revoke(){}},{enabled:true});
 const headers={host:'tracepointhq.com','x-forwarded-host':'tracepointhq.com','x-forwarded-proto':'https',origin:site,'sec-fetch-site':'same-origin'};
 const begin=(url:string,overrides:Record<string,string>={})=>api.begin(new Request(url,{method:'POST',headers:{...headers,...overrides}}));
 for(const authority of ['http://0.0.0.0:3000','https://0.0.0.0:3000','http://tracepointhq.com']){
  const response=await begin(authority+'/api/auth/cognito/login');
  assert.equal(response.status,303);
  assert.equal(new URL(response.headers.get('location')!).searchParams.get('redirect_uri'),site+'/api/auth/cognito/callback');
  for(const override of ([{host:'evil.invalid'},{'x-forwarded-host':'evil.invalid'},{'x-forwarded-proto':'http'}] as Record<string,string>[]))
   assert.equal((await begin(authority+'/api/auth/cognito/login',override)).status,400);
  assert.equal((await begin(authority+'/api/auth/cognito/login',{origin:'https://evil.invalid'})).status,403);
  const callback=await api.callback(new Request(authority+'/api/auth/cognito/callback?state=a&code=b',{headers}));
  assert.equal(callback.status,401); // The proxy guard accepts it; absent PKCE cookie fails closed.
 }
 for(const url of ['http://0.0.0.0:3001/api/auth/cognito/login','http://evil.invalid/api/auth/cognito/login'])
  assert.equal((await begin(url)).status,400);
});
test('staging accepts only its exact HTTPS-forwarded container hop for login start',async()=>{
 const pkce=createCognitoPkce(config,{async put(){},async take(){return null}});
 const api=createCognitoTransport(config,{pkce,async establish(){throw Error('not reached')},async rotate(){throw Error('not reached')},async revoke(){}},{enabled:true});
 const headers={host:'staging.tracepointhq.com','x-forwarded-host':'staging.tracepointhq.com','x-forwarded-proto':'https',origin, 'sec-fetch-site':'same-origin'};
 const begin=(url:string,overrides:Record<string,string>={})=>api.begin(new Request(url,{method:'POST',headers:{...headers,...overrides}}));
 for(const authority of ['http://0.0.0.0:3000','https://0.0.0.0:3000','http://staging.tracepointhq.com']){
  const response=await begin(authority+'/api/auth/cognito/login');
  assert.equal(response.status,303);
  assert.equal(new URL(response.headers.get('location')!).searchParams.get('redirect_uri'),origin+'/api/auth/cognito/callback');
  for(const override of ([{host:'evil.invalid'},{'x-forwarded-host':'evil.invalid'},{'x-forwarded-proto':'http'}] as Record<string,string>[]))
   assert.equal((await begin(authority+'/api/auth/cognito/login',override)).status,400);
 }
 for(const url of ['http://0.0.0.0:3001/api/auth/cognito/login','http://evil.invalid/api/auth/cognito/login'])
  assert.equal((await begin(url)).status,400);
});
test('receipt lifetime and target boundary cannot be widened by transport ports',async()=>{
 const f=fixture();f.ports.rotate=async()=>({userId,handle,expiresAt:Math.floor(Date.now()/1000)+86401});assert.equal((await f.api.refresh(post('refresh',{cookie:'__Host-tracepoint-cognito-session='+handle}))).status,401);assert.throws(()=>createCognitoTransport({...config,account:'265544358665'},f.ports),/target/);
});
