import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

export async function exerciseAuthRecovery({admin,url,publicKey,email,userId}) {
 assert.equal(url,'https://wztqqqashilusoppddxi.supabase.co');
 assert.match(email,/^acceptance-[0-9a-f-]{36}@example\.invalid$/);
 const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
 const recovery=createClient(url,publicKey,options);const login=createClient(url,publicKey,options);
 const generated=await admin.auth.admin.generateLink({type:'recovery',email});assert.equal(Boolean(generated.error),false);
 const hash=generated.data.properties?.hashed_token;assert.ok(hash);
 const verified=await recovery.auth.verifyOtp({type:'recovery',token_hash:hash});assert.equal(Boolean(verified.error),false);assert.equal(verified.data.user?.id,userId);
 const replacement=randomBytes(36).toString('base64url')+'Aa1!';
 assert.equal(Boolean((await recovery.auth.updateUser({password:replacement})).error),false);
 assert.equal(Boolean((await recovery.auth.signOut({scope:'global'})).error),false);
 const replay=await login.auth.verifyOtp({type:'recovery',token_hash:hash});assert.ok(replay.error);
 const signed=await login.auth.signInWithPassword({email,password:replacement});assert.equal(Boolean(signed.error),false);assert.equal(signed.data.user?.id,userId);
 const refreshToken=signed.data.session?.refresh_token;assert.ok(refreshToken);
 assert.equal(Boolean((await login.auth.signOut({scope:'global'})).error),false);
 assert.ok((await login.auth.refreshSession({refresh_token:refreshToken})).error);
 console.log(JSON.stringify({authenticationRecovery:'verified one-time recovery, password replacement, login and refresh-token revocation',emailDelivery:'not exercised; recovery token generated server-side for disposable fixture only'}));
}
