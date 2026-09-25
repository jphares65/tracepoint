// Fixed, target-pinned rehearsal-only schema repair. No caller-supplied SQL.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const host = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const expectedHash = 'bc6fca6e5693cfad40ae9ce104a8bf5ec9cd0eda5750177737ecf167a840a612';
const migrationPath = '/app/database/aws/026_cognito_invite_profile_trigger_reconciliation.sql';
const inviteSignature = 'tracepoint_auth.prepare_cognito_invite(uuid,uuid,text,uuid,text,text,text,text,text,text,text[],uuid[],boolean)';
if (process.argv[2] !== 'apply') throw Error('FIXED_REHEARSAL_SCHEMA_MODE_REQUIRED');

const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? 'null');
if (secret?.host !== host || secret?.dbname !== 'tracepoint' || secret?.port !== 5432 ||
    secret?.username !== 'tracepoint_migrator' || typeof secret?.password !== 'string' ||
    secret.password.length < 20) throw Error('REHEARSAL_TARGET_PIN_MISMATCH');
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
if (!ca.includes('BEGIN CERTIFICATE')) throw Error('RDS_CA_UNAVAILABLE');
const raw = readFileSync(migrationPath, 'utf8').replaceAll('\r\n', '\n');
const actualHash = createHash('sha256').update(raw).digest('hex');
if (actualHash !== expectedHash) throw Error('REVIEWED_MIGRATION_HASH_MISMATCH');
const sql = raw.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
if (sql === raw) throw Error('MIGRATION_TRANSACTION_ENVELOPE_MISSING');

const client = new pg.Client({
  host, port: 5432, database: 'tracepoint', user: secret.username, password: secret.password,
  ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 10_000, statement_timeout: 20_000,
  application_name: 'tracepoint-phase3c-invite-profile-schema',
});

async function main() {
  let phase = 'connect';
  let started = false;
  try {
    await client.connect();
    phase = 'target-attestation';
    const identity = (await client.query(`select current_database() as db,current_user as role,
      (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls`)).rows[0];
    if (identity?.db !== 'tracepoint' || identity?.role !== 'tracepoint_migrator' ||
        identity?.tls !== true) throw Error('REHEARSAL_TARGET_IDENTITY_MISMATCH');

    phase = 'trigger-contract';
    const triggers = (await client.query(`select t.tgname,t.tgenabled,n.nspname,p.proname,
      pg_get_functiondef(p.oid) as function_definition
      from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      join pg_namespace n on n.oid=p.pronamespace
      where t.tgrelid='auth.users'::regclass and not t.tgisinternal`)).rows;
    const profileTriggers = triggers.filter(row => row.tgname === 'on_auth_user_created' &&
      row.tgenabled === 'O' && row.nspname === 'public' &&
      row.proname === 'handle_new_auth_user' &&
      row.function_definition.toLowerCase().includes('insert into public.profiles'));
    if (profileTriggers.length !== 1) throw Error('SOURCE_PROFILE_TRIGGER_CONTRACT_MISMATCH');
    const before = (await client.query(`select
      (select count(*)::int from auth.users where lower(email)='jphares@tracepointhq.com') as auth_count,
      (select count(*)::int from public.profiles where lower(email)='jphares@tracepointhq.com') as profile_count,
      pg_get_functiondef($1::regprocedure::oid) as invite_definition`, [inviteSignature])).rows[0];
    if (before.auth_count !== 0 || before.profile_count !== 0 ||
        !before.invite_definition.toLowerCase().includes('insert into public.profiles') ||
        before.invite_definition.toLowerCase().includes('on conflict (id) do nothing'))
      throw Error('INVITE_PREFLIGHT_MISMATCH');

    phase = 'fixed-schema-migration';
    await client.query('begin');
    started = true;
    await client.query("set local lock_timeout='5s'");
    await client.query(sql);
    const after = (await client.query(`select
      pg_get_functiondef($1::regprocedure::oid) as invite_definition,
      has_function_privilege('authenticated',$1,'EXECUTE') as authenticated_execute,
      has_function_privilege('anon',$1,'EXECUTE') as anon_execute,
      (select count(*)::int from auth.users where lower(email)='jphares@tracepointhq.com') as auth_count,
      (select count(*)::int from public.profiles where lower(email)='jphares@tracepointhq.com') as profile_count`,
      [inviteSignature])).rows[0];
    if (!after.invite_definition.toLowerCase().includes('on conflict (id) do nothing') ||
        !after.invite_definition.includes('invite profile mismatch') ||
        !after.authenticated_execute || after.anon_execute ||
        after.auth_count !== 0 || after.profile_count !== 0)
      throw Error('INVITE_SCHEMA_RECONCILIATION_MISMATCH');
    await client.query('commit');
    started = false;
    console.log(JSON.stringify({
      status: 'PASS', phase, target: host, database: identity.db, tlsVerified: true,
      profileTriggerEnabled: true, recipientAuthRows: 0, recipientProfileRows: 0,
      invitePermissionOnlyAuthenticated: true, migrationSha256: actualHash,
    }));
  } catch (error) {
    if (started) await client.query('rollback').catch(() => {});
    console.error(JSON.stringify({ status: 'FAIL', phase, sqlState: error?.code ?? null,
      reason: typeof error?.message === 'string' && /^[A-Z_]+$/.test(error.message)
        ? error.message : 'DATABASE_SCHEMA_ERROR' }));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(() => { process.exitCode = 1; });
