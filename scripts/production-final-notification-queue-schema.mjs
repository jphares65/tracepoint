// Exact final-RDS application of the already-reviewed AWS migration 024.
// The SQL is supplied as base64 by the one-off task and must match this hash.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');

const host = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
// The reviewed final importer reuses this migrator credential; its metadata
// still names the older runtime RDS. Never connect to that metadata host.
const credentialMetadataHost = 'tracepoint-production.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const name = '024_notification_email_server_enqueue.sql';
const sha256 = '99e8ca4d52bd4505721d0c509dd5d352162843dd8f257c0e19c71d315355abd0';
const signature = 'tracepoint_auth.enqueue_notification_email(uuid,uuid,text,text,text,text,text,timestamptz,text,timestamptz)';
const mode = process.env.TRACEPOINT_NOTIFICATION_MIGRATION_MODE;
delete process.env.TRACEPOINT_NOTIFICATION_MIGRATION_MODE;
assert.ok(mode === 'preflight' || mode === 'apply', 'MODE_NOT_ALLOWED');

const rawSecret = process.env.TARGET_DATABASE_SECRET_JSON;
const sqlBase64 = process.env.TRACEPOINT_NOTIFICATION_SQL_B64;
delete process.env.TARGET_DATABASE_SECRET_JSON;
delete process.env.TRACEPOINT_NOTIFICATION_SQL_B64;
assert.ok(rawSecret && sqlBase64, 'INPUT_MISSING');
const secret = JSON.parse(rawSecret);
assert.equal(secret.host, credentialMetadataHost, 'MIGRATOR_CREDENTIAL_METADATA_MISMATCH');
assert.equal(secret.dbname, 'tracepoint', 'TARGET_DATABASE_MISMATCH');
assert.equal(secret.port, 5432, 'TARGET_PORT_MISMATCH');
assert.equal(secret.username, 'tracepoint_migrator', 'TARGET_ROLE_MISMATCH');
assert.ok(typeof secret.password === 'string' && secret.password.length >= 20, 'TARGET_SECRET_INVALID');
const sql = Buffer.from(sqlBase64, 'base64').toString('utf8').replaceAll('\r\n', '\n');
assert.equal(createHash('sha256').update(sql).digest('hex'), sha256, 'MIGRATION_HASH_MISMATCH');
assert.match(sql, /^begin;\s*/iu, 'MIGRATION_WRAPPER_CHANGED');
assert.match(sql, /\s*commit;\s*$/iu, 'MIGRATION_WRAPPER_CHANGED');
const body = sql.replace(/^begin;\s*/iu, '').replace(/\s*commit;\s*$/iu, '');
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
assert.match(ca, /BEGIN CERTIFICATE/u, 'RDS_CA_MISSING');

const client = new Client({
  host, port: 5432, database: 'tracepoint', user: secret.username, password: secret.password,
  ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 15000, statement_timeout: 30000,
  application_name: 'tracepoint-production-notification-migration-024',
});

async function privileges() {
  const result = await client.query(`select
    has_table_privilege('authenticated','public.notification_email_queue','INSERT') as subject_insert,
    has_table_privilege('tracepoint_runtime','public.notification_email_queue','INSERT') as runtime_insert,
    (select pg_get_userbyid(relowner) = current_user from pg_class where oid='public.notification_email_queue'::regclass) as migrator_owns_queue,
    to_regprocedure($1) is not null as function_exists`, [signature]);
  return result.rows[0];
}

async function main() {
  let transaction = false;
  let phase = 'connect';
  try {
    await client.connect();
    phase = 'target-and-lineage';
    await client.query(mode === 'preflight' ? 'begin read only' : 'begin');
    transaction = true;
    await client.query("set local lock_timeout = '5s'");
    const identity = (await client.query(`select current_database() as db, current_user as role,
      (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls`)).rows[0];
    assert.deepEqual(identity, { db: 'tracepoint', role: 'tracepoint_migrator', tls: true }, 'TARGET_IDENTITY_MISMATCH');
    const lineage = (await client.query(`select count(*)::int as count,
      count(*) filter (where kind='aws')::int as aws_count
      from tracepoint_migrations.applied_migrations`)).rows[0];
    assert.deepEqual(lineage, { count: 99, aws_count: 23 }, 'LINEAGE_CHANGED');
    const tail = (await client.query(`select name from tracepoint_migrations.applied_migrations
      where kind='aws' order by name desc limit 1`)).rows[0];
    assert.equal(tail?.name, '023_audit_log_read_authorization.sql', 'LINEAGE_TAIL_CHANGED');
    phase = 'queue-preflight';
    const before = await privileges();
    assert.deepEqual(before, {
      subject_insert: false, runtime_insert: false,
      migrator_owns_queue: true, function_exists: false,
    }, 'QUEUE_PRECONDITION_MISMATCH');
    if (mode === 'preflight') {
      await client.query('rollback'); transaction = false;
      console.log(JSON.stringify({ status: 'PRODUCTION_NOTIFICATION_024_PREFLIGHT_PASS',
        resourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE', tlsVerified: true,
        lineage: 99, migration: name, sha256, subjectDirectInsert: false }));
      return;
    }
    phase = 'migration-apply';
    await client.query(body);
    await client.query(`insert into tracepoint_migrations.applied_migrations(kind,name,sha256)
      values('aws',$1,$2)`, [name, sha256]);
    phase = 'queue-postflight';
    const after = await privileges();
    assert.deepEqual(after, {
      subject_insert: false, runtime_insert: false,
      migrator_owns_queue: true, function_exists: true,
    }, 'QUEUE_POSTCONDITION_MISMATCH');
    const grants = (await client.query(`select
      has_function_privilege('authenticated',$1,'EXECUTE') as subject_execute,
      has_function_privilege('tracepoint_runtime',$1,'EXECUTE') as runtime_execute`, [signature])).rows[0];
    assert.deepEqual(grants, { subject_execute: false, runtime_execute: true }, 'FUNCTION_GRANTS_MISMATCH');
    const newLineage = (await client.query(`select count(*)::int as count from tracepoint_migrations.applied_migrations`)).rows[0];
    assert.equal(newLineage.count, 100, 'NEW_LINEAGE_MISMATCH');
    await client.query('commit'); transaction = false;
    console.log(JSON.stringify({ status: 'PRODUCTION_NOTIFICATION_024_APPLIED',
      resourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE', tlsVerified: true,
      lineage: 100, migration: name, sha256, subjectDirectInsert: false,
      subjectFunctionExecute: false, runtimeFunctionExecute: true }));
  } catch (error) {
    if (transaction) await client.query('rollback').catch(() => {});
    console.error(JSON.stringify({ status: 'PRODUCTION_NOTIFICATION_024_FAILED', phase,
      code: error?.code ?? (/^[A-Z_]+$/u.test(String(error?.message)) ? error.message : 'GUARD_FAILED') }));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(() => { process.exitCode = 1; });
