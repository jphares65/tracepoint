// Fixed, read-only catalog probe. Loaded as `node -e` by an isolated one-shot
// diagnostic task; no application, source, importer, or write path is initialized.
const { Client } = require('pg');
const { readFileSync } = require('node:fs');

const expectedHost = 'tracepoint-production-migration-clean-4272874f-final.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const requiredTables = [
  'authentication_identity_links',
  'authentication_flow_transactions',
  'authentication_access_sessions',
  'authentication_refresh_sessions',
  'authentication_session_revocations',
  'authentication_identity_events',
  'authentication_lifecycle_operations',
  'profiles',
  'departments',
  'department_memberships',
];
const requiredFunctions = [
  'subject_id', 'department_id', 'is_platform_supporting',
  'prepare_cognito_invite', 'commit_cognito_invite',
  'prepare_existing_cognito_migration', 'commit_existing_cognito_migration',
  'list_exceptional_cognito_identities', 'prepare_exceptional_cognito_migration',
  'commit_exceptional_cognito_migration',
];

async function main() {
  const secret = JSON.parse(process.env.TARGET_DATABASE_SECRET_JSON || '{}');
  if (process.env.TARGET_PGHOST !== expectedHost || process.env.TARGET_PGDATABASE !== 'tracepoint' ||
      secret.port !== 5432 || secret.dbname !== 'tracepoint' || !secret.username || !secret.password) {
    throw new Error('PINNED_TARGET_CONFIGURATION_MISMATCH');
  }
  const client = new Client({
    host: expectedHost, port: 5432, database: 'tracepoint',
    user: secret.username, password: secret.password,
    ssl: { ca: readFileSync('/app/rds-ca.pem', 'utf8'), rejectUnauthorized: true, servername: expectedHost },
    connectionTimeoutMillis: 15000, statement_timeout: 15000,
    options: '-c default_transaction_read_only=on',
    application_name: 'tracepoint-phase3b-native-auth-catalog-probe',
  });
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query(`SELECT current_database() AS database, current_user AS role,
      current_setting('transaction_read_only') AS read_only,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`)).rows[0];
    if (identity.database !== 'tracepoint' || identity.read_only !== 'on' || identity.tls !== true) {
      throw new Error('TARGET_READONLY_TLS_IDENTITY_MISMATCH');
    }
    const tables = (await client.query(`SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
      has_table_privilege('tracepoint_runtime', c.oid, 'SELECT') AS runtime_select,
      has_table_privilege('tracepoint_runtime', c.oid, 'INSERT') AS runtime_insert
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])
      ORDER BY c.relname`, [requiredTables])).rows;
    const columns = (await client.query(`SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])
      ORDER BY table_name, ordinal_position`, [requiredTables])).rows;
    const functions = (await client.query(`SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args,
      pg_get_function_result(p.oid) AS result_type, p.prosecdef AS security_definer,
      md5(pg_get_functiondef(p.oid)) AS definition_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='tracepoint_auth' AND p.proname=ANY($1::text[])
      ORDER BY p.proname, args`, [requiredFunctions])).rows;
    const policies = (await client.query(`SELECT tablename, policyname, roles, cmd,
      md5(coalesce(qual,'')) AS using_md5,
      md5(coalesce(with_check,'')) AS check_md5
      FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])
      ORDER BY tablename, policyname`, [requiredTables])).rows;
    const missingTables = requiredTables.filter(name => !tables.some(row => row.name === name));
    const missingFunctions = requiredFunctions.filter(name => !functions.some(row => row.name === name));
    const result = { status: missingTables.length || missingFunctions.length ? 'DIVERGENT' : 'PRESENT',
      target: { host: expectedHost, database: identity.database, role: identity.role, readOnly: identity.read_only, tls: identity.tls },
      tables, columns, functions, policies, missingTables, missingFunctions };
    // Catalog names/types/hashes only: no credentials, data rows, or PII.
    console.log(JSON.stringify(result));
    await client.query('ROLLBACK');
    if (result.status !== 'PRESENT') process.exitCode = 2;
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch(error => {
  console.error(JSON.stringify({ status: 'FAIL', code: error.code || error.message || 'UNKNOWN' }));
  process.exitCode = 1;
});
