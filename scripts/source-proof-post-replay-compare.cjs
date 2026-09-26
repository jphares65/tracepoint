// Fixed AWS-local comparison. Source rows and object keys never leave the task.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = 'tracepoint-production-private-193644343389';
const ARTIFACTS = Object.freeze([
  {
    key: 'migration/source-rehearsal/f823a021-46ab-4c00-8465-63cd46192c93/final-canonical.json',
    versionId: 'lFRg96kOSsomvrL6PY4rDjjuruifiZwn',
    byteSha256: 'e51df222bfd22e97ab1163f1ebc478c135822bfeb02dd29cf49cff0f2f0c131d',
    masterSha256: '7b66b2942b470d6acbc13d0dac0372feb855ecb4791c36e7b1b1e74337ff2f9d',
    expectedRows: 167,
  },
  {
    key: 'migration/source-rehearsal/c52fa580-69b0-4624-b0b6-06c47516efe6/final-canonical.json',
    versionId: 'Jnp1Xn7Dkd_KRDgDIIVTxYcW9BlGd.pU',
    byteSha256: '0cacde40cde53dc67ebf635a53195aa9917f7690de7ad41abe91595309b5ab6a',
    masterSha256: '7f4acf3e19b887ca98a8c8582545b60436f1fdef7ba7213404b9213c1ad1f7e6',
    expectedRows: 169,
  },
]);
const DEPARTMENT = 'acb5b501-2309-4a9e-a504-f36c08728fa9';
const USER = '3698d462-6367-4a3b-98ba-27d9279fe457';
const VEHICLE = '4fe22291-4da8-4e98-acbe-e12be4a943ad';
const UNIT = 'TP-AUTH-ROLLBACK-20260925';
const CREATED_AT = '2026-09-26T00:55:00.000Z';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const sameTime = value => typeof value === 'string' && new Date(value).toISOString() === CREATED_AT;
const s3 = new S3Client({ region: 'us-east-1', maxAttempts: 1 });

async function readPinned(spec) {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: spec.key,
    VersionId: spec.versionId, ExpectedBucketOwner: '193644343389' }));
  assert.equal(result.VersionId, spec.versionId, 'VERSION_MISMATCH');
  const bytes = await result.Body.transformToByteArray();
  assert.equal(sha256(bytes), spec.byteSha256, 'BYTE_HASH_MISMATCH');
  const artifact = JSON.parse(Buffer.from(bytes).toString('utf8'));
  assert.equal(artifact.masterSha256, spec.masterSha256, 'MASTER_HASH_MISMATCH');
  assert.equal(artifact.format, 'tracepoint-immutable-source-artifact/v1', 'FORMAT_MISMATCH');
  assert.equal(artifact.source.projectRef, 'reukdouvpshshvqnzsgw', 'SOURCE_PROJECT_MISMATCH');
  assert.equal(artifact.tables.length, 90, 'RELATION_CONTRACT_COUNT_MISMATCH');
  assert.equal(artifact.totalRelationalRows, spec.expectedRows, 'RELATIONAL_COUNT_MISMATCH');
  assert.equal(artifact.identities.count, 1, 'IDENTITY_COUNT_MISMATCH');
  assert.equal(artifact.memberships.count, 1, 'MEMBERSHIP_COUNT_MISMATCH');
  assert.equal(artifact.objects.count, 1, 'OBJECT_COUNT_MISMATCH');
  assert.equal(artifact.objects.totalBytes, 68, 'OBJECT_BYTES_MISMATCH');
  return artifact;
}

(async () => {
  const [before, after] = await Promise.all(ARTIFACTS.map(readPinned));
  assert.ok(Date.parse(after.source.fenceChangedAt) > Date.parse(before.source.fenceChangedAt), 'FENCE_RESTORE_TIMESTAMP_MISMATCH');
  assert.deepEqual(after.tables.map(t => t.name), before.tables.map(t => t.name), 'RELATION_ORDER_MISMATCH');
  const changedRelations = after.tables.filter((table, index) => {
    const old = before.tables[index];
    return old.rows !== table.rows || old.canonicalDataSha256 !== table.canonicalDataSha256;
  }).map(table => table.name).sort();
  assert.deepEqual(changedRelations, ['audit_events', 'fleet_vehicles'], 'UNRELATED_RELATION_CHANGED');
  assert.equal(before.identities.canonicalDataSha256, after.identities.canonicalDataSha256, 'IDENTITY_CHANGED');
  assert.equal(before.memberships.canonicalDataSha256, after.memberships.canonicalDataSha256, 'MEMBERSHIP_CHANGED');
  assert.equal(before.objects.manifestSha256, after.objects.manifestSha256, 'OBJECT_CHANGED');

  assert.equal(before.rows.fleet_vehicles.length, 0, 'BASELINE_FLEET_NOT_EMPTY');
  assert.equal(after.rows.fleet_vehicles.length, 1, 'FLEET_DELTA_NOT_ONE');
  const vehicle = after.rows.fleet_vehicles[0];
  assert.equal(vehicle.id, VEHICLE, 'VEHICLE_ID_MISMATCH');
  assert.equal(vehicle.department_id, DEPARTMENT, 'VEHICLE_TENANT_MISMATCH');
  assert.equal(vehicle.unit_number, UNIT, 'VEHICLE_UNIT_MISMATCH');
  assert.equal(vehicle.status, 'Retired', 'VEHICLE_STATUS_MISMATCH');
  assert.equal(vehicle.assignment_type, 'Pool', 'VEHICLE_ASSIGNMENT_MISMATCH');
  assert.equal(Number(vehicle.current_mileage), 0, 'VEHICLE_MILEAGE_MISMATCH');
  assert.equal(Number(vehicle.current_hours), 0, 'VEHICLE_HOURS_MISMATCH');
  assert.equal(Number(vehicle.open_issue_count), 0, 'VEHICLE_ISSUES_MISMATCH');
  assert.equal(vehicle.created_by_user_id, USER, 'VEHICLE_ACTOR_MISMATCH');
  assert.equal(vehicle.updated_by_user_id, USER, 'VEHICLE_UPDATER_MISMATCH');
  assert.ok(sameTime(vehicle.created_at) && sameTime(vehicle.updated_at) && sameTime(vehicle.retired_at), 'VEHICLE_TIMESTAMPS_MISMATCH');

  const oldAudit = before.rows.audit_events;
  const newAudit = after.rows.audit_events;
  assert.equal(newAudit.length, oldAudit.length + 1, 'AUDIT_DELTA_NOT_ONE');
  const oldById = new Map(oldAudit.map(row => [row.id, row]));
  assert.equal(oldById.size, oldAudit.length, 'DUPLICATE_BASELINE_AUDIT_ID');
  for (const row of newAudit) {
    const prior = oldById.get(row.id);
    if (prior) { assert.ok(same(prior, row), 'UNRELATED_AUDIT_CHANGED'); oldById.delete(row.id); }
  }
  assert.equal(oldById.size, 0, 'BASELINE_AUDIT_MISSING');
  const additions = newAudit.filter(row => !oldAudit.some(old => old.id === row.id));
  assert.equal(additions.length, 1, 'AUDIT_ADDITION_NOT_ONE');
  const audit = additions[0];
  assert.equal(audit.department_id, DEPARTMENT, 'AUDIT_TENANT_MISMATCH');
  assert.equal(audit.entity_type, 'fleet_vehicles', 'AUDIT_ENTITY_TYPE_MISMATCH');
  assert.equal(audit.entity_id, VEHICLE, 'AUDIT_ENTITY_ID_MISMATCH');
  assert.equal(audit.action, 'insert', 'AUDIT_ACTION_MISMATCH');
  assert.equal(audit.actor_user_id, USER, 'AUDIT_ACTOR_MISMATCH');
  assert.equal(audit.details?.source, 'database_trigger', 'AUDIT_SOURCE_MISMATCH');

  console.log(JSON.stringify({ status: 'SOURCE_REPLAY_EXACT_DELTA_PASS', baselineRows: 167,
    postReplayRows: 169, changedRelations, newFleetRows: 1, newAuditRows: 1,
    unchangedRelations: 88, identitiesUnchanged: true, membershipsUnchanged: true,
    objectsUnchanged: true, sourceRowPayloadsLogged: false }));
})().catch(error => {
  console.error(JSON.stringify({ status: 'FAILED', code: /^[A-Z_]+$/.test(String(error.message)) ? error.message : 'POST_REPLAY_COMPARE_FAILED' }));
  process.exitCode = 1;
}).finally(() => s3.destroy());
