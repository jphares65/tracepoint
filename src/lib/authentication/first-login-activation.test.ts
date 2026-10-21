import assert from 'node:assert/strict';
import {test,before,after,beforeEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import {localPostgresPort} from '../../test-support/local-postgres-port.mjs';
import {PostgresCognitoSessionStore} from './postgres-sessions';
import {FirstLoginIdentityMappingStore,PostgresIdentityMappingStore} from './postgres-mapping';

// NEW-ADM-A: an invited/imported user's pending Cognito link must become active
// on the first verified sign-in, and only then.
const departmentA='dddddddd-0000-4000-8000-00000000000a',departmentB='dddddddd-0000-4000-8000-00000000000b';
const user='70000000-0000-4000-8000-000000000001',subject='50000000-0000-4000-8000-000000000001';
const issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL';
let server:EmbeddedPostgres,admin:pg.Pool,runtime:pg.Pool,directory:string;

before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'tracepoint-first-login-activation-'));
  const port=await localPostgresPort();
  server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'synthetic-local-only',port,persistent:true,postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
  await server.initialise();await server.start();
  admin=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'synthetic-local-only',database:'postgres'});
  await admin.query(`
    create role anon; create role authenticated; create role service_role;
    create role tracepoint_runtime login password 'synthetic-runtime-only'; grant authenticated to tracepoint_runtime;
    create schema tracepoint_auth;
    create table public.authentication_identity_links(provider text,issuer text,subject text,tracepoint_user_id uuid,state text,provider_username text,updated_at timestamptz default now(),primary key(provider,issuer,subject));
    create table public.department_memberships(department_id uuid,user_id uuid,is_active boolean,deactivated_at timestamptz,activation_status text,primary key(department_id,user_id));
    create table public.authentication_identity_events(tracepoint_user_id uuid,provider text,issuer text,subject text,provider_username text,event_type text,actor_user_id uuid,operation_id uuid);
    create table public.audit_events(department_id uuid,actor_user_id uuid,action text,entity_type text,entity_id uuid,summary text,new_value jsonb);
    create table public.authentication_access_sessions(provider text default 'cognito',issuer text,subject text,tracepoint_user_id uuid,token_id uuid,issued_at timestamptz,expires_at timestamptz,revoked_at timestamptz);
    create table public.authentication_session_revocations(tracepoint_user_id uuid,issuer text,revoked_before timestamptz);
    grant usage on schema public,tracepoint_auth to tracepoint_runtime;
    grant select,update on public.authentication_identity_links to tracepoint_runtime;
    grant select,insert on public.authentication_access_sessions to tracepoint_runtime;
    grant select on public.authentication_session_revocations to tracepoint_runtime;
    -- Session registration checks the baseline grant as authenticated (no platform administrators here).
    create function public.is_platform_admin() returns boolean language sql stable as 'select false';
    grant execute on function public.is_platform_admin() to authenticated;
    grant select on public.department_memberships to authenticated;
  `);
  await admin.query(await readFile('database/aws/049_account_access_remediation.sql','utf8'));
  runtime=new pg.Pool({host:'127.0.0.1',port,user:'tracepoint_runtime',password:'synthetic-runtime-only',database:'postgres'});
});
after(async()=>{await runtime?.end();await admin?.end();await server?.stop();if(directory)await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
beforeEach(async()=>{
  await admin.query('truncate public.authentication_access_sessions,public.authentication_session_revocations,public.audit_events,public.authentication_identity_events,public.department_memberships,public.authentication_identity_links');
  await admin.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,$2,$3,'pending',$2)",[issuer,subject,user]);
  await admin.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activation_sent')",[departmentA,user]);
});

const initialMapping=()=>new FirstLoginIdentityMappingStore(new PostgresIdentityMappingStore(runtime),runtime);
const initialSessions=()=>new PostgresCognitoSessionStore(runtime,false,true);
function verifiedInput(userId=user){const now=Math.floor(Date.now()/1000);return {userId,issuer,subject,tokenId:randomUUID(),issuedAt:now,expiresAt:now+300};}
async function state(){
  const link=(await admin.query('select state from public.authentication_identity_links where subject=$1',[subject])).rows[0]?.state;
  const memberships=(await admin.query('select department_id,activation_status from public.department_memberships order by department_id')).rows.map(row=>row.activation_status);
  const audit=(await admin.query("select count(*)::int n from public.audit_events where action='account_activated'")).rows[0].n;
  const activated=(await admin.query("select count(*)::int n from public.authentication_identity_events where event_type='activated'")).rows[0].n;
  const sessions=(await admin.query('select count(*)::int n from public.authentication_access_sessions')).rows[0].n;
  return {link,memberships,audit,activated,sessions};
}

test('first verified sign-in activates a pending invite with an active membership',async()=>{
  assert.equal(await new PostgresIdentityMappingStore(runtime).findActive(issuer,subject),null);
  assert.deepEqual(await initialMapping().findActive(issuer,subject),{userId:user});
  const sessions=initialSessions(),input=verifiedInput();
  await sessions.registerVerified(input);
  assert.equal(await sessions.isActive(input),true);
  assert.deepEqual(await state(),{link:'active',memberships:['activated'],audit:1,activated:1,sessions:1});
  assert.deepEqual(await new PostgresIdentityMappingStore(runtime).findActive(issuer,subject),{userId:user});
});
test('an already-active user signs in unchanged, with no activation event',async()=>{
  await admin.query("update public.authentication_identity_links set state='active'");
  await admin.query("update public.department_memberships set activation_status='activated'");
  assert.deepEqual(await initialMapping().findActive(issuer,subject),{userId:user});
  await initialSessions().registerVerified(verifiedInput());
  assert.deepEqual(await state(),{link:'active',memberships:['activated'],audit:0,activated:0,sessions:1});
});
test('a revoked identity is neither mapped nor activated',async()=>{
  await admin.query("update public.authentication_identity_links set state='revoked'");
  assert.equal(await initialMapping().findActive(issuer,subject),null);
  await assert.rejects(initialSessions().registerVerified(verifiedInput()),/rejected/);
  assert.equal(await runtime.query('select tracepoint_auth.activate_cognito_identity_on_first_login($1,$2,$3) as id',[issuer,subject,user]).then(r=>r.rows[0].id),null);
  assert.deepEqual(await state(),{link:'revoked',memberships:['activation_sent'],audit:0,activated:0,sessions:0});
});
test('a pending identity whose membership is inactive is not activated',async()=>{
  await admin.query('update public.department_memberships set is_active=false,deactivated_at=now()');
  await assert.rejects(initialSessions().registerVerified(verifiedInput()),/rejected/);
  assert.deepEqual(await state(),{link:'pending',memberships:['activation_sent'],audit:0,activated:0,sessions:0});
});
test('only active memberships are marked activated',async()=>{
  await admin.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,false,'activation_sent')",[departmentB,user]);
  await initialSessions().registerVerified(verifiedInput());
  assert.deepEqual(await state(),{link:'active',memberships:['activated','activation_sent'],audit:1,activated:1,sessions:1});
});
test('a subject linked to another user is not activated',async()=>{
  await assert.rejects(initialSessions().registerVerified(verifiedInput(randomUUID())),/rejected/);
  assert.deepEqual(await state(),{link:'pending',memberships:['activation_sent'],audit:0,activated:0,sessions:0});
});
test('ordinary (non-initial) session registration still requires an active link',async()=>{
  await assert.rejects(new PostgresCognitoSessionStore(runtime).registerVerified(verifiedInput()),/rejected/);
  assert.deepEqual(await state(),{link:'pending',memberships:['activation_sent'],audit:0,activated:0,sessions:0});
});
test('activation is callable only by the runtime login, not by authenticated or other sessions',async()=>{
  await assert.rejects(admin.query('select tracepoint_auth.activate_cognito_identity_on_first_login($1,$2,$3)',[issuer,subject,user]),{code:'42501'});
  const client=await runtime.connect();
  try{await client.query('begin');await client.query('set local role authenticated');
    await assert.rejects(client.query('select tracepoint_auth.activate_cognito_identity_on_first_login($1,$2,$3)',[issuer,subject,user]),/permission denied/);
  }finally{await client.query('rollback');client.release();}
  assert.equal((await state()).link,'pending');
});
