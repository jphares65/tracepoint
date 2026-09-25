// Fixed, one-target rehearsal schema installer. No caller-provided SQL or host.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const host = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const file = '/app/database/rehearsal/001_readington_officer_first_login.sql';
const expectedHash = 'fb03285163f244a6eb32a4ff1b348e9c98ae1d7a08b37473bbd1af6b9c329854';
const signature = 'tracepoint_auth.promote_rehearsal_readington_officer_first_login(text,text,uuid)';
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

const client = new pg.Client({host, port:5432, database:'tracepoint', user:secret.username,
  password:secret.password, ssl:{ca,rejectUnauthorized:true,servername:host},
  connectionTimeoutMillis:10000, statement_timeout:20000,
  application_name:'tracepoint-phase3c-first-login-schema'});
async function main() {
let started = false;
try {
  await client.connect();
  const target = (await client.query(`select current_database() as db,current_user as role,
    (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls`)).rows[0];
  if (target?.db !== 'tracepoint' || target?.role !== 'tracepoint_migrator' || target?.tls !== true)
    throw Error('REHEARSAL_TARGET_IDENTITY_MISMATCH');
  const existing = (await client.query(`select to_regprocedure($1) as signature`,[signature])).rows[0];
  if (existing?.signature !== null) throw Error('FIRST_LOGIN_FUNCTION_ALREADY_EXISTS');
  await client.query('begin'); started = true;
  await client.query("set local lock_timeout='5s'");
  await client.query(sql);
  const rights = (await client.query(`select
    has_function_privilege('tracepoint_runtime',$1,'EXECUTE') as runtime,
    has_function_privilege('authenticated',$1,'EXECUTE') as authenticated,
    has_function_privilege('anon',$1,'EXECUTE') as anon,
    has_function_privilege('service_role',$1,'EXECUTE') as service`,[signature])).rows[0];
  if (!rights?.runtime || rights.authenticated || rights.anon || rights.service)
    throw Error('FIRST_LOGIN_FUNCTION_PRIVILEGE_MISMATCH');
  await client.query('commit'); started = false;
  console.log(JSON.stringify({status:'PASS',target:host,database:'tracepoint',tlsVerified:true,
    function:signature,sqlSha256:expectedHash,runtimeExecute:true,browserExecute:false}));
} catch (error) {
  if (started) await client.query('rollback').catch(()=>{});
  console.error(JSON.stringify({status:'FAIL',sqlState:error?.code??null,
    reason:typeof error?.message==='string' && /^[A-Z_]+$/.test(error.message)
      ? error.message : 'REHEARSAL_SCHEMA_ERROR'}));
  process.exitCode = 1;
} finally { await client.end().catch(()=>{}); }
}
main().catch(() => { process.exitCode = 1; });
