import assert from 'node:assert/strict';
import {test,before,after,beforeEach} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import EmbeddedPostgres from 'embedded-postgres';
import {localPostgresPort} from '../../test-support/local-postgres-port.mjs';

// The membership lifecycle used by personnel import and Settings deactivation
// (009, corrected by 039) must run as the request role and revoke sessions.
const department='dddddddd-0000-4000-8000-00000000000a',other='dddddddd-0000-4000-8000-00000000000b';
const actor='a0000000-0000-4000-8000-0000000000a1',target='a0000000-0000-4000-8000-0000000000c1';
const issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL',subject='5000000c-0000-4000-8000-0000000000c1';
let server:EmbeddedPostgres,admin:pg.Pool,runtime:pg.Pool,directory:string;

before(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),'tracepoint-membership-lifecycle-'));
  const port=await localPostgresPort();
  server=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password:'synthetic-local-only',port,persistent:true,postgresFlags:['-h','127.0.0.1'],initdbFlags:['--encoding=UTF8','--locale=C'],onLog:()=>{},onError:()=>{}});
  await server.initialise();await server.start();
  admin=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password:'synthetic-local-only',database:'postgres'});
  await admin.query(`
    create role anon; create role authenticated; create role service_role;
    create role tracepoint_runtime login password 'synthetic-runtime-only'; grant authenticated to tracepoint_runtime;
    create schema tracepoint_auth;
    create function tracepoint_auth.subject_id() returns uuid language sql stable as $$select nullif(current_setting('tracepoint.subject_id',true),'')::uuid$$;
    create function public.has_department_permission(p_department_id uuid,p_permission text) returns boolean language sql stable as $$select p_department_id::text=current_setting('tracepoint.department_id',true)$$;
    create table public.authentication_identity_links(provider text,issuer text,subject text,tracepoint_user_id uuid,state text,provider_username text,updated_at timestamptz default now(),primary key(provider,issuer,subject));
    create table public.department_memberships(department_id uuid,user_id uuid,is_active boolean,deactivated_at timestamptz,activation_status text,primary key(department_id,user_id));
    create table public.authentication_identity_events(tracepoint_user_id uuid,provider text,issuer text,subject text,provider_username text,event_type text,actor_user_id uuid,operation_id uuid);
    create table public.authentication_lifecycle_operations(id uuid primary key,operation_kind text,tracepoint_user_id uuid,department_id uuid,actor_user_id uuid,provider_username text,provider_subject text,state text,attempts integer default 0,safe_error_code text,updated_at timestamptz default now());
    create table public.audit_events(department_id uuid,actor_user_id uuid,action text,entity_type text,entity_id uuid,summary text,new_value jsonb);
    create table public.authentication_access_sessions(tracepoint_user_id uuid,revoked_at timestamptz);
    create table public.authentication_refresh_sessions(tracepoint_user_id uuid,state text,sealed_payload text,updated_at timestamptz);
    create table public.authentication_session_revocations(tracepoint_user_id uuid,issuer text,revoked_before timestamptz,constraint authentication_session_revocations_pkey primary key(tracepoint_user_id,issuer));
    grant usage on schema public,tracepoint_auth to tracepoint_runtime,authenticated;
  `);
  await admin.query(await readFile('database/aws/009_cognito_membership_lifecycle.sql','utf8'));
  await admin.query(await readFile('database/aws/039_account_access_remediation.sql','utf8'));
  runtime=new pg.Pool({host:'127.0.0.1',port,user:'tracepoint_runtime',password:'synthetic-runtime-only',database:'postgres'});
});
after(async()=>{await runtime?.end();await admin?.end();await server?.stop();if(directory)await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
beforeEach(async()=>{
  await admin.query('truncate public.authentication_identity_links,public.department_memberships,public.authentication_identity_events,public.authentication_lifecycle_operations,public.audit_events,public.authentication_access_sessions,public.authentication_refresh_sessions,public.authentication_session_revocations');
  await admin.query("insert into public.authentication_identity_links(provider,issuer,subject,tracepoint_user_id,state,provider_username) values('cognito',$1,$2,$3,'active',$2)",[issuer,subject,target]);
  await admin.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activated')",[department,target]);
  await admin.query('insert into public.authentication_access_sessions values($1,null)',[target]);
  await admin.query("insert into public.authentication_refresh_sessions values($1,'ready','sealed',now())",[target]);
});

// Mirrors setCognitoMembershipActive: request-role preparation, optional work in
// the same transaction, then the pool-level finish.
async function lifecycle(operation:string,kind:'disable'|'enable',withinPrepare?:(client:pg.PoolClient)=>Promise<void>){
  const client=await runtime.connect();
  try{
    await client.query('begin');await client.query('set local role authenticated');
    await client.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)",[actor,department]);
    const prepared=await client.query('select * from tracepoint_auth.prepare_cognito_membership_operation($1,$2,$3,$4)',[operation,kind,department,target]);
    await withinPrepare?.(client);
    await client.query('commit');
    await runtime.query('select tracepoint_auth.finish_cognito_membership_operation($1,true,null)',[operation]);
    return prepared.rows[0];
  }catch(error){await client.query('rollback');throw error;}finally{client.release();}
}
async function state(){
  const membership=(await admin.query('select is_active from public.department_memberships where department_id=$1 and user_id=$2',[department,target])).rows[0]?.is_active;
  const revocations=(await admin.query('select count(*)::int n from public.authentication_session_revocations')).rows[0].n;
  const openAccess=(await admin.query('select count(*)::int n from public.authentication_access_sessions where revoked_at is null')).rows[0].n;
  const openRefresh=(await admin.query("select count(*)::int n from public.authentication_refresh_sessions where state<>'revoked'")).rows[0].n;
  return {membership,revocations,openAccess,openRefresh};
}

test('deactivation prepares a provider disable and revokes every session',async()=>{
  const prepared=await lifecycle('60000000-0000-4000-8000-0000000000e1','disable');
  assert.deepEqual(prepared,{user_id:target,provider_username:subject,should_change_provider:true});
  assert.deepEqual(await state(),{membership:false,revocations:1,openAccess:0,openRefresh:0});
});
test('reactivation re-enables the provider account and the membership',async()=>{
  await lifecycle('60000000-0000-4000-8000-0000000000e1','disable');
  const prepared=await lifecycle('60000000-0000-4000-8000-0000000000e2','enable');
  assert.equal(prepared.should_change_provider,true);
  assert.equal((await state()).membership,true);
});
test('another active membership keeps the provider account enabled',async()=>{
  await admin.query("insert into public.department_memberships(department_id,user_id,is_active,activation_status) values($1,$2,true,'activated')",[other,target]);
  const prepared=await lifecycle('60000000-0000-4000-8000-0000000000e1','disable');
  assert.equal(prepared.should_change_provider,false);
  assert.deepEqual(await state(),{membership:false,revocations:0,openAccess:1,openRefresh:1});
});
test('a failure inside the preparation transaction rolls the preparation back',async()=>{
  await assert.rejects(lifecycle('60000000-0000-4000-8000-0000000000e1','disable',async client=>{await client.query("select 1/0");}),/division by zero/);
  assert.deepEqual(await state(),{membership:true,revocations:0,openAccess:1,openRefresh:1});
  assert.equal((await admin.query('select count(*)::int n from public.authentication_lifecycle_operations')).rows[0].n,0);
});
