#!/usr/bin/env node
// Production source precheck only: catalog metadata, never ALTER/terminate.
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const secret = JSON.parse(readFileSync(0, 'utf8'));
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
    current_user AS db_role, current_setting('transaction_read_only') AS read_only,
    current_setting('default_transaction_read_only') AS default_read_only`)).rows[0];
  assert.equal(identity.database, 'postgres');
  assert.equal(identity.db_role, 'tracepoint_migration_reader');
  assert.equal(identity.read_only, 'on');
  const database = (await client.query(`SELECT pg_get_userbyid(d.datdba) AS owner,
      d.datallowconn AS connections_allowed,
      pg_has_role('postgres', d.datdba, 'MEMBER') AS sql_editor_member_of_owner
    FROM pg_database d WHERE d.datname='postgres'`)).rows[0];
  assert.ok(database?.connections_allowed);
  const overrides = (await client.query(`SELECT coalesce(r.rolname, '<all roles>') AS role_name,
      s.setdatabase::text AS database_oid, s.setrole::text AS role_oid,
      cfg.setting AS read_only_setting
    FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole
      CROSS JOIN LATERAL unnest(s.setconfig) AS cfg(setting)
    WHERE s.setdatabase IN (0, (SELECT oid FROM pg_database WHERE datname='postgres'))
      AND cfg.setting LIKE 'default_transaction_read_only=%'
    ORDER BY role_name,read_only_setting`)).rows;
  const databaseWideSetting = overrides.find(row => row.role_oid === '0' &&
    row.database_oid !== '0')?.read_only_setting ?? null;
  assert.notEqual(databaseWideSetting, 'default_transaction_read_only=on',
    'PRODUCTION_DATABASE_ALREADY_DEFAULT_READ_ONLY');
  const sessions = (await client.query(`SELECT coalesce(usename, '<internal>') AS role_name,
      coalesce(backend_type, '<unknown>') AS backend_type,
      coalesce(state, '<unknown>') AS state, count(*)::int AS sessions
    FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid()
    GROUP BY 1,2,3 ORDER BY 1,2,3`)).rows;
  const drain = (await client.query(`SELECT pg_has_role('postgres', 'pg_signal_backend', 'MEMBER')
    AS postgres_member_of_signal_backend`)).rows[0];
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ projectRef: 'izlkwggluhlhzlumtzes', clientTlsVerified: true,
    catalogTransactionReadOnly: true, database,
    readerSessionDefaultReadOnly: identity.default_read_only,
    databaseWideReadOnlySetting: databaseWideSetting,
    roleDatabaseReadOnlyOverrides: overrides, activeSessionGroups: sessions,
    drainPrivilegeHint: drain, caveat: 'ALTER DATABASE changes only new-session default; this probe cannot prove SQL Editor ALTER or terminate rights, nor prevent explicit READ WRITE overrides.',
    productionMutation: false }, null, 2));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* no active transaction */ }
  console.error(JSON.stringify({ status: 'PRODUCTION_READONLY_PRECHECK_FAILED',
    code: error.code ?? 'CONTRACT_MISMATCH', message: String(error.message).slice(0, 180) }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
