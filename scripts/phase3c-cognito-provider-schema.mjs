// Fixed one-shot rehearsal schema migration. No caller-supplied SQL or endpoint.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const host = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const migrationHash = '4ddb1201cbfaedce154936028e4d264d4b98d3a26e40f5a2fd53435c6dcd2a9c';
if (process.argv[2] !== 'apply') throw Error('Fixed rehearsal schema mode required.');
const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? 'null');
if (secret?.host !== host || secret?.dbname !== 'tracepoint' || secret?.port !== 5432 ||
    secret?.username !== 'tracepoint_migrator' || typeof secret?.password !== 'string' || secret.password.length < 20)
  throw Error('Rehearsal schema target mismatch.');
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
if (!ca.includes('BEGIN CERTIFICATE')) throw Error('RDS CA unavailable.');
const raw = readFileSync('/app/database/aws/025_cognito_provider_username_reconciliation.sql', 'utf8').replaceAll('\r\n','\n');
if (createHash('sha256').update(raw).digest('hex') !== migrationHash) throw Error('Reviewed migration hash mismatch.');
const sql = raw.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
if (sql === raw) throw Error('Migration transaction envelope missing.');
const client = new pg.Client({ host, port: 5432, user: secret.username, password: secret.password,
  database: 'tracepoint', ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10_000,
  statement_timeout: 20_000, application_name: 'tracepoint-phase3c-cognito-provider-schema' });
async function main() {
let phase = 'connect', started = false;
try {
  await client.connect();
  phase = 'target-attestation';
  const identity = (await client.query("select current_database() as db,current_user as role,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls")).rows[0];
  if (identity?.db !== 'tracepoint' || identity?.role !== 'tracepoint_migrator' || identity?.tls !== true)
    throw Error('Rehearsal target identity mismatch.');
  phase = 'contract-preflight';
  const before = (await client.query(`select
    to_regprocedure('tracepoint_auth.confirm_cognito_provider_username(uuid,text,text,text)') is null as not_applied,
    to_regprocedure('tracepoint_auth.commit_existing_cognito_migration(uuid,text,text)') is not null as existing_migration,
    to_regprocedure('tracepoint_auth.commit_cognito_invite(uuid,text,text)') is not null as existing_invite,
    (select count(*)::int from public.authentication_identity_links where provider='cognito') as link_count,
    (select count(*)::int from public.authentication_identity_links where provider='cognito' and provider_username=subject) as normalized_links,
    (select count(*)::int from public.authentication_identity_links
      where provider='cognito' and provider_username is null and state='active') as active_fixture_links`)).rows[0];
  if (!before.not_applied || !before.existing_migration || !before.existing_invite ||
      before.link_count !== 97 || before.normalized_links !== 96 || before.active_fixture_links !== 1)
    throw Error('Unexpected rehearsal identity contract.');
  phase = 'fixed-schema-migration';
  await client.query('begin'); started = true;
  await client.query("set local lock_timeout='5s'");
  await client.query(sql);
  const after = (await client.query(`select
    has_function_privilege('tracepoint_runtime','tracepoint_auth.confirm_cognito_provider_username(uuid,text,text,text)','EXECUTE') as runtime_reconcile,
    has_function_privilege('authenticated','tracepoint_auth.confirm_cognito_provider_username(uuid,text,text,text)','EXECUTE') as subject_reconcile,
    has_function_privilege('tracepoint_runtime','tracepoint_auth.prepare_cognito_activation_resend(uuid,uuid)','EXECUTE') as runtime_prepare,
    has_function_privilege('authenticated','tracepoint_auth.prepare_cognito_activation_resend(uuid,uuid)','EXECUTE') as subject_prepare,
    has_function_privilege('tracepoint_runtime','tracepoint_auth.finish_cognito_activation_resend(uuid,uuid,text)','EXECUTE') as runtime_finish,
    has_function_privilege('authenticated','tracepoint_auth.finish_cognito_activation_resend(uuid,uuid,text)','EXECUTE') as subject_finish`)).rows[0];
  if (!after.runtime_reconcile || after.subject_reconcile || !after.runtime_prepare || after.subject_prepare ||
      !after.runtime_finish || after.subject_finish) throw Error('Cognito provider schema authorization mismatch.');
  await client.query('commit'); started = false;
  console.log(JSON.stringify({ status: 'PASS', phase, target: host, database: 'tracepoint', tlsVerified: true,
    identityLinks: before.link_count, reconciledUsernames: before.normalized_links,
    activeSyntheticLinkWithoutUsername: before.active_fixture_links, runtimeOnlyFunctions: 3,
    migrationSha256: migrationHash }));
} catch (error) {
  if (started) await client.query('rollback').catch(() => {});
  console.error(JSON.stringify({ status: 'FAIL', phase, sqlState: error?.code ?? null }));
  process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
}
main().catch(() => { process.exitCode = 1; });
