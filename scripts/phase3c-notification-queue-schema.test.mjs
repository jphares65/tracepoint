import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { localPostgresPort } from '../src/test-support/local-postgres-port.mjs';

let server, owner, runtime, subject, directory;
const department = '20000000-0000-4000-8000-000000000001';
const otherDepartment = '20000000-0000-4000-8000-000000000002';
const user = '10000000-0000-4000-8000-000000000001';
const parameters = [department,user,'synthetic@example.invalid','notification','fingerprint',
  'Synthetic subject','Synthetic body','2026-09-24T12:00:00Z','Pending','2026-09-24T12:00:00Z'];
const call = 'select tracepoint_auth.enqueue_notification_email($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::timestamptz,$9::text,$10::timestamptz) as accepted';

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(),'tp-notification-enqueue-'));
  const port = await localPostgresPort();
  server = new EmbeddedPostgres({ databaseDir: directory, user: 'postgres', password: 'local-test-only', port,
    persistent: true, postgresFlags: ['-h','127.0.0.1'], initdbFlags: ['--encoding=UTF8','--locale=C'],
    onLog: () => {}, onError: () => {} });
  await server.initialise(); await server.start();
  const config = { host: '127.0.0.1', port, database: 'postgres' };
  owner = new pg.Client({ ...config, user: 'postgres', password: 'local-test-only' }); await owner.connect();
  await owner.query(`create role anon; create role authenticated login password 'subject-test-only';
    create role service_role; create role tracepoint_runtime login noinherit password 'runtime-test-only';
    create schema tracepoint_auth;
    create table public.profiles(id uuid primary key,email text not null);
    create table public.department_memberships(department_id uuid,user_id uuid,is_active boolean not null);
    create table public.notification_events(department_id uuid,user_id uuid,notification_key text,fingerprint text);
    create table public.notification_email_queue(
      department_id uuid,user_id uuid,recipient_email text,notification_key text,fingerprint text,
      subject text,body_text text,scheduled_for timestamptz,status text,updated_at timestamptz,
      unique(department_id,user_id,notification_key,fingerprint));
    grant usage on schema tracepoint_auth to tracepoint_runtime,authenticated;
    insert into public.profiles values('${user}','synthetic@example.invalid');
    insert into public.department_memberships values('${department}','${user}',true);
    insert into public.notification_events values('${department}','${user}','notification','fingerprint');`);
  await owner.query(readFileSync(new URL('../database/aws/024_notification_email_server_enqueue.sql',import.meta.url),'utf8'));
  runtime = new pg.Client({ ...config, user: 'tracepoint_runtime', password: 'runtime-test-only' }); await runtime.connect();
  subject = new pg.Client({ ...config, user: 'authenticated', password: 'subject-test-only' }); await subject.connect();
});
after(async () => {
  await subject?.end(); await runtime?.end(); await owner?.end(); await server?.stop();
  if (directory) await rm(directory,{recursive:true,force:true,maxRetries:20,retryDelay:250});
});

test('trusted enqueue is idempotent and ordinary sessions cannot insert or execute', async () => {
  assert.equal((await runtime.query(call,parameters)).rows[0].accepted,true);
  assert.equal((await runtime.query(call,parameters)).rows[0].accepted,true);
  assert.equal((await owner.query('select count(*)::int as count from public.notification_email_queue')).rows[0].count,1);
  await assert.rejects(runtime.query('insert into public.notification_email_queue(department_id) values($1)',[department]),{code:'42501'});
  await assert.rejects(subject.query(call,parameters),{code:'42501'});
  await assert.rejects(subject.query('insert into public.notification_email_queue(department_id) values($1)',[department]),{code:'42501'});
});

test('wrong department, recipient, and absent notification fail closed', async () => {
  for (const changed of [[otherDepartment,...parameters.slice(1)],
    [department,user,'other@example.invalid',...parameters.slice(3)],
    [department,user,parameters[2],'missing',...parameters.slice(4)]]) {
    await assert.rejects(runtime.query(call,changed),{code:'42501'});
  }
  assert.equal((await owner.query('select count(*)::int as count from public.notification_email_queue')).rows[0].count,1);
});
