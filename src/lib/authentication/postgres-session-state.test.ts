import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import pg from 'pg';import EmbeddedPostgres from 'embedded-postgres';
import {AuthenticationStateSealer,PostgresAuthorizationTransactionStore} from './postgres-transactions';
import {PostgresCognitoSessionStore} from './postgres-sessions';
import {createCognitoPkce} from './cognito-pkce';
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',subject='33333333-3333-4333-8333-333333333333',issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic';
let server:EmbeddedPostgres,pool:pg.Pool,directory:string;
before(async()=>{directory=await mkdtemp(path.join(tmpdir(),'tracepoint-session-test-'));const port=56000+Math.floor(Math.random()*4000);server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'local-test-only',port,persistent:false,initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});await server.initialise();await server.start();pool=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'local-test-only',database:'postgres'});
 await pool.query('create role anon;create role authenticated;create role service_role;create table profiles(id uuid primary key)');await pool.query('insert into profiles values($1),($2)',[user,other]);
 for(const f of ['202609050006_authentication_identity_links.sql','202609050010_authentication_session_state.sql'])await pool.query(await readFile('supabase/migrations/'+f,'utf8'));
 await pool.query("insert into authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state) values('cognito',$1,$2,$3,'active')",[issuer,subject,user]);
});
after(async()=>{await pool?.end();await server?.stop();if(directory)await rm(directory,{recursive:true,force:true});});
function session(){const issuedAt=Math.floor(Date.now()/1000);return {userId:user,issuer,subject,tokenId:randomUUID(),issuedAt,expiresAt:issuedAt+300};}
test('durable encrypted flow survives process composition and is consumed once under concurrency',async()=>{
 const key=randomBytes(32),sealer=new AuthenticationStateSealer('current',new Map([['current',key]])),store=new PostgresAuthorizationTransactionStore(pool,sealer);
 const api=createCognitoPkce({environment:'staging',account:'559054714699',region:'us-east-1',userPoolId:'us-east-1_Synthetic',clientId:'syntheticclient'},store);const flow=await api.begin();const row=(await pool.query('select handle_hash,sealed_payload from authentication_flow_transactions')).rows[0];assert.notEqual(row.handle_hash,flow.cookie.value);assert.equal(row.sealed_payload.includes('verifier'),false);
 const rotated=new PostgresAuthorizationTransactionStore(pool,new AuthenticationStateSealer('next',new Map([['current',key],['next',randomBytes(32)]])));
 const results=await Promise.all([rotated.take(flow.cookie.value),store.take(flow.cookie.value)]);assert.equal(results.filter(Boolean).length,1);assert.equal((await pool.query('select count(*)::int as n from authentication_flow_transactions')).rows[0].n,0);
 const tx=results.find(Boolean)!;assert.throws(()=>sealer.open(sealer.seal(tx,'one'),'other'),/decrypted/);const sealed=sealer.seal(tx,'one');assert.throws(()=>sealer.open(sealed.slice(0,-12)+'AAAAAAAAAAAA','one'),/decrypted/);
});
test('verified session persists and foreign identity cannot validate or revoke it',async()=>{
 const store=new PostgresCognitoSessionStore(pool),input=session();assert.equal(await store.isActive(input),false);await store.registerVerified(input);assert.equal(await new PostgresCognitoSessionStore(pool).isActive(input),true);
 assert.equal(await store.isActive({...input,userId:other}),false);assert.equal(await store.isActive({...input,issuer:issuer+'Foreign'}),false);await store.revokeToken({...input,userId:other});assert.equal(await store.isActive(input),true);
 await store.revokeToken(input);assert.equal(await store.isActive(input),false);await assert.rejects(store.registerVerified(input),/rejected/);assert.equal(await store.isActive(input),false);
});
test('inactive mapping, forged user mapping and excessive lifetime cannot register',async()=>{
 const store=new PostgresCognitoSessionStore(pool),input=session();await assert.rejects(store.registerVerified({...input,userId:other}),/rejected/);await assert.rejects(store.registerVerified({...input,expiresAt:input.issuedAt+3600}),/claims/);
 await pool.query("update authentication_identity_links set state='revoked'");await assert.rejects(store.registerVerified(input),/rejected/);await pool.query("update authentication_identity_links set state='active'");
});
test('global revocation persists a watermark and blocks re-registration of earlier tokens',async()=>{
 const store=new PostgresCognitoSessionStore(pool),input=session();await store.registerVerified(input);await store.revokeAll({userId:user,issuer});assert.equal(await store.isActive(input),false);await assert.rejects(store.registerVerified({...input,tokenId:randomUUID()}),/rejected/);
 assert.equal((await pool.query('select count(*)::int as n from authentication_session_revocations')).rows[0].n,1);
});
test('browser roles cannot read or mutate encrypted transactions, sessions or revocation state',async()=>{
 const client=await pool.connect();try{for(const role of ['anon','authenticated']){await client.query('set role '+role);for(const table of ['authentication_flow_transactions','authentication_access_sessions','authentication_session_revocations']){await assert.rejects(client.query('select * from '+table),/permission denied/);await assert.rejects(client.query('delete from '+table),/permission denied/);}await client.query('reset role');}}finally{await client.query('reset role');client.release();}
});
test('expired records and unavailable persistence fail closed',async()=>{
 const store=new PostgresCognitoSessionStore(pool),input=session();
 // Use another identity so the prior test's global revocation remains intact.
 await pool.query("insert into authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state) values('cognito',$1,$2,$3,'active')",[issuer,other,other]);
 const fresh={...input,userId:other,subject:other};await store.registerVerified(fresh);
 await pool.query("update authentication_access_sessions set issued_at=to_timestamp($2),expires_at=to_timestamp($3) where token_id=$1",[fresh.tokenId,fresh.issuedAt-600,fresh.issuedAt-300]);
 assert.equal(await store.isActive({...fresh,issuedAt:fresh.issuedAt-600}),false);assert.equal(await store.purgeExpired(),1);
 const unavailable=new PostgresCognitoSessionStore({query:async()=>{throw Error('private')},connect:pool.connect.bind(pool)} as Pick<pg.Pool,'query'|'connect'>);assert.equal(await unavailable.isActive(fresh),false);
});
