import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

export async function exerciseAuthRecovery({admin,url,publicKey,email,userId,browserRecovery=false}) {
 assert.equal(url,'https://wztqqqashilusoppddxi.supabase.co');
 assert.match(email,/^acceptance-[0-9a-f-]{36}@example\.invalid$/);
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const recovery=createClient(url,publicKey,options);const login=createClient(url,publicKey,options);
 const generated=await admin.auth.admin.generateLink({type:'recovery',email});assert.equal(Boolean(generated.error),false);
 const hash=generated.data.properties?.hashed_token;assert.ok(hash);
 const replacement=randomBytes(36).toString('base64url')+'Aa1!';
 if(browserRecovery){
  const {chromium}=await import('@playwright/test');const browser=await chromium.launch({headless:true});let stage='open recovery link';
  try {
   const baseURL='https://staging.tracepointhq.com';const context=await browser.newContext({baseURL});
   await context.route('**/*',route=>[baseURL,url].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
   const target=new URL('/auth/confirm',baseURL);target.searchParams.set('token_hash',hash);target.searchParams.set('type','recovery');target.searchParams.set('next','/auth/setup?next=/equipment');
   const confirmation=await context.request.get(target.toString(),{maxRedirects:0});assert.equal(confirmation.status(),307);const destination=new URL(confirmation.headers().location,baseURL);assert.equal(destination.origin,baseURL);
   const page=await context.newPage();await page.goto(destination.toString());await page.waitForURL(u=>u.pathname==='/auth/setup');stage='fill password form';
   await page.locator('input[name="password"]').fill(replacement);await page.locator('input[name="confirmPassword"]').fill(replacement);
   stage='submit password form';await page.getByRole('button',{name:'Save password and continue'}).click();await page.waitForURL(u=>u.pathname==='/equipment');
   stage='verify authenticated identity';const access=await context.request.get('/api/access');assert.equal(access.status(),200);assert.equal((await access.json()).access.userId,userId);
   stage='verify logout redirect';const logout=await context.request.post('/auth/signout',{maxRedirects:0});assert.equal(logout.status(),303);const logoutTarget=new URL(logout.headers().location,baseURL);assert.equal(logoutTarget.origin,baseURL);assert.equal(logoutTarget.pathname,'/login');
   stage='verify logged-out access';assert.equal((await context.request.get('/api/access',{maxRedirects:0})).status(),401);
  } catch(error){console.log(JSON.stringify({browserRecoveryStep:stage,networkCode:error?.message?.match(/net::[A-Z_]+/)?.[0],errorName:error?.name,errorClass:error?.name==='TimeoutError'?'BROWSER_TIMEOUT':error?.code==='ERR_ASSERTION'?'ASSERTION':'BROWSER_FAILURE'}));throw new Error('Browser recovery failed; sensitive details suppressed');} finally {await browser.close();}
 } else {
  const verified=await recovery.auth.verifyOtp({type:'recovery',token_hash:hash});assert.equal(Boolean(verified.error),false);assert.equal(verified.data.user?.id,userId);
  assert.equal(Boolean((await recovery.auth.updateUser({password:replacement})).error),false);
  assert.equal(Boolean((await recovery.auth.signOut({scope:'global'})).error),false);
 }
 const replay=await login.auth.verifyOtp({type:'recovery',token_hash:hash});assert.ok(replay.error);
 const signed=await login.auth.signInWithPassword({email,password:replacement});assert.equal(Boolean(signed.error),false);assert.equal(signed.data.user?.id,userId);
 const refreshToken=signed.data.session?.refresh_token;assert.ok(refreshToken);
 assert.equal(Boolean((await login.auth.signOut({scope:'global'})).error),false);
 assert.ok((await login.auth.refreshSession({refresh_token:refreshToken})).error);
 console.log(JSON.stringify({authenticationRecovery:'verified one-time recovery, password replacement, login and refresh-token revocation',browserRecovery:browserRecovery?'verified supported confirm/setup form':'not requested',emailDelivery:'not exercised; recovery token generated server-side for disposable fixture only'}));
}
