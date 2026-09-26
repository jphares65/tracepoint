// Review-only. Never deploys, freezes, changes DNS, or authorizes the public switch.
const exact = Object.freeze({
  account: '193644343389',
  region: 'us-east-1',
  hostname: 'tracepointhq.com',
  imageDigest: 'sha256:cf19c9887eee2c79eac2abf2e0337f5a2bb95beefc5e20d0f1ffc0453a2f7b46',
  sourceCommit: '2a92bccd04060785c95b18fdc6bfa90505c26c7a',
  databaseId: 'tracepoint-production-final-cutover-20260926',
  databaseResourceId: 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE',
  databaseHost: 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com',
  databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/final/database-runtime-20260926-yg23sb',
  bucket: 'tracepoint-production-private-193644343389',
  storageKeyArn: 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55',
  feedbackWorkerSecretArn: 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/final/database-runtime-20260926-yg23sb',
  feedbackTopicArn: 'arn:aws:sns:us-east-1:193644343389:tracepoint-production-ses-feedback',
  taskRoleArn: 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-task-v1',
  permissionsBoundaryArn: 'arn:aws:iam::193644343389:policy/TracePointProductionNativeProofBoundary-v1',
  permissionsBoundaryVersionId: 'v1',
  poolId: 'us-east-1_diFmWDMe9',
  clientId: '9tfp383dgjuvanhnh94bstafr',
});

export const requiredProductionCutoverGates = Object.freeze([
  'sourceWriterInventoryPassed', 'frozenSourceCapturePassed', 'finalRdsImportReconciled',
  'finalObjectsReconciled', 'cognitoIdentitiesReconciled', 'representativeAuthRecoveryPassed',
  'applicationSesDeliveryAndFeedbackPassed', 'montvilleAcceptancePassed', 'readingtonAcceptancePassed',
  'bidirectionalHttpTenantNegativesPassed', 'isolatedAuthoritySwitchRehearsed',
  'awsOnlyWriteRollbackRehearsed', 'backupRestorePassed', 'alertOwnershipConfirmed',
  'managedRuntimeChangeReviewed', 'rollbackTaskPinned', 'agencyApprovalRecorded',
]);

export function validateAwsNativeProductionReview(input) {
  const fail = message => { throw new Error(message); };
  for (const key of ['account', 'region', 'hostname', 'imageDigest', 'sourceCommit']) {
    if (input[key] !== exact[key]) fail(`Exact AWS-native production ${key} is required`);
  }
  if (input.roleArn !== `arn:aws:iam::${exact.account}:role/TracePointMigrationProduction` ||
      input.taskRoleArn !== exact.taskRoleArn ||
      input.permissionsBoundaryArn !== exact.permissionsBoundaryArn ||
      input.permissionsBoundaryVersionId !== exact.permissionsBoundaryVersionId ||
      input.imageScanStatus !== 'COMPLETE' || input.imageScanFindings !== 0 ||
      !/^sha256:[0-9a-f]{64}$/.test(input.rollbackImageDigest) ||
      input.rollbackImageDigest === input.imageDigest) fail('Reviewed role, clean image, and distinct rollback image required');
  const db = input.database ?? {};
  if (db.identifier !== exact.databaseId || db.resourceId !== exact.databaseResourceId ||
      db.host !== exact.databaseHost || db.secretArn !== exact.databaseSecretArn ||
      db.name !== 'tracepoint' || db.tlsVerified !== true || db.private !== true ||
      db.encrypted !== true || db.deletionProtected !== true || db.migrationLineage !== 99) {
    fail('Final database identity, secret, TLS, or schema lineage mismatch');
  }
  const providers = input.providers ?? {};
  for (const [key, expected] of Object.entries({
    runtime: 'aws-native', data: 'postgres', auth: 'cognito', storage: 's3',
    email: 'ses', notificationMode: 'normal',
  })) if (providers[key] !== expected) fail(`AWS-native provider mismatch: ${key}`);
  if (providers.supabaseApplicationAccess !== false || providers.brevoApplicationAccess !== false) {
    fail('Legacy application provider access remains enabled');
  }
  const storage = input.storage ?? {};
  if (storage.bucket !== exact.bucket || storage.expectedOwner !== exact.account ||
      storage.kmsKeyArn !== exact.storageKeyArn ||
      storage.private !== true || storage.kmsEncrypted !== true || storage.versioned !== true) {
    fail('Production object storage boundary mismatch');
  }
  const auth = input.cognito ?? {};
  if (auth.poolId !== exact.poolId || auth.clientId !== exact.clientId ||
      auth.issuer !== `https://cognito-idp.us-east-1.amazonaws.com/${exact.poolId}` ||
      auth.callbackUrl !== 'https://tracepointhq.com/api/auth/cognito/callback' ||
      auth.logoutUrl !== 'https://tracepointhq.com/login' ||
      auth.pkceS256 !== true || auth.mfaRequired !== true ||
      auth.accessTokenMinutes !== 5 || auth.idTokenMinutes !== 5) {
    fail('Exact production Cognito authority mismatch');
  }
  const ses = input.ses ?? {};
  if (ses.fromAddress !== 'notifications@tracepointhq.com' ||
      ses.configurationSet !== 'tracepoint-production' ||
      ses.feedbackTopicArn !== exact.feedbackTopicArn ||
      ses.feedbackWorkerSecretArn !== exact.feedbackWorkerSecretArn ||
      ses.feedbackWorkerAuthority !== 'final' ||
      ses.feedbackWorkerTlsVerified !== true ||
      ses.feedbackWorkerSingleWriter !== true ||
      ses.feedbackToFinalDatabase !== true || ses.customerDeliveryApproved !== true) {
    fail('Production SES sender or feedback boundary mismatch');
  }
  if (input.routing?.publicAuthorityChanged !== false || input.routing?.publicDnsChanged !== false ||
      input.routing?.publicEcsChanged !== false) fail('Review must leave public authority unchanged');
  for (const gate of requiredProductionCutoverGates) {
    if (input.gates?.[gate] !== true) fail(`Unmet production cutover gate: ${gate}`);
  }
  return { readyForGoNoGoReview: true, executionAuthorized: false,
    account: exact.account, hostname: exact.hostname, sourceCommit: exact.sourceCommit };
}
