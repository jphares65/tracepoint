import test from 'node:test';
import assert from 'node:assert/strict';
import { createCutoverManifest, rollbackDecision, validateCutoverManifest } from './full-aws-cutover-manifest-core.mjs';

const hash = character => character.repeat(64);
const gates = Object.fromEntries([
  'accountIdentityVerified', 'alarmsDelivered', 'applicationHealthPassed', 'authorizationRecorded',
  'backupRestorePassed', 'costApproved', 'databaseReconciled', 'dnsSnapshotCaptured',
  'identityReconciled', 'imageScanPassed', 'rollbackReviewed', 'secretsValidated',
  'storageReconciled', 'tenantIsolationPassed',
].map(key => [key, true]));
const evidence = {
  account: '222222222222', authorizationReference: 'OWNER-2026-09-11', awsAcceptedWrites: false,
  awsImageDigest: `sha256:${hash('a')}`, awsTaskDefinitionArn: 'arn:aws:ecs:us-east-1:222222222222:task-definition/tracepoint-production:42',
  bridgeImageDigest: `sha256:${hash('b')}`, bridgeTaskDefinitionArn: 'arn:aws:ecs:us-east-1:222222222222:task-definition/tracepoint-production:41',
  cognito: { appClientId: 'a'.repeat(26), reconciliationSha256: hash('c'), userPoolId: 'us-east-1_AbCdEf123' },
  database: { migrationLedgerSha256: hash('d'), migrationRunId: 'migration-20260911', sourceSnapshotAt: '2026-09-11T16:00:00.000Z', sourceSnapshotLsn: '16/B374D848', topology: 'rds-multi-az' },
  databaseSecret: { arn: 'arn:aws:secretsmanager:us-east-1:222222222222:secret:tracepoint/database-abc123', versionId: 'd'.repeat(32), versionStage: 'AWSCURRENT' },
  dnsSnapshotSha256: hash('e'), environment: 'production', gates, hostname: 'tracepointhq.com', phase: 'prepared', region: 'us-east-1',
  rdsRecoveryPointArn: 'arn:aws:rds:us-east-1:222222222222:snapshot:tracepoint-pre-cutover',
  service: { cluster: 'tracepoint-production', name: 'tracepoint-production' }, sourceManifestSha256: hash('f'),
  storageManifestSha256: hash('1'), targetManifestSha256: hash('2'),
  awsApplicationSecret: { arn: 'arn:aws:secretsmanager:us-east-1:222222222222:secret:tracepoint/application/aws-native-abc123', versionId: 'a'.repeat(32), versionStage: 'AWSCURRENT' },
  bridgeApplicationSecret: { arn: 'arn:aws:secretsmanager:us-east-1:222222222222:secret:tracepoint/application-abc123', versionId: 'b'.repeat(32), versionStage: 'AWSCURRENT' },
  commit: '3'.repeat(40),
};

test('creates an integrity-pinned review manifest and permits only pre-write bridge rollback', () => {
  const manifest = createCutoverManifest(evidence, '2026-09-11T17:00:00.000Z');
  assert.equal(validateCutoverManifest(manifest), manifest);
  assert.deepEqual(rollbackDecision(manifest), {
    automaticBridgeRestoreAllowed: true,
    action: 'restore-immutable-bridge-task',
    taskDefinitionArn: evidence.bridgeTaskDefinitionArn,
    bridgeApplicationSecret: evidence.bridgeApplicationSecret,
  });
});

test('hard-stops automatic rollback after AWS-native writes', () => {
  const manifest = createCutoverManifest({ ...evidence, phase: 'traffic-switched', awsAcceptedWrites: true });
  const decision = rollbackDecision(manifest);
  assert.equal(decision.automaticBridgeRestoreAllowed, false);
  assert.equal(decision.action, 'freeze-and-reconcile');
});

test('rejects mutation, missing gates, staging accounts, and unknown evidence', () => {
  const manifest = createCutoverManifest(evidence);
  assert.throws(() => validateCutoverManifest({ ...manifest, generatedAt: '2026-09-12T00:00:00.000Z' }), /integrity/);
  assert.throws(() => createCutoverManifest({ ...evidence, account: '559054714699' }), /dedicated production/);
  assert.throws(() => createCutoverManifest({ ...evidence, gates: { ...gates, storageReconciled: false } }), /storageReconciled/);
  assert.throws(() => createCutoverManifest({ ...evidence, unexpected: true }), /reviewed schema/);
  const aurora = { ...evidence, database: { ...evidence.database, topology: 'aurora' }, rdsRecoveryPointArn: 'arn:aws:rds:us-east-1:222222222222:cluster-snapshot:tracepoint-pre-cutover' };
  assert.doesNotThrow(() => createCutoverManifest(aurora));
});
