// Fixed read-only check of the isolated AWS-only marker after source rehearsal replay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');

const HOST = 'tracepoint-production-source-proof-20260925.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const DEPARTMENT = 'acb5b501-2309-4a9e-a504-f36c08728fa9';
const USER = '3698d462-6367-4a3b-98ba-27d9279fe457';
const VEHICLE = '4fe22291-4da8-4e98-acbe-e12be4a943ad';
const secretText = process.env.TARGET_DATABASE_SECRET_JSON;
delete process.env.TARGET_DATABASE_SECRET_JSON;
assert.ok(secretText, 'TARGET_SECRET_MISSING');
const secret = JSON.parse(secretText);
assert.equal(secret.dbname, 'tracepoint', 'TARGET_DATABASE_MISMATCH');
assert.equal(process.env.TARGET_PGHOST, HOST, 'TARGET_HOST_MISMATCH');
const ca = fs.readFileSync('/app/rds-ca.pem', 'utf8');
assert.ok(ca.includes('BEGIN CERTIFICATE'), 'RDS_CA_MISSING');
const client = new Client({ host: HOST, port: 5432, database: 'tracepoint',
  user: secret.username, password: secret.password,
  ssl: { ca, rejectUnauthorized: true, servername: HOST },
  connectionTimeoutMillis: 15000, statement_timeout: 30000,
  application_name: 'tracepoint-source-proof-post-replay-readonly' });
async function count(sql, values = []) {
  const result = await client.query(sql, values);
  return Number(result.rows[0].n);
}

(async () => {
  await client.connect();
  await client.query('begin read only');
  assert.equal((await client.query('select current_database() as name')).rows[0].name, 'tracepoint', 'DATABASE_MISMATCH');
  assert.equal(await count('select count(*)::int as n from pg_stat_ssl where pid = pg_backend_pid() and ssl = true'), 1, 'TLS_NOT_ACTIVE');
  assert.equal(await count("select count(*)::int as n from public.departments where id = $1 and slug = 'tracepoint-source-rehearsal-20260925'", [DEPARTMENT]), 1, 'SYNTHETIC_TENANT_MISMATCH');
  assert.equal(await count('select count(*)::int as n from public.profiles where id = $1', [USER]), 1, 'SYNTHETIC_USER_MISMATCH');
  assert.equal(await count('select count(*)::int as n from public.department_memberships where department_id = $1 and user_id = $2 and is_active = true', [DEPARTMENT, USER]), 1, 'SYNTHETIC_MEMBERSHIP_MISMATCH');
  assert.equal(await count("select count(*)::int as n from public.fleet_vehicles where id = $1 and department_id = $2 and unit_number = 'TP-AUTH-ROLLBACK-20260925' and status = 'Retired' and assignment_type = 'Pool' and current_mileage = 0 and current_hours = 0 and open_issue_count = 0 and created_by_user_id = $3 and updated_by_user_id = $3 and created_at = '2026-09-26T00:55:00.000Z'::timestamptz and updated_at = '2026-09-26T00:55:00.000Z'::timestamptz and retired_at = '2026-09-26T00:55:00.000Z'::timestamptz", [VEHICLE, DEPARTMENT, USER]), 1, 'AWS_MARKER_CHANGED');
  assert.equal(await count("select count(*)::int as n from public.audit_events where department_id = $1 and entity_type = 'fleet_vehicles' and entity_id = $2 and action = 'insert' and actor_user_id = $3 and details->>'source' = 'database_trigger'", [DEPARTMENT, VEHICLE, USER]), 1, 'AWS_AUDIT_CHANGED');
  assert.equal(await count('select count(*)::int as n from public.fleet_vehicles'), 1, 'AWS_FLEET_COUNT_CHANGED');
  assert.equal(await count('select count(*)::int as n from public.audit_events'), 40, 'AWS_AUDIT_COUNT_CHANGED');
  await client.query('commit');
  console.log(JSON.stringify({ status: 'AWS_PROOF_TARGET_INTACT', targetHost: HOST,
    tlsVerified: true, syntheticTenantOnly: true, markerRows: 1, markerAuditRows: 1,
    fleetRows: 1, auditRows: 40, writesPerformed: false }));
})().catch(async error => {
  await client.query('rollback').catch(() => {});
  console.error(JSON.stringify({ status: 'FAILED', code: /^[A-Z_]+$/.test(String(error.message)) ? error.message : 'TARGET_READONLY_VERIFY_FAILED' }));
  process.exitCode = 1;
}).finally(() => client.end().catch(() => {}));
