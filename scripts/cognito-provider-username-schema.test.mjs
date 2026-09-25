import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { localPostgresPort } from '../src/test-support/local-postgres-port.mjs';

const department = '20000000-0000-4000-8000-000000000001';
const user = '10000000-0000-4000-8000-000000000001';
const actor = '10000000-0000-4000-8000-000000000002';
const operation = '30000000-0000-4000-8000-000000000001';
const requested = '40000000-0000-4000-8000-000000000001';
const actual = '742824e8-60d1-7081-93a3-722b79de50c6';
let server, owner, runtime, subject, directory;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tp-cognito-username-'));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password: 'local-test-only', port,
    persistent: true, postgresFlags: ['-h','127.0.0.1'], initdbFlags: ['--encoding=UTF8','--locale=C'],
    onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start();
  const config = { host: '127.0.0.1', port, database: 'postgres' };
  owner = new pg.Client({ ...config, user: 'postgres', password: 'local-test-only' }); await owner.connect();
  await owner.query(`create role anon; create role authenticated login password 'subject-test-only';
    create role service_role; create role tracepoint_runtime login password 'runtime-test-only';
    create schema tracepoint_auth;
    create function tracepoint_auth.subject_id() returns uuid language sql stable as
      'select nullif(current_setting(''tracepoint.subject_id'',true),'''')::uuid';
    create function public.has_department_permission(uuid,text) returns boolean language sql stable as
      'select current_setting(''tracepoint.subject_id'',true) = ''${actor}''';
    create table public.authentication_lifecycle_operations(
      id uuid primary key, operation_kind text, tracepoint_user_id uuid, department_id uuid,
      provider_username text, state text, updated_at timestamptz default now());
    create table public.authentication_identity_links(
      provider text, tracepoint_user_id uuid, subject text, provider_username text,
      state text, issuer text);
    create table public.profiles(id uuid primary key,email text);
    create table public.department_memberships(department_id uuid,user_id uuid,is_active boolean,activation_status text);
    create table public.audit_events(department_id uuid,actor_user_id uuid,action text,entity_type text,
      entity_id uuid,summary text,new_value jsonb);
    grant usage on schema tracepoint_auth to tracepoint_runtime;
    insert into public.authentication_lifecycle_operations values
      ('${operation}','migrate_identity','${user}','${department}','${requested}','prepared',now());
    insert into public.profiles values('${user}','synthetic@example.invalid');
    insert into public.department_memberships values('${department}','${user}',true,'pending_activation');`);
  await owner.query(readFileSync(new URL('../database/aws/025_cognito_provider_username_reconciliation.sql', import.meta.url), 'utf8'));
  runtime = new pg.Client({ ...config, user: 'tracepoint_runtime', password: 'runtime-test-only' }); await runtime.connect();
  subject = new pg.Client({ ...config, user: 'authenticated', password: 'subject-test-only' }); await subject.connect();
});
after(async () => {
  await subject?.end(); await runtime?.end(); await owner?.end(); await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

test('only runtime can reconcile exact provider-generated username/subject', async () => {
  const call = 'select tracepoint_auth.confirm_cognito_provider_username($1,$2,$3,$4)';
  await assert.rejects(subject.query(call,[operation,requested,actual,actual]), { code: '42501' });
  await assert.rejects(runtime.query(call,[operation,requested,actual,'different']), { code: '42501' });
  await runtime.query(call,[operation,requested,actual,actual]);
  const row = (await owner.query('select provider_username from public.authentication_lifecycle_operations where id=$1',[operation])).rows[0];
  assert.equal(row.provider_username,actual);
});

test('pending invitation resend is tenant/subject scoped and audited', async () => {
  await owner.query(`insert into public.authentication_identity_links values
    ('cognito','${user}','${actual}','${actual}','pending','https://issuer.example.test');`);
  const call = 'select * from tracepoint_auth.prepare_cognito_activation_resend($1,$2)';
  await assert.rejects(runtime.query(call,[department,user]), { code: '42501' });
  await assert.rejects(subject.query(call,[department,user]), { code: '42501' });
  await runtime.query('begin');
  try {
    await runtime.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)",[actor,department]);
    const found = await runtime.query(call,[department,user]);
    assert.equal(found.rowCount,1);
    assert.equal(found.rows[0].provider_subject,actual);
    await assert.rejects(runtime.query('select tracepoint_auth.finish_cognito_activation_resend($1,$2,$3)',
      [department,user,requested]), { code: '42501' });
    // A rejected statement aborts the transaction. Re-establish scoped context.
    await runtime.query('rollback');
    await runtime.query('begin');
    await runtime.query("select set_config('tracepoint.subject_id',$1,true),set_config('tracepoint.department_id',$2,true)",[actor,department]);
    await runtime.query('select tracepoint_auth.finish_cognito_activation_resend($1,$2,$3)',
      [department,user,actual]);
    await runtime.query('commit');
  } catch (error) { await runtime.query('rollback').catch(() => {}); throw error; }
  const membership = (await owner.query('select activation_status from public.department_memberships')).rows[0];
  assert.equal(membership.activation_status,'activation_sent');
  assert.equal((await owner.query('select count(*)::int as n from public.audit_events')).rows[0].n,1);
});
