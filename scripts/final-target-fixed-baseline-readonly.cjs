// Fixed, aggregate-only inspection of the newly restored quarantined target.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');
const host = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const secret = JSON.parse(process.env.TARGET_DATABASE_SECRET_JSON || 'null');
assert.equal(secret?.username, 'tracepoint_migrator');
assert.equal(secret?.dbname, 'tracepoint');
assert.equal(secret?.port, 5432);
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
assert.match(ca, /BEGIN CERTIFICATE/);
const client = new Client({ host, port: 5432, user: secret.username, password: secret.password,
  database: 'tracepoint', ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 15000, statement_timeout: 15000,
  application_name: 'tracepoint-final-target-fixed-baseline-readonly' });
let phase = 'connect';
(async () => {
  await client.connect();
  try {
    phase = 'identity';
    await client.query('begin transaction isolation level repeatable read read only');
    const identity = (await client.query("select current_database() as db,current_user as role,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls")).rows[0];
    assert.deepEqual(identity, { db: 'tracepoint', role: 'tracepoint_migrator', tls: true });
    phase = 'schema';
    const schema = (await client.query(`select
      count(*) filter(where n.nspname='public' and c.relkind in ('r','p'))::int as public_tables,
      count(*) filter(where n.nspname='auth' and c.relkind in ('r','p'))::int as auth_tables
      from pg_class c join pg_namespace n on n.oid=c.relnamespace`)).rows[0];
    const keyTables = (await client.query(`select to_regclass('tracepoint_migrations.applied_migrations') is not null as lineage,
      to_regclass('public.departments') is not null as departments,
      to_regclass('public.profiles') is not null as profiles,
      to_regclass('public.equipment_assets') is not null as equipment_assets,
      to_regclass('public.authentication_flow_transactions') is not null as auth_flows`)).rows[0];
    phase = 'counts';
    const counts = keyTables.lineage && keyTables.departments && keyTables.profiles ?
      (await client.query(`select
        (select count(*)::int from tracepoint_migrations.applied_migrations) as migrations,
        (select count(*)::int from public.departments) as departments,
        (select count(*)::int from public.profiles) as profiles,
        (select count(*)::int from auth.users) as auth_users`)).rows[0] : null;
    phase = 'contract';
    const columns = (await client.query(`select
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='firearm_assignments' and column_name='magazines_expected_return') as magazines_expected_return,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='equipment_assets' and column_name='lifecycle_status') as equipment_lifecycle_status`)).rows[0];
    const checks = (await client.query(`select conname,pg_get_constraintdef(oid) as definition from pg_constraint
      where conname in ('equipment_assets_lifecycle_status_check','authentication_flow_transactions_expiry_check')
      order by conname`)).rows.map(row => ({ name: row.conname, definition: row.definition }));
    await client.query('rollback');
    console.log(JSON.stringify({ result: 'FINAL_TARGET_BASELINE_READONLY_PASS', targetResourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE',
      tlsVerified: true, schema, keyTables, counts, columns, checks, writesPerformed: false }));
  } catch (error) { await client.query('rollback').catch(() => undefined); throw error; }
  finally { await client.end(); }
})().catch(error => { console.error(JSON.stringify({ result: 'FINAL_TARGET_BASELINE_READONLY_FAIL', phase, code: error.code || error.message })); process.exitCode = 1; });
