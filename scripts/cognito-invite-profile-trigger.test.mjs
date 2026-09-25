import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { localPostgresPort } from '../src/test-support/local-postgres-port.mjs';

const migrationPath = 'database/aws/026_cognito_invite_profile_trigger_reconciliation.sql';
let postgres;
let pool;
let directory;
let port;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'tracepoint-invite-profile-'));
  postgres = new EmbeddedPostgres({
    databaseDir: directory,
    user: 'postgres',
    password: 'local-test-only',
    port: (port = await localPostgresPort()),
    persistent: true,
    postgresFlags: ['-h', '127.0.0.1'],
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  pool = new pg.Pool({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password: 'local-test-only',
    database: 'postgres',
  });
  await pool.query(`
    create schema auth;
    create table auth.users(id uuid primary key, email text not null, raw_user_meta_data jsonb not null);
    create table public.profiles(id uuid primary key, full_name text not null, email text not null);
    create function public.handle_new_auth_user() returns trigger language plpgsql as $$
    begin
      insert into public.profiles(id, full_name, email)
      values(new.id, new.raw_user_meta_data->>'full_name', new.email)
      on conflict(id) do nothing;
      return new;
    end $$;
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_auth_user();
  `);
});

after(async () => {
  await pool?.end();
  await postgres?.stop();
  if (directory) {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(resolved).startsWith('tracepoint-invite-profile-'));
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('versioned invite repair retains all authorization checks and reconciles the profile trigger', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /create or replace function tracepoint_auth\.prepare_cognito_invite/);
  assert.match(sql, /session_user<>'tracepoint_runtime'/);
  assert.match(sql, /current_setting\('tracepoint\.department_id',true\)/);
  assert.match(sql, /public\.has_department_permission\(p_department_id,'manage_users'\)/);
  assert.match(sql, /insert into public\.profiles\(id,full_name,email\)[\s\S]*?on conflict \(id\) do nothing;/);
  assert.match(sql, /if not exists \([\s\S]*?where id=p_user_id and full_name=btrim\(p_full_name\)/);
  assert.match(sql, /raise exception 'invite profile mismatch'/);
  assert.match(sql, /grant execute on function tracepoint_auth\.prepare_cognito_invite[\s\S]*?to authenticated;/);
});

test('auth trigger and invite insert produce exactly one matching profile', async () => {
  const id = randomUUID();
  const email = 'trigger-test@example.invalid';
  const name = 'Synthetic Trigger Test';
  await pool.query('insert into auth.users values($1,$2,$3)', [id, email, { full_name: name }]);
  await pool.query('insert into public.profiles values($1,$2,$3) on conflict(id) do nothing', [id, name, email]);
  const { rows } = await pool.query('select count(*)::int as n, min(full_name) as name from public.profiles where id=$1', [id]);
  assert.deepEqual(rows[0], { n: 1, name });
});

test('explicit profile insert still works when the source auth trigger is absent', async () => {
  await pool.query('drop trigger on_auth_user_created on auth.users');
  const id = randomUUID();
  const email = 'no-trigger-test@example.invalid';
  const name = 'Synthetic No Trigger Test';
  await pool.query('insert into auth.users values($1,$2,$3)', [id, email, { full_name: name }]);
  await pool.query('insert into public.profiles values($1,$2,$3) on conflict(id) do nothing', [id, name, email]);
  const { rows } = await pool.query('select count(*)::int as n, min(full_name) as name from public.profiles where id=$1', [id]);
  assert.deepEqual(rows[0], { n: 1, name });
});

test('a conflicting preexisting profile is not silently accepted', async () => {
  const id = randomUUID();
  await pool.query('insert into public.profiles values($1,$2,$3)', [id, 'Wrong Name', 'wrong@example.invalid']);
  await pool.query('insert into public.profiles values($1,$2,$3) on conflict(id) do nothing',
    [id, 'Expected Name', 'expected@example.invalid']);
  const { rows } = await pool.query(
    'select exists(select 1 from public.profiles where id=$1 and full_name=$2 and lower(email)=lower($3)) as matches',
    [id, 'Expected Name', 'expected@example.invalid'],
  );
  assert.equal(rows[0].matches, false);
});

test('PostgreSQL accepts the parameterized function privilege metadata check', async () => {
  const { rows } = await pool.query(
    "select has_function_privilege('postgres',$1,'EXECUTE') as allowed",
    ['pg_catalog.now()'],
  );
  assert.equal(rows[0].allowed, true);
});

test('versioned function replacement and grants compile on PostgreSQL', async () => {
  await pool.query('create schema tracepoint_auth; create role anon; create role authenticated; create role service_role');
  const sql = await readFile(migrationPath, 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query(`
    select to_regprocedure(
      'tracepoint_auth.prepare_cognito_invite(uuid,uuid,text,uuid,text,text,text,text,text,text,text[],uuid[],boolean)'
    ) is not null as installed
  `);
  assert.equal(rows[0].installed, true);
});
