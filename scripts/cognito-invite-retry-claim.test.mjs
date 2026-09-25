import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { localPostgresPort } from '../src/test-support/local-postgres-port.mjs';

const actor = 'c38e1b61-551b-4519-ae3e-6b0f76a1ac01';
const department = 'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0';
const user = 'ae3ea4a1-2c84-4abb-b254-cfc57cc229e5';
const operation = '9b724a5a-294e-4bcb-bbdd-a71b478d0a85';
const provider = 'c40cbf03-a250-4a19-9e56-9cfbb4091e53';
const argumentsForRetry = [department, 'synthetic@example.invalid', 'Synthetic Invite', '', '', '', '', ['officer'], []];
let directory;
let postgres;
let admin;
let runtime;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tracepoint-invite-retry-'));
  postgres = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password: 'local-test-only',
    port: await localPostgresPort(), persistent: true, postgresFlags: ['-h', '127.0.0.1'],
    initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await postgres.initialise();
  await postgres.start();
  const connection = { host: '127.0.0.1', port: postgres.options.port, database: 'postgres' };
  admin = new pg.Pool({ ...connection, user: 'postgres', password: 'local-test-only' });
  await admin.query(`
    create role anon; create role service_role; create role authenticated;
    create role tracepoint_runtime login password 'local-runtime-only';
    grant authenticated to tracepoint_runtime;
    create schema auth; create schema tracepoint_auth;
    grant usage on schema tracepoint_auth to authenticated;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create table public.profiles(id uuid primary key, email text, full_name text);
    create table public.department_memberships(user_id uuid, department_id uuid, is_active boolean,
      deactivated_at timestamptz, activation_status text, badge_number text, rank_title text,
      unit_name text, employee_number text);
    create table public.department_membership_roles(user_id uuid, department_id uuid, role_code text);
    create table public.department_group_members(user_id uuid, department_id uuid, group_id uuid);
    create table public.authentication_identity_links(tracepoint_user_id uuid);
    create table public.user_activation_tokens(user_id uuid);
    create table public.authentication_identity_events(tracepoint_user_id uuid);
    create table public.authentication_lifecycle_operations(id uuid primary key, operation_kind text,
      tracepoint_user_id uuid, department_id uuid, actor_user_id uuid, provider_username text,
      provider_subject text, state text, attempts integer, safe_error_code text, updated_at timestamptz);
    create function tracepoint_auth.subject_id() returns uuid language sql stable as $$
      select nullif(current_setting('tracepoint.subject_id', true), '')::uuid $$;
    create function public.has_department_permission(uuid,text) returns boolean language sql stable as $$
      select true $$;
    insert into auth.users values ('${user}', 'synthetic@example.invalid',
      '{"identity_provider":"cognito"}'::jsonb);
    insert into public.profiles values ('${user}','synthetic@example.invalid','Synthetic Invite');
    insert into public.department_memberships(user_id,department_id,is_active,activation_status)
      values ('${user}','${department}',true,'pending_activation');
    insert into public.department_membership_roles values ('${user}','${department}','officer');
    insert into public.authentication_lifecycle_operations
      values ('${operation}','invite','${user}','${department}','${actor}','${provider}',null,
        'compensation_required',1,'provider_create_failed',now());
  `);
  await admin.query(await readFile('database/aws/027_cognito_invite_retry_claim.sql', 'utf8'));
  runtime = new pg.Pool({ ...connection, user: 'tracepoint_runtime', password: 'local-runtime-only' });
});

after(async () => {
  await runtime?.end();
  await admin?.end();
  await postgres?.stop();
  if (directory) {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('tracepoint-invite-retry-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

async function authorized(sql, values) {
  const client = await runtime.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('tracepoint.subject_id',$1,true)", [actor]);
    await client.query("select set_config('tracepoint.department_id',$1,true)", [department]);
    const result = await client.query(sql, values);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}

const inspect = 'select * from tracepoint_auth.inspect_cognito_invite_retry($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::uuid[])';
const claim = 'select * from tracepoint_auth.claim_cognito_invite_retry($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::uuid[],$10)';

test('the original pending user and operation are reused exactly once', async () => {
  assert.deepEqual((await authorized(inspect, argumentsForRetry)).rows[0], {
    user_id: user, operation_id: operation, provider_username: provider });
  assert.deepEqual((await authorized(claim, [...argumentsForRetry, operation])).rows[0], {
    user_id: user, operation_id: operation, provider_username: provider });
  await assert.rejects(authorized(claim, [...argumentsForRetry, operation]), /invite retry/);
  const counts = await admin.query(`select
    (select count(*)::int from public.profiles) as profiles,
    (select count(*)::int from public.department_memberships) as memberships,
    (select count(*)::int from public.authentication_lifecycle_operations) as operations`);
  assert.deepEqual(counts.rows[0], { profiles: 1, memberships: 1, operations: 1 });
});

test('department, role, and identity-link mismatch fail closed', async () => {
  await admin.query(`update public.authentication_lifecycle_operations
    set state='compensation_required',safe_error_code='provider_create_failed' where id='${operation}'`);
  assert.equal((await authorized(inspect, argumentsForRetry)).rows.length, 1);
  await assert.rejects(authorized(inspect, ['11111111-1111-4111-8111-111111111111', ...argumentsForRetry.slice(1)]));
  await assert.rejects(authorized(inspect, [...argumentsForRetry.slice(0, 7), ['administrator'], []]));
  await admin.query(`insert into public.authentication_identity_links values ('${user}')`);
  await assert.rejects(authorized(inspect, argumentsForRetry));
});
