#!/usr/bin/env node
// Read-only live-source identity/catalog probe. Never prints credentials or row values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/migration/source-postgres-KOMJRk';
const HOST = 'aws-1-us-east-1.pooler.supabase.com';
const USER = 'tracepoint_migration_reader.izlkwggluhlhzlumtzes';
const PROJECT_REF = 'izlkwggluhlhzlumtzes';
const CA_FINGERPRINT = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';

function readPinnedSecret() {
  if (process.env.TRACEPOINT_SECRET_STDIN === '1') {
    const secret = JSON.parse(readFileSync(0, 'utf8'));
    assert.equal(secret.host, HOST);
    assert.equal(Number(secret.port), 5432);
    assert.equal(secret.dbname, 'postgres');
    assert.equal(secret.username, USER);
    assert.ok(typeof secret.password === 'string' && secret.password.length > 0);
    return secret;
  }
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws', ['secretsmanager', 'get-secret-value', '--secret-id', SECRET_ARN,
    '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'json'],
  { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) {
    console.error(JSON.stringify({ code: 'PINNED_SOURCE_SECRET_UNAVAILABLE', spawnError: result.error?.code ?? null,
      awsErrorClass: /ExpiredToken/.test(result.stderr ?? '') ? 'ExpiredToken' :
        /AccessDenied/.test(result.stderr ?? '') ? 'AccessDenied' : 'Other' }));
    process.exit(1);
  }
  const secret = JSON.parse(JSON.parse(result.stdout).SecretString);
  assert.equal(secret.host, HOST);
  assert.equal(Number(secret.port), 5432);
  assert.equal(secret.dbname, 'postgres');
  assert.equal(secret.username, USER);
  assert.ok(typeof secret.password === 'string' && secret.password.length > 0);
  return secret;
}

const secret = readPinnedSecret();
const ca = readFileSync(new URL('../assets/supabase-root-2021-ca.pem', import.meta.url), 'utf8');
assert.equal(new X509Certificate(ca).fingerprint256, CA_FINGERPRINT, 'SUPABASE_CA_FINGERPRINT_MISMATCH');
const client = new pg.Client({ host: secret.host, port: Number(secret.port), database: secret.dbname,
  user: secret.username, password: secret.password, ssl: { ca, servername: HOST, rejectUnauthorized: true },
  connectionTimeoutMillis: 10000, query_timeout: 15000 });
delete secret.password;

try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const identity = (await client.query(`SELECT current_database() AS database, current_user AS db_role,
    current_setting('transaction_read_only') AS read_only,
    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls_active`)).rows[0];
  assert.equal(identity.database, 'postgres');
  assert.equal(identity.db_role, 'tracepoint_migration_reader');
  assert.equal(identity.read_only, 'on');
  // Supavisor terminates the client TLS session; pg_stat_ssl describes its separate backend hop.
  assert.equal(client.connection.stream.authorized, true, 'CLIENT_TLS_NOT_AUTHORIZED');
  const tables = (await client.query(`SELECT n.nspname AS schema_name, c.relname AS table_name,
      c.relkind AS relation_kind, c.relispartition AS is_partition, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'auth', 'storage') AND c.relkind IN ('r', 'p')
    ORDER BY 1, 2`)).rows;
  const fences = (await client.query(`SELECT n.nspname AS schema_name, c.relname AS table_name,
      t.tgname AS trigger_name
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth', 'storage')
      AND t.tgname LIKE 'tracepoint_write_fence%'
    ORDER BY 1, 2, 3`)).rows;
  const cutoverSchema = (await client.query(`SELECT EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = 'tracepoint_cutover') AS present`)).rows[0].present;
  const storagePolicies = (await client.query(`SELECT tablename AS table_name, policyname AS policy_name,
      cmd, roles, qual AS using_expression, with_check AS check_expression
    FROM pg_policies WHERE schemaname = 'storage'
    ORDER BY tablename, policyname`)).rows;
  const storageRolePrivileges = (await client.query(`SELECT table_name, grantee, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'storage' AND table_name IN ('objects', 'buckets')
      AND grantee IN ('anon', 'authenticated', 'service_role')
    ORDER BY table_name, grantee, privilege_type`)).rows;
  const storageEffectivePrivileges = (await client.query(`SELECT role_name,
      has_table_privilege(role_name, 'storage.objects', 'SELECT') AS can_select_objects,
      has_table_privilege(role_name, 'storage.objects', 'INSERT') AS can_insert_objects,
      has_table_privilege(role_name, 'storage.objects', 'UPDATE') AS can_update_objects,
      has_table_privilege(role_name, 'storage.objects', 'DELETE') AS can_delete_objects
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role_name
    ORDER BY role_name`)).rows;
  const storageOwnerDelegation = (await client.query(`SELECT
      pg_has_role('postgres', 'supabase_storage_admin', 'MEMBER') AS postgres_member_of_storage_owner,
      pg_has_role('postgres', 'supabase_storage_admin', 'USAGE') AS postgres_can_use_storage_owner`)).rows[0];
  const storageGrantors = (await client.query(`SELECT grantor::regrole::text AS grantor,
      grantee::regrole::text AS grantee, privilege_type
    FROM pg_class c, LATERAL aclexplode(c.relacl) acl
    WHERE c.oid = 'storage.objects'::regclass
      AND grantee IN ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    ORDER BY grantor, grantee, privilege_type`)).rows;
  const permissionFunction = (await client.query(`SELECT pg_get_userbyid(p.proowner) AS owner,
      md5(pg_get_functiondef(p.oid)) AS definition_md5,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p WHERE p.oid = 'public.has_department_permission(uuid,text)'::regprocedure`)).rows[0];
  let dispatcher = { readable: false };
  await client.query('SAVEPOINT dispatcher_probe');
  try {
    const jobs = (await client.query(`SELECT jobid, schedule, active, md5(command) AS command_md5
      FROM cron.job WHERE jobname = 'tracepoint-notification-email-dispatch'`)).rows;
    dispatcher = { readable: true, count: jobs.length, jobs };
  } catch (error) {
    if (error.code !== '42501' && error.code !== '42P01') throw error;
    await client.query('ROLLBACK TO SAVEPOINT dispatcher_probe');
  }
  await client.query('RELEASE SAVEPOINT dispatcher_probe');
  const digest = createHash('sha256').update(JSON.stringify(tables.map(({ schema_name, table_name, relation_kind }) =>
    ({ schema_name, table_name, relation_kind })))).digest('hex');
  const sqlDigest = (await client.query(`SELECT md5(string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text,
    E'\\n' ORDER BY n.nspname, c.relname)) AS value
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'auth', 'storage') AND c.relkind IN ('r', 'p')`)).rows[0].value;
  await client.query('ROLLBACK');
  console.log(JSON.stringify({ projectRef: PROJECT_REF, endpoint: HOST, database: identity.database,
    dbRole: identity.db_role, clientTlsVerified: true, poolerBackendSslFlag: identity.tls_active,
    transactionReadOnly: true,
    relationCount: tables.length, relationCountBySchema: Object.fromEntries(['public', 'auth', 'storage']
      .map(schema => [schema, tables.filter(row => row.schema_name === schema).length])),
    partitionCount: tables.filter(row => row.is_partition).length,
    ownerCounts: Object.fromEntries([...new Set(tables.map(row => row.owner))].sort()
      .map(owner => [owner, tables.filter(row => row.owner === owner).length])),
    relationCatalogSha256: digest, relationCatalogSqlMd5: sqlDigest,
    existingFenceTriggerCount: fences.length,
    cutoverSchemaPresent: cutoverSchema, dispatcher,
    storagePolicies, storageRolePrivileges, storageEffectivePrivileges,
    storageOwnerDelegation, storageGrantors, permissionFunction,
    noCustomerRowsRead: true }, null, 2));
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* connection may be unavailable */ }
  console.error(JSON.stringify({ status: 'READ_ONLY_PRODUCTION_CATALOG_FAILED', code: error.code ?? 'CONTRACT_MISMATCH',
    diagnostic: error.code === 'ERR_ASSERTION' || error.code === '42725' ? String(error.message).slice(0, 160) : undefined }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
