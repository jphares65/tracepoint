#!/usr/bin/env node
// Read-only direct-Postgres writer census for the exact live Supabase source.
// Emits role names and aggregate connection counts, never queries row data.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import pg from 'pg';

assert.deepEqual(process.argv.slice(2), ['--profile=tracepoint-production'], 'EXACT_PROFILE_REQUIRED');
const HOST = 'aws-1-us-east-1.pooler.supabase.com';
const USER = 'tracepoint_migration_reader.izlkwggluhlhzlumtzes';
const SECRET = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-postgres-KOMJRk';
const CA_FINGERPRINT = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';
const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
  ['secretsmanager', 'get-secret-value', '--secret-id', SECRET,
    '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'json'],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(result.status, 0, 'PINNED_SOURCE_SECRET_UNAVAILABLE');
const credential = JSON.parse(JSON.parse(result.stdout).SecretString);
assert.equal(credential.host, HOST);
assert.equal(credential.username, USER);
assert.equal(credential.dbname, 'postgres');
const ca = readFileSync(new URL('../assets/supabase-root-2021-ca.pem', import.meta.url), 'utf8');
assert.equal(new X509Certificate(ca).fingerprint256, CA_FINGERPRINT);
const client = new pg.Client({ host: HOST, port: 5432, database: 'postgres', user: USER,
  password: credential.password, ssl: { ca, servername: HOST, rejectUnauthorized: true },
  connectionTimeoutMillis: 10_000, query_timeout: 15_000 });
delete credential.password;
let stage = 'connection';
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  assert.equal(client.connection.stream.authorized, true, 'SOURCE_TLS_NOT_VERIFIED');
  const identity = (await client.query(`SELECT current_database() AS database,
    current_user AS role, current_setting('transaction_read_only') AS read_only`)).rows[0];
  assert.equal(identity.database, 'postgres');
  assert.equal(identity.role, 'tracepoint_migration_reader');
  assert.equal(identity.read_only, 'on');
  stage = 'roles';
  const roles = (await client.query(`SELECT rolname AS role, rolsuper AS superuser,
    rolbypassrls AS bypass_rls
    FROM pg_roles WHERE rolcanlogin ORDER BY rolname`)).rows;
  stage = 'sessions';
  const sessions = (await client.query(`SELECT usename AS role, application_name AS application,
    state, count(*)::integer AS connection_count
    FROM pg_stat_activity WHERE datname = current_database()
      AND pid <> pg_backend_pid()
    GROUP BY usename, application_name, state ORDER BY usename, application_name, state`)).rows;
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ status: 'PRODUCTION_DIRECT_DB_WRITER_CENSUS',
    sourceProject: 'izlkwggluhlhzlumtzes', tlsVerified: true,
    loginRoles: roles, currentConnections: sessions,
    customerRowsRead: false, mutations: false }));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* connection may be gone */ }
  console.error(JSON.stringify({ status: 'PRODUCTION_DIRECT_DB_WRITER_CENSUS_BLOCKED',
    stage,
    code: /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message :
      /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : 'CENSUS_FAILED' }));
  process.exitCode = 2;
} finally { await client.end().catch(() => {}); }
