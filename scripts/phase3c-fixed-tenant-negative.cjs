// Fixed read-only rehearsal proof. Run only as a one-off isolated ECS task.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');

const host = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const montville = '1d0e2994-4224-4237-8328-71020ba20027';
const readington = 'd01a3f80-9b0f-4a9d-bf2b-9b2dc29f50e0';
const administrator = 'c38e1b61-551b-4519-ae3e-6b0f76a1ac01';
const officer = 'b3848045-a73a-4f81-8a0e-cbd92abcd1be';
const tables = ['fleet_vehicles', 'firearms', 'equipment_assets', 'audit_log'];
const secret = JSON.parse(process.env.TRACEPOINT_DATABASE_SECRET_JSON || 'null');
assert.equal(secret?.host, host);
assert.equal(secret?.dbname, 'tracepoint');
assert.equal(secret?.port, 5432);
assert.equal(secret?.username, 'tracepoint_runtime');
const ca = readFileSync('/app/rds-ca.pem', 'utf8');
assert.match(ca, /BEGIN CERTIFICATE/);
const client = new Client({ host, port: 5432, user: secret.username, password: secret.password,
  database: 'tracepoint', ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000,
  statement_timeout: 10000, application_name: 'tracepoint-phase3c-fixed-tenant-negative' });
let phase = 'connect';

async function actorProbe(subject, own, foreign, actor) {
  phase = `${actor}-begin`;
  await client.query('begin read only');
  try {
    phase = `${actor}-role`;
    await client.query('set local role authenticated');
    await client.query("select set_config('tracepoint.subject_id',$1,true)", [subject]);
    await client.query("select set_config('tracepoint.department_id',$1,true)", [own]);
    phase = `${actor}-membership`;
    const member = await client.query('select public.is_department_member($1) as own, public.is_department_member($2) as foreign', [own, foreign]);
    assert.equal(member.rows[0].own, true);
    assert.equal(member.rows[0].foreign, actor === 'administrator');
    phase = `${actor}-permission`;
    const permission = await client.query("select public.has_department_permission($1,'manage_users') as own, public.has_department_permission($2,'manage_users') as foreign", [own, foreign]);
    assert.equal(permission.rows[0].own, actor === 'administrator');
    assert.equal(permission.rows[0].foreign, actor === 'administrator');
    const results = [];
    for (const table of tables) {
      const sql = `select count(*)::int as count from public.${table} where department_id=$1`;
      async function countOrDenied(departmentId) {
        await client.query('savepoint read_probe');
        try {
          const result = (await client.query(sql, [departmentId])).rows[0].count;
          await client.query('release savepoint read_probe');
          return result;
        } catch (error) {
          await client.query('rollback to savepoint read_probe');
          await client.query('release savepoint read_probe');
          if (error.code === '42501') return 'denied';
          throw error;
        }
      }
      const local = await countOrDenied(own);
      const cross = await countOrDenied(foreign);
      if (actor === 'officer') assert.ok(cross === 0 || cross === 'denied', `cross-tenant visibility: ${table}`);
      results.push({ table, localCount: local, foreignCount: cross });
    }
    await client.query('rollback');
    return { actor, own: own === montville ? 'montville' : 'readington', results };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}

(async () => {
  await client.connect();
  try {
    phase = 'target-identity';
    const identity = await client.query("select current_database() as db, current_user as role, (select ssl from pg_stat_ssl where pid=pg_backend_pid()) as tls");
    assert.deepEqual(identity.rows[0], { db: 'tracepoint', role: 'tracepoint_runtime', tls: true });
    const evidence = [
      await actorProbe(officer, readington, montville, 'officer'),
      await actorProbe(administrator, readington, montville, 'administrator'),
      await actorProbe(administrator, montville, readington, 'administrator'),
    ];
    console.log(JSON.stringify({ result: 'DATABASE_RLS_NEGATIVE_PASS', evidence }));
  } finally { await client.end(); }
})().catch(error => { console.error(JSON.stringify({ result: 'DATABASE_RLS_NEGATIVE_FAIL', phase, code: error.code || error.message })); process.exitCode = 1; });
