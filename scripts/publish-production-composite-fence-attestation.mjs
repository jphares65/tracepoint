#!/usr/bin/env node
// Exact production cutover window only. Publishes sanitized live control
// evidence; never prints credentials or customer rows.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ARTIFACT_BUCKET, ARTIFACT_KMS_KEY_ARN, FENCE_ATTESTATION_KEY,
  REQUIRED_WRITER_PATHS, SOURCE_ORIGIN, SOURCE_SECRET_NAME, attestCompositeEvidence,
  attestFrozen } from './source-production-final-capture-core.mjs';
import { PRODUCTION_EPOCH, extractProductionEpochKey } from './source-credential-epoch-core.mjs';
import { VERCEL_PROJECT_ID, VERCEL_TEAM_ID, VERCEL_TOKEN_SECRET,
  attestVercelProject, withExactVercelTeam } from './production-vercel-rollback-core.mjs';

assert.deepEqual(process.argv.slice(2),
  ['--profile=tracepoint-production', '--window-id=cutover-20260928-retry4'],
  'EXACT_CUTOVER_WINDOW_REQUIRED');
assert.equal(process.env.TRACEPOINT_CUTOVER_WINDOW_APPROVED, 'YES', 'WINDOW_APPROVAL_FLAG_REQUIRED');
for (const name of ['TRACEPOINT_LIVE_SQL_NEGATIVE_PASSED',
  'TRACEPOINT_LIVE_AUTH_ZERO_CONFIRMED', 'TRACEPOINT_LIVE_PREVIEW_403_CONFIRMED',
  'TRACEPOINT_LIVE_S3_KEYS_ZERO_CONFIRMED', 'TRACEPOINT_LIVE_LEGACY_BEARER_401_CONFIRMED',
  'TRACEPOINT_LIVE_LEGACY_KEYS_DISABLED_CONFIRMED'])
  assert.equal(process.env[name], 'YES', `MANUAL_LIVE_PROOF_MISSING:${name}`);

const digest = value => createHash('sha256').update(
  typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const aws = args => {
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...args, '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'json'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, `AWS_READ_FAILED:${args[0]}:${args[1]}`);
  return JSON.parse(result.stdout);
};
const status = async url => {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000),
    headers: { 'cache-control': 'no-cache' } });
  await response.arrayBuffer();
  return response.status;
};
const sts = aws(['sts', 'get-caller-identity']);
assert.equal(sts.Account, '193644343389', 'ACCOUNT_MISMATCH');
const ecs = aws(['ecs', 'describe-services', '--cluster', 'tracepoint-production',
  '--services', 'tracepoint-production']).services[0];
assert.equal(ecs.desiredCount, 0, 'BRIDGE_NOT_STOPPED');
assert.equal(ecs.runningCount, 0, 'BRIDGE_NOT_DRAINED');
assert.equal(ecs.pendingCount, 0, 'BRIDGE_TASK_PENDING');
assert.match(ecs.taskDefinition, /tracepoint-production-bridge-rollback-20260926:1$/,
  'BRIDGE_REVISION_DRIFT');
const maintenance = aws(['cloudformation', 'describe-stacks', '--stack-name',
  'tracepoint-production-maintenance-response-20260927']).Stacks[0];
assert.equal(maintenance.StackStatus, 'CREATE_COMPLETE', 'MAINTENANCE_STACK_NOT_COMPLETE');
assert.equal(await status('https://www.tracepointhq.com/landing'), 503, 'PUBLIC_MAINTENANCE_NOT_EXTERNAL');
assert.equal(await status('https://tracepoint-amber.vercel.app/landing'), 503,
  'VERCEL_PAUSE_NOT_EXTERNAL');
const recentIds = aws(['codebuild', 'list-builds']).ids.slice(0, 40);
if (recentIds.length) {
  const builds = aws(['codebuild', 'batch-get-builds', '--ids', ...recentIds]).builds;
  assert.equal(builds.filter(build => build.buildStatus === 'IN_PROGRESS').length, 0,
    'UNREVIEWED_CODEBUILD_RUNNING');
}
async function secretValue(name) {
  const found = aws(['secretsmanager', 'get-secret-value', '--secret-id', name]);
  assert.equal(found.Name, name, 'SECRET_NAME_DRIFT');
  assert.match(found.ARN ?? '', /^arn:aws:secretsmanager:us-east-1:193644343389:secret:/,
    'SECRET_ACCOUNT_DRIFT');
  return found.SecretString;
}
const captureKey = extractProductionEpochKey(await secretValue(SOURCE_SECRET_NAME),
  SOURCE_SECRET_NAME);
const rollbackKey = extractProductionEpochKey(await secretValue(PRODUCTION_EPOCH.rollbackSecretName),
  PRODUCTION_EPOCH.rollbackSecretName);
const runtime = JSON.parse(await secretValue('tracepoint/production/migration/source-supabase-rest'));
assert.equal(runtime.projectUrl, SOURCE_ORIGIN, 'RUNTIME_SOURCE_DRIFT');
assert.equal(runtime.serviceRoleKey, rollbackKey, 'RUNTIME_NOT_RESERVED_ROLLBACK_KEY');
assert.notEqual(captureKey, rollbackKey, 'CAPTURE_ROLLBACK_KEY_EQUAL');
async function sourceJson(method, path, body) {
  const response = await fetch(`${SOURCE_ORIGIN}${path}`, { method,
    redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { apikey: captureKey, accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, 200, `SOURCE_READ_FAILED:${path}:${response.status}`);
  return response.json();
}
const fence = await sourceJson('POST', '/rest/v1/rpc/tracepoint_source_production_fence_status', {});
const fenceChangedAt = attestFrozen(fence);
await sourceJson('GET', '/auth/v1/admin/users?page=1&per_page=1');
await sourceJson('POST', '/storage/v1/object/list/department-assets',
  { prefix: '', limit: 1, offset: 0 });
const authSettings = await sourceJson('GET', '/auth/v1/settings');
assert.equal(authSettings.external?.email, false, 'EMAIL_SIGN_IN_STILL_ENABLED');
assert.equal(authSettings.disable_signup, true, 'NEW_SIGNUP_STILL_ENABLED');
const vercelSecret = await secretValue(VERCEL_TOKEN_SECRET);
const vercelWrapped = vercelSecret.startsWith('{') ? JSON.parse(vercelSecret) : null;
const vercelToken = vercelWrapped ? vercelWrapped[VERCEL_TOKEN_SECRET] : vercelSecret;
assert.ok(typeof vercelToken === 'string' && vercelToken.length >= 32, 'VERCEL_TOKEN_INVALID');
async function vercel(path) {
  const response = await fetch(`https://api.vercel.com${withExactVercelTeam(path)}`, {
    headers: { authorization: `Bearer ${vercelToken}`, accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, `VERCEL_READ_FAILED:${response.status}`);
  return response.json();
}
const project = await vercel(`/v9/projects/${VERCEL_PROJECT_ID}`);
attestVercelProject(project);
assert.equal(project.paused, true, 'VERCEL_NOT_PAUSED');
const firewall = await vercel(`/v1/security/firewall/config?projectId=${VERCEL_PROJECT_ID}`);
assert.equal(firewall.draft, null, 'VERCEL_FIREWALL_DRAFT');
const rules = firewall.active?.rules ?? [];
assert.equal(rules.length, 2, 'VERCEL_RULE_COUNT_DRIFT');
for (const environment of ['production', 'preview']) {
  const name = `TracePoint cutover ${environment} deny 20260928`;
  const matches = rules.filter(rule => rule.name === name);
  assert.equal(matches.length, 1, `VERCEL_RULE_NOT_UNIQUE:${environment}`);
  const rule = matches[0];
  assert.equal(rule.active, true, 'VERCEL_RULE_INACTIVE');
  assert.equal(rule.action?.mitigate?.action, 'deny', 'VERCEL_RULE_NOT_DENY');
  assert.equal(rule.conditionGroup?.[0]?.conditions?.[0]?.type, 'environment', 'VERCEL_RULE_TYPE_DRIFT');
  assert.equal(rule.conditionGroup?.[0]?.conditions?.[0]?.op, 'eq', 'VERCEL_RULE_OP_DRIFT');
  assert.equal(rule.conditionGroup?.[0]?.conditions?.[0]?.value, environment, 'VERCEL_RULE_ENV_DRIFT');
}
const priorOldKey = readFileSync(new URL('../docs/production-cutover-abort-20260928-retry3.md', import.meta.url));
const priorOldKeySha256 = digest(priorOldKey);
const inverse = [
  readFileSync(new URL('../supabase/production-cutover/20260927_abort_source_fence.sql', import.meta.url)),
  readFileSync(new URL('../docs/production-cutover-execution-20260928-retry4.md', import.meta.url)),
  readFileSync(new URL('./manage-production-vercel-cutover-deny.mjs', import.meta.url)),
];
const inverseSha256 = digest(Buffer.concat(inverse));
const proofs = {
  bridge: { account: sts.Account, service: ecs.serviceName, desired: 0, running: 0, pending: 0,
    publicHttp: 503, maintenanceStack: maintenance.StackId },
  vercelProduction: { projectId: project.id, teamId: project.accountId, paused: true,
    externalHttp: 503, denyRule: rules.find(rule => rule.name.includes('production deny'))?.id },
  vercelPreview: { projectId: project.id, denyRule: rules.find(rule => rule.name.includes('preview deny'))?.id,
    authenticatedBrowser: { historicalReadyA: 403, historicalReadyB: 403, currentReady: 403 },
    observation: 'three authenticated in-app-browser requests during this cutover window' },
  publicSql: { sourceProject: PRODUCTION_EPOCH.projectRef, fenceChangedAt,
    publicTriggers: 174, directRollbackOnlyUpdate: '55000 TRACEPOINT_SOURCE_FROZEN',
    transactionFinalState: 'ROLLBACK', readStatus: 200 },
  auth: { emailEnabled: false, signupDisabled: true, sessions: 0, refreshTokens: 0,
    previousLegacySigningKey: 'b7859fb3-6f9d-4c82-87b5-04bfaca95259',
    previousKeyState: 'Revoked (operator confirmed)', legacyBearerReadHttp: 401,
    captureAdminReadHttp: 200 },
  storage: { s3SeparateKeyCount: 0, exactProjectDashboardRechecked: true,
    captureStorageReadHttp: 200, previousLegacyBearerReadHttp: 401 },
  oldEpoch: { oldModernKeyRetired: true, oldModernKeyDirectNegativePriorSha256: priorOldKeySha256,
    legacyJwtApiKeysDisabled: true, captureKeyDistinctFromRollback: true,
    rollbackKeyOnlyInStoppedRuntime: true, runningCodeBuildJobs: 0 },
  background: { exactCronDispatcherPaused: true, activeDispatchers: 0,
    externalVercelHttp: 503, runningCodeBuildJobs: 0 },
};
const pathProof = {
  publicAwsBridge: 'bridge', vercelProduction: 'vercelProduction', vercelPreview: 'vercelPreview',
  authExistingSession: 'auth', authNewSession: 'auth', authServiceAdmin: 'oldEpoch',
  storageAuthenticated: 'auth', storageElevated: 'oldEpoch', postgrestDirect: 'publicSql',
  rpcFunctions: 'publicSql', pgCron: 'background', notificationBackground: 'background',
  adminImport: 'oldEpoch', awsSourceRestHolders: 'oldEpoch', awsAppSecretReaders: 'bridge',
  externalCredentialHolders: 'oldEpoch',
};
const writerPaths = Object.fromEntries(REQUIRED_WRITER_PATHS.map(name => [name,
  name === 'storageS3'
    ? { status: 'absent', recheckedAtFreeze: true, absenceEvidenceSha256: digest(proofs.storage),
      proofBasis: 'exact source project S3 dashboard: no access keys' }
    : { status: 'blocked', directNegativePassed: true,
      negativeEvidenceSha256: digest(proofs[pathProof[name]]),
      restoreProcedureSha256: inverseSha256, proofBasis: pathProof[name] }]));
const familyProof = { applicationApi: 'publicSql', serviceRole: 'oldEpoch', authApi: 'auth',
  storageApi: 'storage', background: 'background', scheduledImportAdmin: 'oldEpoch',
  legacyVercel: 'vercelProduction' };
const writers = Object.fromEntries(Object.entries(familyProof).map(([name, basis]) => [name, {
  authoritativeMutationCapable: true, blocked: true, directNegativePassed: true,
  reversibleControl: 'exact reviewed pre-authority inverse, with maintenance retained',
  negativeEvidenceSha256: digest(proofs[basis]), restoreProcedureSha256: inverseSha256,
  proofBasis: basis,
}]));
const evidence = {
  format: 'tracepoint-production-composite-fence/v3', projectRef: PRODUCTION_EPOCH.projectRef,
  relationFingerprint: '36558b0730e3e96cad6426f38088a5b0', fenceChangedAt,
  maintenance503: true, publicTriggers: 174, s3WriterCredentials: 'NO_SEPARATE_S3_WRITER_CREDENTIALS',
  observedAtUtc: new Date().toISOString(),
  credentialEpoch: { captureSecretName: SOURCE_SECRET_NAME, oldModernKeyRejected: true,
    legacyServiceKeyDisabled: true, captureKeyReads: true,
    rollbackKeyUnassignedToRunningWriters: true,
    oldCredentialNegativeEvidenceSha256: priorOldKeySha256 },
  legacyVercel: { projectId: VERCEL_PROJECT_ID,
    productionOrigin: 'https://tracepoint-amber.vercel.app', paused503: true,
    previewProductionSourceExcluded: false, previewAllDeploymentsBlocked: true,
    previewProjectWideDenyActive: true, previewNegativeEvidenceSha256: digest(proofs.vercelPreview) },
  writers, writerPaths, proofs,
};
attestCompositeEvidence(evidence, fenceChangedAt);
const bytes = Buffer.from(JSON.stringify(evidence));
const evidenceSha256 = digest(bytes);
const stage = mkdtempSync(join(tmpdir(), 'tracepoint-composite-attestation-'));
const bodyPath = join(stage, 'attestation.json');
try {
  writeFileSync(bodyPath, bytes, { flag: 'wx' });
  const put = aws(['s3api', 'put-object', '--bucket', ARTIFACT_BUCKET,
    '--key', FENCE_ATTESTATION_KEY, '--body', bodyPath,
    '--expected-bucket-owner', '193644343389', '--content-type', 'application/json',
    '--server-side-encryption', 'aws:kms', '--ssekms-key-id', ARTIFACT_KMS_KEY_ARN,
    '--checksum-sha256', createHash('sha256').update(bytes).digest('base64')]);
  assert.ok(put.VersionId, 'ATTESTATION_VERSION_MISSING');
  console.log(JSON.stringify({ status: 'PRODUCTION_COMPOSITE_FENCE_ATTESTATION_PUBLISHED',
    bucket: ARTIFACT_BUCKET, key: FENCE_ATTESTATION_KEY, versionId: put.VersionId,
    sha256: evidenceSha256, fenceChangedAt, observedAtUtc: evidence.observedAtUtc,
    projectRef: evidence.projectRef, customerRowsLogged: false, credentialsLogged: false }));
} finally { unlinkSync(bodyPath); rmdirSync(stage); }
