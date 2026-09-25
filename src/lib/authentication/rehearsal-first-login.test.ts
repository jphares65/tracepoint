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
import {PostgresIdentityMappingStore,RehearsalInitialIdentityMappingStore} from './postgres-mapping';

const department='d01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0';
const user='b3848045-a73a-4f81-8a0e-cbd92abcd1be';
const operation='d6965d2e-1c0c-4c1f-9e47-57dc08a5e02c';
const subject='445834f8-2071-7015-690e-20674d04f5c3';
const issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_wZwXHpznS';
const email='jphares@tracepointhq.com';
let server:EmbeddedPostgres,admin:pg.Pool,runtime:pg.Pool,directory:string;

before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'tracepoint-rehearsal-first-login-'));
  const port=await localPostgresPort();
  server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'synthetic-local-only',port,persistent:true,postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
  await server.initialise();await server.start();
  admin=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'synthetic-local-only',database:'postgres'});
  await admin.query(`
    create role anon; create role authenticated; create role service_role;
    create role tracepoint_runtime login password 'synthetic-runtime-only';
    create schema auth; create schema tracepoint_auth;
    create table public.profiles(id uuid primary key,email text);
    create table auth.users(id uuid primary key,email text);
    create table public.authentication_identity_links(provider text,issuer text,subject text,tracepoint_user_id uuid,state text,provider_username text,updated_at timestamptz default now(),primary key(provider,issuer,subject));
    create table public.department_memberships(department_id uuid,user_id uuid,is_active boolean,deactivated_at timestamptz,activation_status text,updated_at timestamptz default now(),primary key(department_id,user_id));
    create table public.department_membership_roles(department_id uuid,user_id uuid,role_code text);
    create table public.authentication_lifecycle_operations(id uuid primary key,tracepoint_user_id uuid,department_id uuid,operation_kind text,state text,provider_subject text,provider_username text,safe_error_code text);
    create table public.authentication_identity_events(tracepoint_user_id uuid,provider text,issuer text,subject text,provider_username text,event_type text,actor_user_id uuid,operation_id uuid);
    create table public.user_activation_tokens(user_id uuid,used_at timestamptz,revoked_at timestamptz);
    create table public.audit_events(department_id uuid,actor_user_id uuid,action text,entity_type text,entity_id uuid,summary text,new_value jsonb);
    create table public.authentication_access_sessions(issuer text,subject text,tracepoint_user_id uuid,token_id uuid,issued_at timestamptz,expires_at timestamptz,revoked_at timestamptz);
    create table public.authentication_session_revocations(tracepoint_user_id uuid,issuer text,revoked_before timestamptz);
    grant usage on schema public,tracepoint_auth to tracepoint_runtime;
    grant select,update on public.authentication_identity_links to tracepoint_runtime;
    grant select on public.authentication_access_sessions,public.authentication_session_revocations to tracepoint_runtime;
    grant insert on public.authentication_access_sessions to tracepoint_runtime;
  `);
  await admin.query(await readFile('database/rehearsal/001_readington_officer_first_login.sql','utf8'));
  runtime=new pg.Pool({host:'127.0.0.1',port,user:'tracepoint_runtime',password:'synthetic-runtime-only',database:'postgres'});
});
after(async()=>{await runtime?.end();await admin?.end();await server?.stop();if(directory)await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
beforeEach(async()=>{
  await admin.query('drop trigger if exists rehearsal_audit_failure on public.audit_events');
  await admin.query('drop function if exists public.reject_rehearsal_audit()');
  await admin.query(`truncate public.authentication_access_sessions,public.authentication_session_revocations,public.audit_events,public.authentication_identity_events,public.user_activation_tokens,public.authentication_lifecycle_operations,public.department_membership_roles,public.department_memberships,public.authentication_identity_links,public.profiles,auth.users`);
  await admin.query('insert into public.profiles values($1,$2)',[user,email]);
  await admin.query('insert into auth.users values($1,$2)',[user,email]);
  await admin.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,$2,$3,'pending',$2)",[issuer,subject,user]);
  await admin.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activation_sent')",[department,user]);
  await admin.query("insert into public.department_membership_roles values($1,$2,'officer')",[department,user]);
  await admin.query("insert into public.authentication_lifecycle_operations values($1,$2,$3,'invite','committed',$4,$4,null)",[operation,user,department,subject]);
  await admin.query("insert into public.authentication_identity_events(tracepoint_user_id,provider,issuer,subject,provider_username,event_type,actor_user_id,operation_id) values($1,'cognito',$2,$3,$3,'linked',$1,$4)",[user,issuer,subject,operation]);
});

async function state(){
  const link=(await admin.query('select state from public.authentication_identity_links where subject=$1',[subject])).rows[0]?.state;
  const membership=(await admin.query('select activation_status from public.department_memberships')).rows[0]?.activation_status;
  const audit=(await admin.query("select count(*)::int n from public.audit_events where action='account_activated'")).rows[0].n;
  const activated=(await admin.query("select count(*)::int n from public.authentication_identity_events where event_type='activated'")).rows[0].n;
  const sessions=(await admin.query('select count(*)::int n from public.authentication_access_sessions')).rows[0].n;
  return {link,membership,audit,activated,sessions};
}
async function rejectPromotion(){
  await assert.rejects(runtime.query('select tracepoint_auth.promote_rehearsal_readington_officer_first_login($1,$2,$3)',[issuer,subject,user]),{code:'42501'});
  assert.deepEqual(await state(),{link:'pending',membership:'activation_sent',audit:0,activated:0,sessions:0});
}
function verifiedInput(){const now=Math.floor(Date.now()/1000);return {userId:user,issuer,subject,tokenId:randomUUID(),issuedAt:now,expiresAt:now+300};}

test('verified initial mapping promotes atomically with session and writes one audit/event',async()=>{
  const initial=new RehearsalInitialIdentityMappingStore(new PostgresIdentityMappingStore(runtime),runtime);
  assert.deepEqual(await initial.findActive(issuer,subject),{userId:user});
  assert.equal(await new PostgresIdentityMappingStore(runtime).findActive(issuer,subject),null);
  await new PostgresCognitoSessionStore(runtime,true).registerVerified(verifiedInput());
  assert.deepEqual(await state(),{link:'active',membership:'activated',audit:1,activated:1,sessions:1});
  assert.deepEqual(await new PostgresIdentityMappingStore(runtime).findActive(issuer,subject),{userId:user});
});
test('wrong subject fails before mapping or promotion',async()=>{
  const initial=new RehearsalInitialIdentityMappingStore(new PostgresIdentityMappingStore(runtime),runtime);
  assert.equal(await initial.findActive(issuer,randomUUID()),null);
  await assert.rejects(runtime.query('select tracepoint_auth.promote_rehearsal_readington_officer_first_login($1,$2,$3)',[issuer,randomUUID(),user]),{code:'42501'});
  assert.deepEqual(await state(),{link:'pending',membership:'activation_sent',audit:0,activated:0,sessions:0});
});
test('wrong tenant fails closed',async()=>{await admin.query('update public.department_memberships set department_id=$1',[randomUUID()]);await rejectPromotion();});
test('wrong role fails closed',async()=>{await admin.query("update public.department_membership_roles set role_code='administrator'");await rejectPromotion();});
test('missing membership fails closed',async()=>{await admin.query('delete from public.department_memberships');await assert.rejects(runtime.query('select tracepoint_auth.promote_rehearsal_readington_officer_first_login($1,$2,$3)',[issuer,subject,user]),{code:'42501'});assert.equal((await state()).link,'pending');});
test('duplicate identity link fails closed',async()=>{await admin.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,$2,$3,'active',$2)",[issuer,randomUUID(),user]);await rejectPromotion();});
test('already-active link cannot be promoted again',async()=>{await admin.query("update public.authentication_identity_links set state='active'");await assert.rejects(runtime.query('select tracepoint_auth.promote_rehearsal_readington_officer_first_login($1,$2,$3)',[issuer,subject,user]),{code:'42501'});assert.equal((await state()).audit,0);});
test('uncommitted lifecycle fails closed',async()=>{await admin.query("update public.authentication_lifecycle_operations set state='compensation_required'");await rejectPromotion();});
test('audit insertion failure rolls back link, membership and session',async()=>{
  await admin.query("create function public.reject_rehearsal_audit() returns trigger language plpgsql as $$begin raise exception 'audit failed'; end$$");
  await admin.query('create trigger rehearsal_audit_failure before insert on public.audit_events for each row execute function public.reject_rehearsal_audit()');
  await assert.rejects(new PostgresCognitoSessionStore(runtime,true).registerVerified(verifiedInput()),/rejected/);
  assert.deepEqual(await state(),{link:'pending',membership:'activation_sent',audit:0,activated:0,sessions:0});
});
