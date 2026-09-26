import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredProductionCutoverGates, validateAwsNativeProductionReview } from './validate-aws-native-production-review.mjs';

const valid = () => ({
  account: '193644343389', region: 'us-east-1', hostname: 'tracepointhq.com',
  roleArn: 'arn:aws:iam::193644343389:role/TracePointMigrationProduction',
  taskRoleArn: 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-task-v1',
  permissionsBoundaryArn: 'arn:aws:iam::193644343389:policy/TracePointProductionNativeProofBoundary-v1',
  permissionsBoundaryVersionId: 'v1',
  imageDigest: 'sha256:cf19c9887eee2c79eac2abf2e0337f5a2bb95beefc5e20d0f1ffc0453a2f7b46',
  sourceCommit: '2a92bccd04060785c95b18fdc6bfa90505c26c7a',
  imageScanStatus: 'COMPLETE', imageScanFindings: 0, rollbackImageDigest: `sha256:${'a'.repeat(64)}`,
  database: { identifier: 'tracepoint-production-final-cutover-20260926', resourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE',
    host: 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
    secretArn: 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/final/database-runtime-20260926-yg23sb',
    name: 'tracepoint', tlsVerified: true, private: true, encrypted: true, deletionProtected: true, migrationLineage: 99 },
  providers: { runtime: 'aws-native', data: 'postgres', auth: 'cognito', storage: 's3', email: 'ses',
    notificationMode: 'normal', supabaseApplicationAccess: false, brevoApplicationAccess: false },
  storage: { bucket: 'tracepoint-production-private-193644343389', expectedOwner: '193644343389',
    private: true, kmsEncrypted: true, versioned: true },
  cognito: { poolId: 'us-east-1_diFmWDMe9', clientId: '9tfp383dgjuvanhnh94bstafr',
    issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_diFmWDMe9',
    callbackUrl: 'https://tracepointhq.com/api/auth/cognito/callback', logoutUrl: 'https://tracepointhq.com/login',
    pkceS256: true, mfaRequired: true, accessTokenMinutes: 5, idTokenMinutes: 5 },
  ses: { fromAddress: 'notifications@tracepointhq.com', configurationSet: 'tracepoint-production',
    feedbackToFinalDatabase: true, customerDeliveryApproved: true },
  routing: { publicAuthorityChanged: false, publicDnsChanged: false, publicEcsChanged: false },
  gates: Object.fromEntries(requiredProductionCutoverGates.map(gate => [gate, true])),
});

test('review-only validator requires every exact AWS-native authority boundary', () => {
  assert.deepEqual(validateAwsNativeProductionReview(valid()), {
    readyForGoNoGoReview: true, executionAuthorized: false,
    account: '193644343389', hostname: 'tracepointhq.com',
    sourceCommit: '2a92bccd04060785c95b18fdc6bfa90505c26c7a',
  });
  for (const change of [
    { imageScanFindings: 1 }, { imageDigest: `sha256:${'b'.repeat(64)}` },
    { taskRoleArn: 'arn:aws:iam::193644343389:role/tracepoint-production-ecs-task' },
    { permissionsBoundaryArn: 'arn:aws:iam::193644343389:policy/TracePointProductionBoundary' },
    { permissionsBoundaryVersionId: 'v2' },
    { providers: { ...valid().providers, supabaseApplicationAccess: true } },
    { database: { ...valid().database, resourceId: 'db-WRONG' } },
    { cognito: { ...valid().cognito, poolId: 'us-east-1_wZwXHpznS' } },
    { routing: { ...valid().routing, publicDnsChanged: true } },
    { gates: { ...valid().gates, bidirectionalHttpTenantNegativesPassed: false } },
  ]) assert.throws(() => validateAwsNativeProductionReview({ ...valid(), ...change }));
});
