// Fixed read-only credential probe. This script must run only in the isolated
// final-target ECS lane with the separately stored final-target secret.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');

const host = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const secret = JSON.parse(process.env.TARGET_DATABASE_SECRET_JSON || 'null');
assert.deepEqual({ host: secret?.host, port: secret?.port, username: secret?.username, dbname: secret?.dbname },
  { host, port: 5432, username: 'tracepoint_runtime', dbname: 'tracepoint' });
assert.equal(typeof secret.password, 'string');
assert.ok(secret.password.length > 0);
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
assert.match(ca, /BEGIN CERTIFICATE/);

const client = new Client({
  host, port: 5432, user: secret.username, password: secret.password,
  database: 'tracepoint', ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 15000, statement_timeout: 15000,
  application_name: 'tracepoint-final-target-runtime-credential-readonly',
});
let phase = 'connect';
(async () => {
  await client.connect();
  try {
    phase = 'identity';
    await client.query('begin transaction isolation level repeatable read read only');
    const identity = (await client.query(`select current_database() as db, current_user as role,
      current_setting('transaction_read_only') as read_only,
      (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls`)).rows[0];
    assert.deepEqual(identity, { db: 'tracepoint', role: 'tracepoint_runtime', read_only: 'on', tls: true });
    phase = 'schema';
    const schema = (await client.query(`select
      to_regclass('public.departments') is not null as departments,
      to_regclass('public.authentication_identity_links') is not null as identity_links,
      to_regclass('public.notification_email_queue') is not null as email_queue`)).rows[0];
    assert.ok(Object.values(schema).every(Boolean));
    await client.query('rollback');
    console.log(JSON.stringify({ result: 'FINAL_RUNTIME_CREDENTIAL_READONLY_PASS',
      targetResourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE', host,
      database: identity.db, role: identity.role, tlsVerified: true,
      schemaPresent: true, writesPerformed: false }));
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally { await client.end(); }
})().catch(error => {
  console.error(JSON.stringify({ result: 'FINAL_RUNTIME_CREDENTIAL_READONLY_FAIL', phase,
    code: error.code || error.name || 'UNKNOWN' }));
  process.exitCode = 1;
});
