$ErrorActionPreference = 'Stop'

$source = (aws ecs describe-task-definition --task-definition tracepoint-production-source-proof-read-only-20260925:2 --profile tracepoint-production --region us-east-1 --output json | ConvertFrom-Json).taskDefinition
$code = @'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('pg');

const hosts = Object.freeze({
  original: 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
  restored: 'tracepoint-production-rehearsal-restore-proof-20260925.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
});
const secret = JSON.parse(process.env.TARGET_DATABASE_SECRET_JSON);
delete process.env.TARGET_DATABASE_SECRET_JSON;
assert.equal(secret.dbname, 'tracepoint');
const ca = fs.readFileSync('/app/rds-ca.pem', 'utf8');
const queries = Object.freeze({
  database: 'SELECT current_database() AS name',
  lineage: 'SELECT count(*)::int AS n FROM tracepoint_migrations.applied_migrations',
  departments: 'SELECT count(*)::int AS n FROM public.departments',
  profiles: 'SELECT count(*)::int AS n FROM public.profiles',
  identities: 'SELECT count(*)::int AS n FROM auth.users',
  auditEvents: 'SELECT count(*)::int AS n FROM public.audit_events',
  rolePermissions: 'SELECT count(*)::int AS n FROM public.department_role_permissions',
  departmentIdSet: 'SELECT id::text AS id FROM public.departments ORDER BY id',
});

async function inspect(label, host) {
  const client = new Client({
    host, port: 5432, database: 'tracepoint', user: secret.username,
    password: secret.password,
    ssl: { ca, rejectUnauthorized: true, servername: host },
    connectionTimeoutMillis: 15000, statement_timeout: 30000,
    application_name: 'tracepoint-phase3c-restore-proof-read-only',
  });
  try {
    await client.connect();
    assert.equal(client.connection.stream.encrypted, true);
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const database = (await client.query(queries.database)).rows[0].name;
    assert.equal(database, 'tracepoint');
    const result = { label, host, database, tlsVerified: true };
    for (const key of ['lineage', 'departments', 'profiles', 'identities', 'auditEvents', 'rolePermissions']) {
      result[key] = (await client.query(queries[key])).rows[0].n;
    }
    const ids = (await client.query(queries.departmentIdSet)).rows.map(row => row.id);
    result.departmentIdSetSha256 = crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex');
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

(async () => {
  const original = await inspect('original', hosts.original);
  const restored = await inspect('restored', hosts.restored);
  assert.ok(restored.lineage >= 99, 'restored schema lineage is incomplete');
  assert.ok(restored.departments >= 2, 'restored imported departments are missing');
  assert.ok(restored.identities >= 96, 'restored imported identities are missing');
  assert.equal(restored.departmentIdSetSha256, original.departmentIdSetSha256);
  console.log(JSON.stringify({ status: 'RESTORE_READ_ONLY_PASS', original, restored }));
})().catch(error => {
  console.error(JSON.stringify({ status: 'RESTORE_READ_ONLY_FAIL', code: error.code || null, name: error.name }));
  process.exitCode = 1;
});
'@

$container = $source.containerDefinitions[0]
$container.entryPoint = @('node', '-e')
$container.command = @($code)
$container.environment = @()
$request = @{
  family = 'tracepoint-production-phase3c-restore-proof-read-only-20260925'
  taskRoleArn = $source.taskRoleArn
  executionRoleArn = $source.executionRoleArn
  networkMode = $source.networkMode
  containerDefinitions = @($container)
  requiresCompatibilities = $source.requiresCompatibilities
  cpu = $source.cpu
  memory = $source.memory
}
if ($source.runtimePlatform) { $request.runtimePlatform = $source.runtimePlatform }
$json = $request | ConvertTo-Json -Depth 50 -Compress
aws ecs register-task-definition --cli-input-json $json --profile tracepoint-production --region us-east-1 --query 'taskDefinition.taskDefinitionArn' --output text
