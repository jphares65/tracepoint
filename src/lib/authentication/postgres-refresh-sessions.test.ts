import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import pg from 'pg';import EmbeddedPostgres from 'embedded-postgres';
import {localPostgresPort} from '../../test-support/local-postgres-port.mjs';
import {PostgresCognitoRefreshStore,RefreshSessionSealer,type RefreshIdentity} from './postgres-refresh-sessions';
import {PostgresCognitoSessionStore} from './postgres-sessions';
let server:EmbeddedPostgres,pool:pg.Pool,directory:string;
const issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic',key=randomBytes(32);
const sealer=()=>new RefreshSessionSealer('current',new Map([['current',key]]));
const target={issuer,clientId:'syntheticclient'};
const store=()=>new PostgresCognitoRefreshStore(pool,sealer(),target);
before(async()=>{directory=await mkdtemp(path.join(tmpdir(),'tracepoint-refresh-test-'));const port=await localPostgresPort();server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'local-test-only',port,persistent:false,postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});await server.initialise();await server.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres'});
 await pool.query('create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key)');
 for(const f of ['202609050006_authentication_identity_links.sql','202609050010_authentication_session_state.sql','202609050011_authentication_refresh_state.sql'])await pool.query(await readFile('supabase/migrations/'+f,'utf8'));
});
after(async()=>{await pool?.end();await server?.stop();if(directory)await rm(directory,{recursive:true,force:true});});
async function fixture(){const userId=randomUUID(),subject=randomUUID(),now=Math.floor(Date.now()/1000);await pool.query('insert into profiles values($1)',[userId]);await pool.query("insert into authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state) values('cognito',$1,$2,$3,'active')",[issuer,subject,userId]);const identity:RefreshIdentity={userId,subject,issuer,clientId:'syntheticclient',authenticatedAt:now-1,expiresAt:now+3600};const token=randomBytes(40).toString('base64url');const created=await store().createVerified(identity,token);return {identity,token,...created};}
test('refresh state is encrypted, handle-hashed and survives key rotation without extending expiry',async()=>{
 const f=await fixture(),row=(await pool.query('select * from authentication_refresh_sessions where family_id=$1',[f.familyId])).rows[0];assert.notEqual(row.handle_hash,f.handle);assert.equal(row.sealed_payload.includes(f.token),false);
 const rotatedStore=new PostgresCognitoRefreshStore(pool,new RefreshSessionSealer('next',new Map([['current',key],['next',randomBytes(32)]])),target);
 const consumed=(await rotatedStore.consume(f.handle))!;assert.equal(consumed.refreshToken,f.token);const next=await rotatedStore.completeVerified(consumed,'rotated-synthetic-token');assert.notEqual(next.handle,f.handle);assert.equal(next.expiresAt,f.expiresAt);assert.equal(await store().consume(f.handle),null);assert.equal((await rotatedStore.consume(next.handle))?.refreshToken,'rotated-synthetic-token');
});
test('concurrent consume releases a token once and ambiguous acceptance cannot retry',async()=>{
 const f=await fixture(),outcomes=await Promise.all([store().consume(f.handle),store().consume(f.handle)]);assert.equal(outcomes.filter(Boolean).length,1);assert.equal(await store().consume(f.handle),null);
 const row=(await pool.query('select state,sealed_payload from authentication_refresh_sessions where family_id=$1',[f.familyId])).rows[0];assert.deepEqual(row,{state:'consumed',sealed_payload:null});
});
test('rotation completion cannot replay, change identity or revive a revoked family',async()=>{
 const f=await fixture(),consumed=(await store().consume(f.handle))!;
 await assert.rejects(store().completeVerified({...consumed,userId:randomUUID()},'new-token'),/new sign-in/);
 await assert.rejects(store().completeVerified({...consumed,clientId:'foreignclient'},'new-token'),/rotation/);
 const next=await store().completeVerified(consumed,'new-token');await assert.rejects(store().completeVerified(consumed,'second-token'),/new sign-in/);
 const second=(await store().consume(next.handle))!;await store().revokeFamily(f.familyId,{userId:f.identity.userId,issuer});await assert.rejects(store().completeVerified(second,'third-token'),/new sign-in/);
});
test('foreign owner cannot revoke a family; global revocation wins an in-flight refresh',async()=>{
 const f=await fixture();await store().revokeFamily(f.familyId,{userId:randomUUID(),issuer});const consumed=(await store().consume(f.handle))!;assert.ok(consumed);
 await new PostgresCognitoSessionStore(pool).revokeAll({userId:f.identity.userId,issuer});await assert.rejects(store().completeVerified(consumed,'rotated-token'),/new sign-in/);await assert.rejects(store().createVerified(f.identity,'new-family-token'),/rejected/);
});
test('inactive mapping and global revocation deny token release',async()=>{
 const f=await fixture();await pool.query("update authentication_identity_links set state='revoked' where tracepoint_user_id=$1",[f.identity.userId]);assert.equal(await store().consume(f.handle),null);
 const g=await fixture();await new PostgresCognitoSessionStore(pool).revokeAll({userId:g.identity.userId,issuer});assert.equal(await store().consume(g.handle),null);
});
test('ciphertext tampering or cross-family copy fails after irreversible local consumption',async()=>{
 const f=await fixture(),g=await fixture();await pool.query('update authentication_refresh_sessions set sealed_payload=(select sealed_payload from authentication_refresh_sessions where family_id=$1) where family_id=$2',[f.familyId,g.familyId]);await assert.rejects(store().consume(g.handle),/decrypted/);assert.equal(await store().consume(g.handle),null);assert.equal((await store().consume(f.handle))?.refreshToken,f.token);
});
test('malformed handles, excessive lifetime and missing encryption keys reject',async()=>{
 const f=await fixture();await assert.rejects(store().consume('../foreign'),/handle/);await assert.rejects(store().createVerified({...f.identity,expiresAt:f.identity.authenticatedAt+86401},'token'),/identity/);assert.throws(()=>new RefreshSessionSealer('absent',new Map([['current',key]])),/configuration/);await assert.rejects(store().completeVerified((await store().consume(f.handle))!,f.token),/rotation/);
});
test('browser roles have no refresh table access and ready state cannot omit ciphertext',async()=>{
 const f=await fixture();await assert.rejects(pool.query("update authentication_refresh_sessions set sealed_payload=null where family_id=$1",[f.familyId]),/check constraint/);
 const client=await pool.connect();try{for(const role of ['anon','authenticated']){await client.query('set role '+role);await assert.rejects(client.query('select * from authentication_refresh_sessions'),/permission denied/);await assert.rejects(client.query('delete from authentication_refresh_sessions'),/permission denied/);await client.query('reset role');}}finally{await client.query('reset role');client.release();}
});
test('another client cannot consume or revoke this client family',async()=>{
 const f=await fixture(),foreign=new PostgresCognitoRefreshStore(pool,sealer(),{issuer,clientId:'foreignclient'});
 assert.equal(await foreign.consume(f.handle),null);await foreign.revokeFamily(f.familyId,{userId:f.identity.userId,issuer});assert.equal((await store().consume(f.handle))?.refreshToken,f.token);
});
test('expired state is purged and connection failures expose no database detail',async()=>{
 const f=await fixture(),now=Math.floor(Date.now()/1000);await pool.query('update authentication_refresh_sessions set authenticated_at=to_timestamp($2),expires_at=to_timestamp($3) where family_id=$1',[f.familyId,now-3601,now-1]);assert.equal(await store().consume(f.handle),null);assert.equal(await store().purgeExpired(),1);
 const unavailable=new PostgresCognitoRefreshStore({connect:async()=>{throw Error('private connection detail');},query:pool.query.bind(pool)} as Pick<pg.Pool,'query'|'connect'>,sealer(),target);
 await assert.rejects(unavailable.consume(f.handle),{message:'Refresh persistence unavailable.'});
});
