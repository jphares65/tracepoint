// Fixed, one-shot Phase 3C rehearsal schema repair. No caller-supplied SQL.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const host = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
if (process.argv[2] !== 'apply') throw Error('Fixed schema apply mode required.');
const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? 'null');
if (secret?.host !== host || secret?.dbname !== 'tracepoint' || secret?.port !== 5432 ||
    secret?.username !== 'tracepoint_migrator' || typeof secret?.password !== 'string' || secret.password.length < 20) {
  throw Error('Rehearsal schema target mismatch.');
}
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
if (!ca.includes('BEGIN CERTIFICATE')) throw Error('RDS CA unavailable.');
const sql = readFileSync('/app/database/aws/024_notification_email_server_enqueue.sql', 'utf8');
const client = new pg.Client({ host, port: 5432, user: secret.username, password: secret.password,
  database: 'tracepoint', ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000,
  statement_timeout: 20_000, application_name: 'tracepoint-phase3c-notification-schema' });
async function main() {
let phase = 'connect';
try {
  await client.connect();
  phase = 'target-attestation';
  const identity = (await client.query("select current_database() as db, current_user as role, (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls")).rows[0];
  if (identity?.db !== 'tracepoint' || identity?.role !== 'tracepoint_migrator' || identity?.tls !== true) throw Error('Rehearsal target identity mismatch.');
  phase = 'privilege-preflight';
  const before = (await client.query(`select
    has_table_privilege('authenticated','public.notification_email_queue','INSERT') as subject_insert,
    has_table_privilege('tracepoint_runtime','public.notification_email_queue','INSERT') as runtime_insert,
    (select pg_get_userbyid(relowner) = current_user from pg_class where oid='public.notification_email_queue'::regclass) as migrator_owns_queue,
    to_regprocedure('tracepoint_auth.enqueue_notification_email(uuid,uuid,text,text,text,text,text,timestamptz,text,timestamptz)') is not null as function_exists`)).rows[0];
  if (before.subject_insert || before.runtime_insert || !before.migrator_owns_queue || before.function_exists) throw Error('Unexpected queue authorization state.');
  phase = 'fixed-schema-migration';
  await client.query(sql);
  phase = 'privilege-postflight';
  const after = (await client.query(`select
    has_table_privilege('authenticated','public.notification_email_queue','INSERT') as subject_insert,
    has_table_privilege('tracepoint_runtime','public.notification_email_queue','INSERT') as runtime_insert,
    has_function_privilege('authenticated','tracepoint_auth.enqueue_notification_email(uuid,uuid,text,text,text,text,text,timestamptz,text,timestamptz)','EXECUTE') as subject_execute,
    has_function_privilege('tracepoint_runtime','tracepoint_auth.enqueue_notification_email(uuid,uuid,text,text,text,text,text,timestamptz,text,timestamptz)','EXECUTE') as runtime_execute`)).rows[0];
  if (after.subject_insert || after.runtime_insert || after.subject_execute || after.runtime_execute !== true) throw Error('Queue authorization postflight failed.');
  console.log(JSON.stringify({ status: 'PASS', phase, target: host, tlsVerified: true,
    subjectDirectInsert: false, runtimeDirectInsert: false, subjectFunctionExecute: false,
    trustedRuntimeFunctionExecute: true }));
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', phase, sqlState: error?.code ?? null }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
}
main().catch(() => { process.exitCode = 1; });
