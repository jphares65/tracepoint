#!/usr/bin/env node
// TLS-pinned, read-only production catalog inspection. No customer rows or secrets printed.
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const source = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(source.host, 'aws-1-us-east-1.pooler.supabase.com');
assert.equal(Number(source.port), 5432);
assert.equal(source.dbname, 'postgres');
assert.equal(source.username, 'tracepoint_migration_reader.izlkwggluhlhzlumtzes');
assert.ok(typeof source.password === 'string' && source.password.length > 0);
const ca = readFileSync(new URL('../assets/supabase-root-2021-ca.pem', import.meta.url), 'utf8');
assert.equal(new X509Certificate(ca).fingerprint256,
  '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
const client = new pg.Client({ host: source.host, port: 5432, database: source.dbname,
  user: source.username, password: source.password,
  ssl: { ca, servername: source.host, rejectUnauthorized: true },
  connectionTimeoutMillis: 10_000, query_timeout: 20_000 });
delete source.password;

try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  assert.equal(client.connection.stream.authorized, true);
  const identity = (await client.query(`SELECT current_database() AS database,
    current_user AS db_role, current_setting('transaction_read_only') AS read_only`)).rows[0];
  assert.deepEqual(identity, { database: 'postgres', db_role: 'tracepoint_migration_reader', read_only: 'on' });
  const authColumns = (await client.query(`SELECT column_name, data_type, is_nullable
    FROM information_schema.columns WHERE table_schema='auth' AND table_name='users'
    ORDER BY ordinal_position`)).rows;
  const storagePolicies = (await client.query(`SELECT schemaname, tablename, policyname, permissive,
      roles, cmd, qual, with_check FROM pg_policies
    WHERE schemaname='storage' ORDER BY tablename, policyname`)).rows;
  const storageGrants = (await client.query(`SELECT table_name, grantee, privilege_type
    FROM information_schema.role_table_grants WHERE table_schema='storage'
      AND privilege_type IN ('INSERT','UPDATE','DELETE')
    ORDER BY table_name, grantee, privilege_type`)).rows;
  const storageRls = (await client.query(`SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='storage' AND c.relkind IN ('r','p') ORDER BY c.relname`)).rows;
  const authControlGrants = (await client.query(`SELECT c.relname AS relation,
      pg_get_userbyid(c.relowner) AS owner, c.relacl::text AS acl
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='auth' AND c.relname IN ('sessions','refresh_tokens')
    ORDER BY c.relname`)).rows;
  let authSessionInventory;
  try {
    authSessionInventory = (await client.query(`SELECT
      (SELECT count(*)::int FROM auth.sessions) AS sessions,
      (SELECT count(*)::int FROM auth.refresh_tokens) AS refresh_tokens,
      (SELECT count(*)::int FROM auth.refresh_tokens WHERE session_id IS NULL)
        AS legacy_refresh_tokens_without_session`)).rows[0];
  } catch (error) {
    if (error.code !== '42501') throw error;
    authSessionInventory = { readable: false, reason: 'READER_ROLE_PERMISSION_DENIED' };
  }
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ projectRef: 'izlkwggluhlhzlumtzes',
    tlsVerified: true, transactionReadOnly: true, authColumns,
    storagePolicies, storageGrants, storageRls, authControlGrants, authSessionInventory,
    customerRowsRead: false }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(JSON.stringify({ status: 'PRODUCTION_AUTH_STORAGE_CATALOG_FAILED',
    code: String(error.code ?? 'CONTRACT_MISMATCH') }));
  process.exitCode = 2;
} finally {
  await client.end().catch(() => undefined);
}
