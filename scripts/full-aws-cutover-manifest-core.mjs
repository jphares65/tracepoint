import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const RUN_ID = /^[a-z0-9][a-z0-9._-]{7,127}$/;
const PHASES = new Set(['prepared', 'source-frozen', 'data-migrated', 'traffic-switched']);
const FORBIDDEN_ACCOUNTS = new Set(['111111111111', '265544358665', '559054714699']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function requireExactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonical(actual) !== canonical(expected)) fail(`${label} fields do not match the reviewed schema`);
}

function requireSha(value, label) {
  if (!SHA256.test(value ?? '')) fail(`${label} must be a lowercase SHA-256`);
}

function validateEvidence(input) {
  requireExactKeys(input, [
    'account', 'authorizationReference', 'awsAcceptedWrites', 'awsImageDigest',
    'awsTaskDefinitionArn', 'bridgeImageDigest', 'bridgeTaskDefinitionArn', 'cognito',
    'database', 'databaseSecretVersionArn', 'dnsSnapshotSha256', 'environment',
    'gates', 'hostname', 'phase', 'region', 'rdsRecoveryPointArn', 'service',
    'sourceManifestSha256', 'storageManifestSha256', 'targetManifestSha256',
    'applicationSecretVersionArn', 'commit',
  ], 'Cutover evidence');
  if (!/^\d{12}$/.test(input.account ?? '') || FORBIDDEN_ACCOUNTS.has(input.account)) fail('A reviewed dedicated production account is required');
  if (input.environment !== 'production' || input.region !== 'us-east-1') fail('Cutover evidence must target production in us-east-1');
  if (input.hostname !== 'tracepointhq.com') fail('Canonical production hostname must be reviewed');
  if (!/^[0-9a-f]{40}$/.test(input.commit ?? '')) fail('A full immutable source commit is required');
  if (!IMAGE_DIGEST.test(input.awsImageDigest ?? '') || !IMAGE_DIGEST.test(input.bridgeImageDigest ?? '')) fail('Both immutable image digests are required');
  if (input.awsImageDigest === input.bridgeImageDigest) fail('Bridge and AWS-native images must be distinct');
  if (!PHASES.has(input.phase)) fail('Unknown cutover phase');
  if (typeof input.awsAcceptedWrites !== 'boolean') fail('AWS write state must be explicit');
  if (input.phase === 'prepared' && input.awsAcceptedWrites) fail('A prepared cutover cannot already contain AWS-native writes');
  if (!/^[A-Z0-9][A-Z0-9._:/-]{7,127}$/.test(input.authorizationReference ?? '')) fail('A specific owner authorization reference is required');
  for (const [name, value] of [
    ['source manifest', input.sourceManifestSha256], ['target manifest', input.targetManifestSha256],
    ['storage manifest', input.storageManifestSha256], ['DNS snapshot', input.dnsSnapshotSha256],
  ]) requireSha(value, name);

  const ecsPrefix = `arn:aws:ecs:us-east-1:${input.account}:task-definition/`;
  if (!input.awsTaskDefinitionArn?.startsWith(ecsPrefix) || !/:\d+$/.test(input.awsTaskDefinitionArn)) fail('AWS-native task definition ARN is invalid');
  if (!input.bridgeTaskDefinitionArn?.startsWith(ecsPrefix) || !/:\d+$/.test(input.bridgeTaskDefinitionArn)) fail('Bridge task definition ARN is invalid');
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(input.service?.cluster ?? '') || !/^[a-zA-Z0-9_-]{1,255}$/.test(input.service?.name ?? '')) fail('ECS service coordinates are invalid');

  const secretPrefix = `arn:aws:secretsmanager:us-east-1:${input.account}:secret:`;
  for (const arn of [input.applicationSecretVersionArn, input.databaseSecretVersionArn]) {
    if (!arn?.startsWith(secretPrefix) || !arn.includes(':AWSCURRENT')) fail('Pinned AWSCURRENT secret version ARN is required');
  }
  if (!input.rdsRecoveryPointArn?.startsWith(`arn:aws:rds:us-east-1:${input.account}:snapshot:`)) fail('A production RDS snapshot ARN is required');

  requireExactKeys(input.database, ['migrationLedgerSha256', 'migrationRunId', 'sourceSnapshotAt', 'sourceSnapshotLsn'], 'Database evidence');
  requireSha(input.database.migrationLedgerSha256, 'database migration ledger');
  if (!RUN_ID.test(input.database.migrationRunId ?? '')) fail('Database migration run ID is invalid');
  if (!/^[0-9A-F]+\/[0-9A-F]+$/.test(input.database.sourceSnapshotLsn ?? '')) fail('Source PostgreSQL LSN is invalid');
  if (!Number.isFinite(Date.parse(input.database.sourceSnapshotAt ?? ''))) fail('Source snapshot timestamp is invalid');

  requireExactKeys(input.cognito, ['appClientId', 'reconciliationSha256', 'userPoolId'], 'Cognito evidence');
  if (!/^us-east-1_[A-Za-z0-9]+$/.test(input.cognito.userPoolId ?? '') || !/^[a-z0-9]{26}$/.test(input.cognito.appClientId ?? '')) fail('Cognito identifiers are invalid');
  requireSha(input.cognito.reconciliationSha256, 'Cognito reconciliation');

  const requiredGates = [
    'accountIdentityVerified', 'alarmsDelivered', 'applicationHealthPassed', 'authorizationRecorded',
    'backupRestorePassed', 'costApproved', 'databaseReconciled', 'dnsSnapshotCaptured',
    'identityReconciled', 'imageScanPassed', 'rollbackReviewed', 'secretsValidated',
    'storageReconciled', 'tenantIsolationPassed',
  ];
  requireExactKeys(input.gates, requiredGates, 'Cutover gates');
  for (const gate of requiredGates) if (input.gates[gate] !== true) fail(`Unmet cutover gate: ${gate}`);
}

export function createCutoverManifest(evidence, generatedAt = new Date().toISOString()) {
  validateEvidence(evidence);
  if (!Number.isFinite(Date.parse(generatedAt))) fail('Manifest generation timestamp is invalid');
  const payload = { format: 1, generatedAt, evidence };
  return { ...payload, contentSha256: sha256(canonical(payload)) };
}

export function validateCutoverManifest(manifest) {
  requireExactKeys(manifest, ['contentSha256', 'evidence', 'format', 'generatedAt'], 'Cutover manifest');
  if (manifest.format !== 1) fail('Unsupported cutover manifest format');
  const rebuilt = createCutoverManifest(manifest.evidence, manifest.generatedAt);
  if (rebuilt.contentSha256 !== manifest.contentSha256) fail('Cutover manifest integrity check failed');
  return manifest;
}

export function rollbackDecision(manifest) {
  const validated = validateCutoverManifest(manifest);
  if (validated.evidence.awsAcceptedWrites) {
    return {
      automaticBridgeRestoreAllowed: false,
      action: 'freeze-and-reconcile',
      reason: 'AWS-native writes exist; automated bridge restoration could lose or overwrite accepted data.',
    };
  }
  return {
    automaticBridgeRestoreAllowed: true,
    action: 'restore-immutable-bridge-task',
    taskDefinitionArn: validated.evidence.bridgeTaskDefinitionArn,
  };
}
