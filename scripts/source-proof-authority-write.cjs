// One fixed synthetic AWS-only write for the isolated data-authority rollback proof.
// Runs only in the established private source-proof ECS lane; never contacts Supabase.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const pg = require('pg');
const { RDSClient, DescribeDBInstancesCommand } = require('@aws-sdk/client-rds');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const TARGET_ID = 'tracepoint-production-source-proof-20260925';
const TARGET_RESOURCE_ID = 'db-3ASM37H2KILXI7IQIPHY6MW2UE';
const TARGET_HOST = `${TARGET_ID}.c8r4sgs089tu.us-east-1.rds.amazonaws.com`;
const ARTIFACT = Object.freeze({
  bucket: 'tracepoint-production-private-193644343389',
  key: 'migration/source-rehearsal/f823a021-46ab-4c00-8465-63cd46192c93/final-canonical.json',
  versionId: 'lFRg96kOSsomvrL6PY4rDjjuruifiZwn',
  byteSha256: 'e51df222bfd22e97ab1163f1ebc478c135822bfeb02dd29cf49cff0f2f0c131d',
  masterSha256: '7b66b2942b470d6acbc13d0dac0372feb855ecb4791c36e7b1b1e74337ff2f9d',
});
const DEPARTMENT_ID = 'acb5b501-2309-4a9e-a504-f36c08728fa9';
const USER_ID = '3698d462-6367-4a3b-98ba-27d9279fe457';
const VEHICLE_ID = '4fe22291-4da8-4e98-acbe-e12be4a943ad';
const UNIT = 'TP-AUTH-ROLLBACK-20260925';
const CREATED_AT = '2026-09-26T00:55:00.000Z';
const mode = process.env.SOURCE_PROOF_ROLLBACK_MODE;
assert.ok(mode === 'preflight' || mode === 'aws-write', 'INVALID_FIXED_MODE');
const rawSecret = process.env.TARGET_DATABASE_SECRET_JSON;
delete process.env.TARGET_DATABASE_SECRET_JSON;
assert.ok(rawSecret, 'TARGET_SECRET_MISSING');
const secret = JSON.parse(rawSecret);
assert.equal(secret.dbname, 'tracepoint', 'TARGET_DATABASE_MISMATCH');
const ca = fs.readFileSync('/app/rds-ca.pem', 'utf8');
const client = new pg.Client({ host: TARGET_HOST, port: 5432, database: 'tracepoint',
  user: secret.username, password: secret.password,
  ssl: { ca, rejectUnauthorized: true, servername: TARGET_HOST },
  connectionTimeoutMillis: 15000, statement_timeout: 60000,
  application_name: `tracepoint-source-proof-authority-${mode}` });
const rds = new RDSClient({ region: 'us-east-1', maxAttempts: 1 });
const s3 = new S3Client({ region: 'us-east-1', maxAttempts: 1 });
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
let phase = 'control-plane', inTransaction = false;

async function count(sql, values = []) {
  const result = await client.query(sql, values);
  return Number(result.rows[0].n);
}

(async () => {
  const instances = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: TARGET_ID }))).DBInstances;
  assert.equal(instances?.length, 1, 'TARGET_INSTANCE_COUNT_MISMATCH');
  const instance = instances[0];
  assert.equal(instance.DbiResourceId, TARGET_RESOURCE_ID, 'TARGET_RESOURCE_MISMATCH');
  assert.equal(instance.Endpoint?.Address, TARGET_HOST, 'TARGET_HOST_MISMATCH');
  assert.equal(instance.PubliclyAccessible, false, 'TARGET_NOT_PRIVATE');
  assert.equal(instance.StorageEncrypted, true, 'TARGET_NOT_ENCRYPTED');

  phase = 'pinned-artifact';
  const response = await s3.send(new GetObjectCommand({ Bucket: ARTIFACT.bucket,
    Key: ARTIFACT.key, VersionId: ARTIFACT.versionId, ExpectedBucketOwner: '193644343389' }));
  assert.equal(response.VersionId, ARTIFACT.versionId, 'ARTIFACT_VERSION_MISMATCH');
  const bytes = await response.Body.transformToByteArray();
  assert.equal(sha256(bytes), ARTIFACT.byteSha256, 'ARTIFACT_BYTE_HASH_MISMATCH');
  const artifact = JSON.parse(Buffer.from(bytes).toString('utf8'));
  assert.equal(artifact.masterSha256, ARTIFACT.masterSha256, 'ARTIFACT_MASTER_HASH_MISMATCH');
  assert.equal(artifact.source.projectRef, 'reukdouvpshshvqnzsgw', 'SOURCE_PROJECT_MISMATCH');
  assert.equal(artifact.source.fenceChangedAt, '2026-09-25T02:48:12.321047Z', 'SOURCE_FENCE_MISMATCH');
  assert.equal(artifact.totalRelationalRows, 167, 'BASELINE_ROW_COUNT_MISMATCH');
  assert.equal(artifact.rows.departments.length, 1, 'SOURCE_DEPARTMENT_COUNT_MISMATCH');
  assert.equal(artifact.rows.departments[0].id, DEPARTMENT_ID, 'SOURCE_DEPARTMENT_ID_MISMATCH');
  assert.equal(artifact.rows.fleet_vehicles.length, 0, 'SOURCE_MARKER_ALREADY_PRESENT');

  phase = 'target-preflight';
  await client.connect();
  assert.equal((await client.query('select current_database() as name')).rows[0].name, 'tracepoint', 'TARGET_DATABASE_MISMATCH');
  assert.equal(await count("select count(*)::int as n from public.departments where id = $1 and slug = 'tracepoint-source-rehearsal-20260925'", [DEPARTMENT_ID]), 1, 'SYNTHETIC_TENANT_MISMATCH');
  assert.equal(await count('select count(*)::int as n from public.profiles where id = $1', [USER_ID]), 1, 'SYNTHETIC_USER_MISMATCH');
  assert.equal(await count('select count(*)::int as n from public.department_memberships where department_id = $1 and user_id = $2 and is_active = true', [DEPARTMENT_ID, USER_ID]), 1, 'SYNTHETIC_MEMBERSHIP_MISMATCH');
  assert.equal(await count('select count(*)::int as n from public.fleet_vehicles where id = $1 or (department_id = $2 and unit_number = $3)', [VEHICLE_ID, DEPARTMENT_ID, UNIT]), 0, 'AWS_ONLY_MARKER_ALREADY_PRESENT');
  assert.equal(await count("select count(*)::int as n from public.audit_events where department_id = $1 and entity_type = 'fleet_vehicles' and entity_id = $2", [DEPARTMENT_ID, VEHICLE_ID]), 0, 'AWS_ONLY_AUDIT_ALREADY_PRESENT');
  assert.equal(await count("select count(*)::int as n from pg_trigger where tgrelid = 'public.fleet_vehicles'::regclass and tgname = 'fleet_vehicles_accountability_audit' and tgenabled = 'O'"), 1, 'FLEET_AUDIT_TRIGGER_MISMATCH');
  if (mode === 'preflight') {
    console.log(JSON.stringify({ status: 'AUTHORITY_WRITE_PREFLIGHT_PASS', targetResourceId: TARGET_RESOURCE_ID,
      tlsVerified: true, sourceArtifactVersionId: ARTIFACT.versionId, syntheticTenantOnly: true,
      baselineSourceRows: 167, markerRows: 0, auditRows: 0, writesPerformed: false }));
    return;
  }

  phase = 'atomic-synthetic-write';
  await client.query('begin'); inTransaction = true;
  await client.query(`insert into public.fleet_vehicles
    (id, department_id, unit_number, status, assignment_type, current_mileage, current_hours,
     open_issue_count, created_by_user_id, updated_by_user_id, created_at, updated_at, retired_at)
    values ($1, $2, $3, 'Retired', 'Pool', 0, 0, 0, $4, $4, $5, $5, $5)`,
    [VEHICLE_ID, DEPARTMENT_ID, UNIT, USER_ID, CREATED_AT]);
  assert.equal(await count('select count(*)::int as n from public.fleet_vehicles where id = $1 and department_id = $2 and unit_number = $3 and status = $4', [VEHICLE_ID, DEPARTMENT_ID, UNIT, 'Retired']), 1, 'AWS_ONLY_WRITE_MISMATCH');
  assert.equal(await count("select count(*)::int as n from public.audit_events where department_id = $1 and entity_type = 'fleet_vehicles' and entity_id = $2 and action = 'insert' and actor_user_id = $3 and details->>'source' = 'database_trigger'", [DEPARTMENT_ID, VEHICLE_ID, USER_ID]), 1, 'AWS_ONLY_AUDIT_MISMATCH');
  await client.query('commit'); inTransaction = false;
  phase = 'post-commit';
  assert.equal(await count('select count(*)::int as n from public.fleet_vehicles where id = $1', [VEHICLE_ID]), 1, 'POST_COMMIT_WRITE_MISSING');
  assert.equal(await count("select count(*)::int as n from public.audit_events where department_id = $1 and entity_type = 'fleet_vehicles' and entity_id = $2", [DEPARTMENT_ID, VEHICLE_ID]), 1, 'POST_COMMIT_AUDIT_MISMATCH');
  console.log(JSON.stringify({ status: 'AWS_ONLY_SYNTHETIC_WRITE_PASS', targetResourceId: TARGET_RESOURCE_ID,
    tenantId: DEPARTMENT_ID, vehicleId: VEHICLE_ID, markerRows: 1, auditRows: 1,
    sourceUntouched: true, publicProductionUntouched: true }));
})().catch(async error => {
  if (inTransaction) await client.query('rollback').catch(() => {});
  console.error(JSON.stringify({ status: 'FAILED', mode, phase, code: error.code ?? null,
    detail: /^[A-Z_]+$/.test(String(error.message)) ? error.message : null,
    relationalRollbackAttempted: inTransaction }));
  process.exitCode = 1;
}).finally(async () => { await client.end().catch(() => {}); rds.destroy(); s3.destroy(); });
