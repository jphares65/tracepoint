// Fixed final-target schema preparation. No caller SQL and no source access.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');

const host = 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const expected = [
  ['022_cognito_flow_window.sql', '2d2774c456438c16457343a11dbf0eaffacabc68aeb53289c303c36e0a74f299', 'TRACEPOINT_FLOW_SQL_B64'],
  ['023_audit_log_read_authorization.sql', '6b302016b812280d24e49a516018629c42d43d1b5dbfeb27f70ac77a8acfbbde', 'TRACEPOINT_AUDIT_SQL_B64'],
];
const migrations = expected.map(([name, sha256, variable]) => {
  const raw = Buffer.from(process.env[variable] || '', 'base64').toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(raw).digest('hex'), sha256, `MIGRATION_HASH_MISMATCH:${name}`);
  return { name, sha256, raw };
});
const secret = JSON.parse(process.env.TARGET_DATABASE_SECRET_JSON || 'null');
assert.equal(secret?.username, 'tracepoint_migrator');
assert.equal(secret?.dbname, 'tracepoint');
assert.equal(secret?.port, 5432);
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
assert.match(ca, /BEGIN CERTIFICATE/);
const client = new Client({ host, port: 5432, user: secret.username, password: secret.password,
  database: 'tracepoint', ssl: { ca, rejectUnauthorized: true, servername: host },
  connectionTimeoutMillis: 15000, statement_timeout: 30000,
  application_name: 'tracepoint-final-target-fixed-schema-prep' });
let phase = 'connect';
let inTransaction = false;

async function preflight() {
  await client.query('begin transaction isolation level repeatable read read only');
  inTransaction = true;
  const identity = (await client.query("select current_database() db,current_user role,(select ssl from pg_stat_ssl where pid=pg_backend_pid()) tls")).rows[0];
  assert.deepEqual(identity, { db: 'tracepoint', role: 'tracepoint_migrator', tls: true });
  const lineage = await client.query('select kind,name,sha256 from tracepoint_migrations.applied_migrations order by kind,name');
  assert.equal(lineage.rowCount, 97, 'BASELINE_LINEAGE_COUNT_CHANGED');
  assert.equal(lineage.rows.filter(row => row.kind === 'source').length, 76, 'SOURCE_LINEAGE_CHANGED');
  const aws = lineage.rows.filter(row => row.kind === 'aws');
  assert.equal(aws.length, 21, 'AWS_LINEAGE_CHANGED');
  assert.deepEqual(aws.at(-1), { kind: 'aws', name: '021_cognito_exceptional_identity_migration.sql', sha256: 'ca153fc054a026a38dfa0b50d063dbab50ba1081a23fb01cd37c5fa9ca946581' });
  const counts = (await client.query(`select
    (select count(*)::int from auth.users) identities,
    (select count(*)::int from public.departments) departments,
    (select count(*)::int from public.profiles) profiles,
    (select count(*)::int from public.department_memberships) memberships,
    (select count(*)::int from public.audit_events) audit_events,
    (select count(*)::int from public.equipment_assets) equipment_assets,
    (select count(*)::int from public.firearm_assignments) firearm_assignments,
    (select count(*)::int from public.authentication_flow_transactions) auth_flows`)).rows[0];
  assert.deepEqual(counts, { identities: 0, departments: 0, profiles: 0, memberships: 0,
    audit_events: 0, equipment_assets: 0, firearm_assignments: 0, auth_flows: 0 }, 'TARGET_NOT_EMPTY');
  const columns = (await client.query(`select exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='firearm_assignments' and column_name='magazines_expected_return') as magazines_expected_return`)).rows[0];
  assert.equal(columns.magazines_expected_return, false, 'FIREARM_REPAIR_ALREADY_PRESENT');
  const constraints = await client.query(`select conname,pg_get_constraintdef(oid) as definition,convalidated
    from pg_constraint where (conrelid='public.authentication_flow_transactions'::regclass and conname='authentication_flow_transactions_check')
    or (conrelid='public.equipment_assets'::regclass and conname='equipment_assets_lifecycle_status_check')
    or (conrelid='public.firearm_assignments'::regclass and conname='firearm_assignments_magazines_expected_return_nonnegative')`);
  assert.equal(constraints.rowCount, 2, 'UNEXPECTED_REPAIR_CONSTRAINT_SET');
  const flow = constraints.rows.find(row => row.conname === 'authentication_flow_transactions_check');
  const equipment = constraints.rows.find(row => row.conname === 'equipment_assets_lifecycle_status_check');
  assert.ok(flow?.convalidated && /00:06:00|6 minutes/.test(flow.definition), 'FLOW_BASELINE_NOT_SIX_MINUTES');
  assert.ok(equipment?.convalidated && ['active','maintenance','expired','removed'].every(value => equipment.definition.includes(`'${value}'`))
    && !equipment.definition.includes('out_of_service'), 'EQUIPMENT_BASELINE_CHANGED');
  const policies = await client.query("select policyname from pg_policies where schemaname='public' and tablename='audit_log'");
  assert.equal(policies.rowCount, 0, 'AUDIT_POLICY_ALREADY_PRESENT');
  await client.query('rollback');
  inTransaction = false;
  return counts;
}

async function apply() {
  const flow = migrations[0].raw;
  const audit = migrations[1].raw;
  assert.match(audit, /^begin;\s*/i);
  assert.match(audit, /\s*commit;\s*$/i);
  const auditBody = audit.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
  await client.query('begin'); inTransaction = true;
  await client.query("set local lock_timeout = '5s'");
  const count = (await client.query('select count(*)::int as count from tracepoint_migrations.applied_migrations')).rows[0].count;
  assert.equal(count, 97, 'LINEAGE_CHANGED_BEFORE_APPLY');
  await client.query(flow);
  await client.query("insert into tracepoint_migrations.applied_migrations(kind,name,sha256) values('aws',$1,$2)", [migrations[0].name,migrations[0].sha256]);
  await client.query(auditBody);
  await client.query("insert into tracepoint_migrations.applied_migrations(kind,name,sha256) values('aws',$1,$2)", [migrations[1].name,migrations[1].sha256]);
  await client.query('alter table public.firearm_assignments add column magazines_expected_return integer');
  await client.query('alter table public.firearm_assignments add constraint firearm_assignments_magazines_expected_return_nonnegative check (magazines_expected_return is null or magazines_expected_return >= 0) not valid');
  await client.query('alter table public.equipment_assets drop constraint equipment_assets_lifecycle_status_check');
  await client.query("alter table public.equipment_assets add constraint equipment_assets_lifecycle_status_check check (lifecycle_status in ('active','maintenance','expired','removed','out_of_service'))");
  phase = 'postconditions';
  const lineage = (await client.query('select count(*)::int as count from tracepoint_migrations.applied_migrations')).rows[0].count;
  assert.equal(lineage, 99, 'LINEAGE_NOT_COMPLETE');
  const flowCheck = (await client.query("select pg_get_constraintdef(oid) as definition,convalidated from pg_constraint where conrelid='public.authentication_flow_transactions'::regclass and conname='authentication_flow_transactions_check'")).rows;
  assert.equal(flowCheck.length, 1);
  assert.ok(flowCheck[0].convalidated && /00:10:00|10 minutes/.test(flowCheck[0].definition), 'FLOW_WINDOW_NOT_TEN_MINUTES');
  const auditPolicy = (await client.query("select policyname,cmd,roles @> array['authenticated']::name[] as authenticated from pg_policies where schemaname='public' and tablename='audit_log'")).rows;
  assert.deepEqual(auditPolicy, [{ policyname: 'audit_log_select_authorized', cmd: 'SELECT', authenticated: true }]);
  const auditGrant = (await client.query("select has_table_privilege('authenticated','public.audit_log','SELECT') as allowed")).rows[0].allowed;
  assert.equal(auditGrant, true);
  const firearm = (await client.query("select convalidated from pg_constraint where conrelid='public.firearm_assignments'::regclass and conname='firearm_assignments_magazines_expected_return_nonnegative'")).rows;
  assert.deepEqual(firearm, [{ convalidated: false }]);
  const equipment = (await client.query("select pg_get_constraintdef(oid) as definition,convalidated from pg_constraint where conrelid='public.equipment_assets'::regclass and conname='equipment_assets_lifecycle_status_check'")).rows;
  assert.equal(equipment.length, 1);
  assert.ok(equipment[0].convalidated && ['active','maintenance','expired','removed','out_of_service'].every(value => equipment[0].definition.includes(`'${value}'`)));
  await client.query('commit'); inTransaction = false;
  return { lineage, flowWindowMinutes: 10, auditPolicy: true, firearmColumn: true, equipmentStatuses: 5 };
}

(async () => {
  await client.connect();
  try {
    phase = 'preflight'; const before = await preflight();
    phase = 'transaction'; const after = await apply();
    console.log(JSON.stringify({ result: 'FINAL_TARGET_SCHEMA_PREP_PASS', targetResourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE',
      baselineLineage: 97, appliedMigrations: migrations.map(({name,sha256}) => ({name,sha256})),
      before, after, customerRowsChanged: 0 }));
  } catch (error) { if (inTransaction) await client.query('rollback').catch(() => undefined); throw error; }
  finally { await client.end(); }
})().catch(error => { console.error(JSON.stringify({ result: 'FINAL_TARGET_SCHEMA_PREP_FAIL', phase,
  code: error.code || error.message })); process.exitCode = 1; });
