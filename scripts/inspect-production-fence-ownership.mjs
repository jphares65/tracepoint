#!/usr/bin/env node
// Read-only ownership and privilege inventory for the pinned production source.
// Never emits credentials or customer rows.
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const secret = JSON.parse(readFileSync(0, 'utf8'));
const mode = process.argv[2] ?? '--summary';
assert.ok(['--summary', '--full', '--readiness'].includes(mode));
assert.equal(secret.host, 'aws-1-us-east-1.pooler.supabase.com');
assert.equal(Number(secret.port), 5432);
assert.equal(secret.dbname, 'postgres');
assert.equal(secret.username, 'tracepoint_migration_reader.izlkwggluhlhzlumtzes');
assert.ok(typeof secret.password === 'string' && secret.password.length > 0);
const ca = readFileSync(new URL('../assets/supabase-root-2021-ca.pem', import.meta.url), 'utf8');
assert.equal(new X509Certificate(ca).fingerprint256,
  '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
const client = new pg.Client({ host: secret.host, port: 5432, database: 'postgres',
  user: secret.username, password: secret.password,
  ssl: { ca, servername: secret.host, rejectUnauthorized: true },
  connectionTimeoutMillis: 10000, query_timeout: 20000 });
delete secret.password;

try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  assert.equal(client.connection.stream.authorized, true);
  const identity = (await client.query(`SELECT current_database() AS database,
    current_user AS db_role, current_setting('transaction_read_only') AS read_only`)).rows[0];
  assert.deepEqual(identity, { database: 'postgres', db_role: 'tracepoint_migration_reader', read_only: 'on' });
  const rows = (await client.query(`SELECT n.nspname AS schema_name, c.relname AS table_name,
      pg_get_userbyid(c.relowner) AS owner, owner_role.rolsuper AS owner_superuser,
      pg_has_role('postgres', c.relowner, 'MEMBER') AS postgres_member_of_owner,
      has_table_privilege('postgres', c.oid, 'TRIGGER') AS postgres_can_create_trigger,
      (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS trigger_count,
      (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal
        AND t.tgname LIKE 'tracepoint_write_fence%') AS fence_trigger_count,
      ARRAY(SELECT DISTINCT coalesce(grantee.rolname, 'PUBLIC')
        FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
        LEFT JOIN pg_roles grantee ON grantee.oid=acl.grantee
        WHERE acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
        ORDER BY 1) AS explicit_write_grantees
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_roles owner_role ON owner_role.oid=c.relowner
    WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p')
    ORDER BY n.nspname,c.relname`)).rows;
  assert.equal(rows.length, 122, 'PRODUCTION_RELATION_COUNT_DRIFT');
  const fingerprint = (await client.query(`SELECT md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text,
      E'\n' ORDER BY n.nspname, c.relname)) AS digest
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p')`)).rows[0].digest;
  assert.equal(fingerprint, '36558b0730e3e96cad6426f38088a5b0', 'PRODUCTION_RELATION_FINGERPRINT_DRIFT');
  await client.query('ROLLBACK');
  const ownerGroups = Object.fromEntries(['public','auth','storage'].map(schema => [schema, {
    count: rows.filter(r => r.schema_name===schema).length,
    owner: [...new Set(rows.filter(r => r.schema_name===schema).map(r => r.owner))],
    postgresCanAlterTriggerState: rows.filter(r => r.schema_name===schema)
      .every(r => r.postgres_member_of_owner),
  }]));
  const uncovered = rows.filter(r => !r.postgres_member_of_owner).map(r =>
    `${r.schema_name}.${r.table_name}`);
  const report = { projectRef: 'izlkwggluhlhzlumtzes', clientTlsVerified: true,
    transactionReadOnly: true, relationCount: rows.length, relationFingerprint: fingerprint,
    ownerGroups, uncoveredOwnerControlledRelations: uncovered,
    noCustomerRowsRead: true };
  if (mode === '--full') report.relations = rows;
  if (mode === '--readiness') {
    report.status = uncovered.length === 0 ? 'OWNER_TRIGGER_PREFLIGHT_PASS' : 'OWNER_TRIGGER_PREFLIGHT_BLOCKED';
    console.log(JSON.stringify(report, null, 2));
    if (uncovered.length > 0) process.exitCode = 2;
  } else console.log(JSON.stringify(report, null, 2));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(JSON.stringify({ status: 'OWNERSHIP_INVENTORY_FAILED', code: error.code ?? 'CONTRACT_MISMATCH',
    message: String(error.message).slice(0, 180) }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
