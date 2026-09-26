// Fixed one-target, one-function installer for the synthetic Montville Officer.
// This is rehearsal-only and cannot target the production database.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const host = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const file = '/app/database/rehearsal/002_montville_officer_first_login.sql';
const expectedHash = '67f6598879d85ffe93b8eda8fd004616dd3e47f5c78f78304e0a12fb4a7bc130';
const signature = 'tracepoint_auth.promote_rehearsal_montville_officer_first_login(text,text,uuid)';
const department = '1d0e2994-4224-4237-8328-71020ba20027';
const user = '64b72eb8-1e89-4683-9798-501fa1bfe8b4';
const operation = '0ee6a36b-ffc8-4a0c-885b-eefb7b8999ef';
const subject = '04a874b8-c0b1-700d-e816-26758473bde3';
const email = 'jphares+montville-rehearsal@tracepointhq.com';
if (process.argv.length !== 2) throw Error('FIXED_REHEARSAL_SCHEMA_ONLY');
const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON ?? 'null');
if (secret?.host !== host || secret?.dbname !== 'tracepoint' || secret?.port !== 5432 ||
    secret?.username !== 'tracepoint_migrator' || typeof secret?.password !== 'string' ||
    secret.password.length < 20) throw Error('REHEARSAL_TARGET_PIN_MISMATCH');
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
if (!ca.includes('BEGIN CERTIFICATE')) throw Error('RDS_CA_UNAVAILABLE');
const raw = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
if (createHash('sha256').update(raw).digest('hex') !== expectedHash) throw Error('REVIEWED_SQL_HASH_MISMATCH');
const sql = raw.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
if (sql === raw) throw Error('SQL_TRANSACTION_ENVELOPE_MISSING');

const client = new pg.Client({ host, port: 5432, database: 'tracepoint', user: secret.username,
  password: secret.password, ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 10000, statement_timeout: 20000,
  application_name: 'tracepoint-phase3c-montville-first-login-schema' });

async function main() {
  let started = false;
  try {
    await client.connect();
    const target = (await client.query(`select current_database() db,current_user role,
      (select ssl from pg_stat_ssl where pid=pg_backend_pid()) tls`)).rows[0];
    if (target?.db !== 'tracepoint' || target?.role !== 'tracepoint_migrator' || target?.tls !== true)
      throw Error('REHEARSAL_TARGET_IDENTITY_MISMATCH');
    const existing = (await client.query('select to_regprocedure($1) signature', [signature])).rows[0];
    if (existing?.signature !== null) throw Error('FIRST_LOGIN_FUNCTION_ALREADY_EXISTS');
    const rows = (await client.query(`select p.id user_id,m.department_id,m.activation_status,m.is_active,
      r.role_code,l.subject,l.state link_state,l.provider_username,
      o.id operation_id,o.operation_kind,o.state operation_state,o.provider_subject,
      o.provider_username operation_username,o.safe_error_code
      from public.profiles p join auth.users a on a.id=p.id and lower(btrim(a.email))=$1
      join public.department_memberships m on m.user_id=p.id
      join public.department_membership_roles r on r.user_id=p.id and r.department_id=m.department_id
      join public.authentication_identity_links l on l.tracepoint_user_id=p.id
      join public.authentication_lifecycle_operations o on o.tracepoint_user_id=p.id
      where lower(btrim(p.email))=$1`, [email])).rows;
    if (rows.length !== 1 || rows[0].user_id !== user || rows[0].department_id !== department ||
        rows[0].role_code !== 'officer' || rows[0].subject !== subject ||
        rows[0].link_state !== 'pending' || rows[0].provider_username !== subject ||
        rows[0].activation_status !== 'activation_sent' || !rows[0].is_active ||
        rows[0].operation_id !== operation || rows[0].operation_kind !== 'invite' ||
        rows[0].operation_state !== 'committed' || rows[0].provider_subject !== subject ||
        rows[0].operation_username !== subject || rows[0].safe_error_code !== null)
      throw Error('FIRST_LOGIN_EXACT_FIXTURE_MISMATCH');
    await client.query('begin'); started = true;
    await client.query("set local lock_timeout='5s'");
    await client.query(sql);
    const rights = (await client.query(`select
      has_function_privilege('tracepoint_runtime',$1,'EXECUTE') runtime,
      has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
      has_function_privilege('anon',$1,'EXECUTE') anon,
      has_function_privilege('service_role',$1,'EXECUTE') service`, [signature])).rows[0];
    if (!rights?.runtime || rights.authenticated || rights.anon || rights.service)
      throw Error('FIRST_LOGIN_FUNCTION_PRIVILEGE_MISMATCH');
    await client.query('commit'); started = false;
    console.log(JSON.stringify({ status: 'PASS', target: host, database: 'tracepoint',
      tlsVerified: true, function: signature, sqlSha256: expectedHash,
      runtimeExecute: true, browserExecute: false }));
  } catch (error) {
    if (started) await client.query('rollback').catch(() => {});
    console.error(JSON.stringify({ status: 'FAIL', sqlState: error?.code ?? null,
      reason: typeof error?.message === 'string' && /^[A-Z_]+$/.test(error.message)
        ? error.message : 'REHEARSAL_SCHEMA_ERROR' }));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(() => { process.exitCode = 1; });
