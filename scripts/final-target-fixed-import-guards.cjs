// Fixed, schema-only preparation for the separately attested final cutover target.
// The four definitions come from the existing approved importer contract in the image.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');

const host = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const resourceId = 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE';
const rawSecret = process.env.TARGET_DATABASE_SECRET_JSON;
delete process.env.TARGET_DATABASE_SECRET_JSON;
const secret = JSON.parse(rawSecret || 'null');
assert.equal(secret?.username, 'tracepoint_migrator');
assert.equal(secret?.dbname, 'tracepoint');
assert.equal(secret?.port, 5432);
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
assert.match(ca, /BEGIN CERTIFICATE/);
const client = new Client({ host, port: 5432, user: secret.username, password: secret.password,
  database: 'tracepoint', ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 15000, statement_timeout: 60000,
  application_name: 'tracepoint-final-target-fixed-import-guards' });
let inTransaction = false;
let phase = 'connect';

async function counts() {
  return (await client.query(`select
    (select count(*)::int from auth.users) identities,
    (select count(*)::int from public.departments) departments,
    (select count(*)::int from public.profiles) profiles,
    (select count(*)::int from public.department_memberships) memberships,
    (select count(*)::int from public.audit_events) audit_events,
    (select count(*)::int from public.equipment_assets) equipment_assets,
    (select count(*)::int from public.firearm_assignments) firearm_assignments`)).rows[0];
}

async function run() {
  const encoded = process.env.TRACEPOINT_GUARD_DEFINITIONS_B64 || '';
  delete process.env.TRACEPOINT_GUARD_DEFINITIONS_B64;
  const payload = Buffer.from(encoded, 'base64').toString('utf8');
  assert.equal(createHash('sha256').update(payload).digest('hex'),
    '17aae6542472fe6369c81f565bc06988b4fed5fce2507ba3b3ae7bfe1ad1c3a6',
    'GUARD_PAYLOAD_CHANGED');
  const functions = JSON.parse(payload);
  assert.equal(functions.length, 4, 'GUARD_CONTRACT_CHANGED');
  assert.deepEqual(functions.map(item => item.name ?? item.functionName).sort(), [
    'seed_department_configuration', 'sync_equipment_asset_assignment_history',
    'write_agency_training_audit_event', 'write_audit_event',
  ]);
  await client.connect();
  assert.equal(client.connection.stream.encrypted, true, 'TLS_REQUIRED');
  phase = 'preflight';
  await client.query('begin transaction isolation level repeatable read read only');
  inTransaction = true;
  assert.deepEqual((await client.query(`select current_database() db,current_user role,
    (select ssl from pg_stat_ssl where pid=pg_backend_pid()) tls`)).rows[0],
    { db: 'tracepoint', role: 'tracepoint_migrator', tls: true });
  const lineage = await client.query('select kind,name from tracepoint_migrations.applied_migrations order by kind,name');
  assert.equal(lineage.rowCount, 99, 'LINEAGE_CHANGED');
  assert.equal(lineage.rows.filter(row => row.kind === 'source').length, 76);
  assert.equal(lineage.rows.filter(row => row.kind === 'aws').at(-1)?.name,
    '023_audit_log_read_authorization.sql');
  const before = await counts();
  assert.ok(Object.values(before).every(value => value === 0), 'TARGET_NOT_CLEAN');
  for (const item of functions) {
    const name = item.name ?? item.functionName;
    const definition = (await client.query('select pg_get_functiondef($1::regprocedure) definition',
      [`public.${name}()`])).rows[0]?.definition?.toLowerCase();
    assert.ok(definition, `FUNCTION_MISSING:${name}`);
    for (const fragment of item.requiredExistingFragments) {
      assert.ok(definition.includes(fragment.toLowerCase()), `FUNCTION_CONTRACT_CHANGED:${name}`);
    }
    assert.ok(!definition.includes("current_setting('tracepoint.migration_mode', true)"),
      `GUARD_ALREADY_PRESENT:${name}`);
  }
  await client.query('rollback');
  inTransaction = false;

  phase = 'apply';
  await client.query('begin');
  inTransaction = true;
  await client.query("set local lock_timeout = '5s'");
  assert.equal((await client.query('select count(*)::int count from tracepoint_migrations.applied_migrations')).rows[0].count, 99);
  assert.deepEqual(await counts(), before, 'ROW_COUNT_CHANGED_BEFORE_APPLY');
  for (const item of functions) await client.query(item.statement);
  phase = 'postconditions';
  for (const item of functions) {
    const name = item.name ?? item.functionName;
    const definition = (await client.query('select pg_get_functiondef($1::regprocedure) definition',
      [`public.${name}()`])).rows[0]?.definition;
    assert.ok(definition?.includes("current_setting('tracepoint.migration_mode', true) = 'on'"),
      `GUARD_NOT_INSTALLED:${name}`);
  }
  assert.equal((await client.query('select count(*)::int count from tracepoint_migrations.applied_migrations')).rows[0].count, 99);
  assert.deepEqual(await counts(), before, 'CUSTOMER_ROW_CHANGED');
  await client.query('commit');
  inTransaction = false;
  console.log(JSON.stringify({ result: 'FINAL_TARGET_IMPORT_GUARDS_PASS', targetResourceId: resourceId,
    database: 'tracepoint', tlsVerified: true, lineage: 99, functions: functions.length,
    customerRowsChanged: 0 }));
}

run().catch(async error => {
  if (inTransaction) await client.query('rollback').catch(() => undefined);
  console.error(JSON.stringify({ result: 'FINAL_TARGET_IMPORT_GUARDS_FAIL', phase,
    code: error.code || error.message }));
  process.exitCode = 1;
}).finally(() => client.end().catch(() => undefined));
