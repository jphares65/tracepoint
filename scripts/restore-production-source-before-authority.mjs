#!/usr/bin/env node
// Exact-source pre-authority abort credential distribution. --check is read-only.
// --apply is permitted only after maintenance, the SQL fence, source-writer
// drain and old-key rejection. It does not itself unfence or reopen traffic.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GetSecretValueCommand, PutSecretValueCommand,
  SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { PRODUCTION_EPOCH, extractProductionEpochKey, rejectedCredential }
  from './source-credential-epoch-core.mjs';
import { PRODUCTION_APPLICATION_SECRET, PRODUCTION_MIGRATION_REST_SECRET,
  PRODUCTION_ROLLBACK_SECRET, replaceBridgeElevatedKey,
  replaceMigrationRestKey } from './production-credential-rollback-core.mjs';
import { VERCEL_PROJECT_ID, VERCEL_TOKEN_SECRET, BASELINE_DEPLOYMENT_UID,
  BASELINE_GIT_SHA, PRODUCTION_SECRET_ENV_ID, attestVercelProject,
  attestVercelVariables, attestVercelDeployment, buildVercelSourceAbortRequests,
  withExactVercelTeam } from './production-vercel-rollback-core.mjs';

const args = process.argv.slice(2);
const check = JSON.stringify(args) === '["--profile=tracepoint-production","--check"]';
const apply = args.length === 3 && args[0] === '--profile=tracepoint-production' &&
  args[1] === '--apply' && /^--window-id=[A-Za-z0-9-]{8,64}$/.test(args[2]);
assert.ok(check || apply, 'EXACT_CHECK_OR_APPLY_ARGUMENTS_REQUIRED');
if (apply) assert.equal(process.env.TRACEPOINT_CUTOVER_WINDOW_APPROVED, 'YES',
  'CUTOVER_WINDOW_FLAG_REQUIRED');
process.env.AWS_PROFILE = 'tracepoint-production';
process.env.AWS_SDK_LOAD_CONFIG = '1';
const secrets = new SecretsManagerClient({ region: 'us-east-1', maxAttempts: 1 });
const BASELINE_TASK = 'arn:aws:ecs:us-east-1:193644343389:task-definition/tracepointproductionruntimeServiceTaskDefA64ABA6A:4';
const RESTORE_TASK = 'arn:aws:ecs:us-east-1:193644343389:task-definition/tracepoint-production-bridge-rollback-20260926:1';
const RESTORE_IMAGE = '193644343389.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@sha256:e7f6cf81fd748b60450b2e4c6ee07b53dd8fbceaf5460a4e9973bd4c2534d9ce';
const CLUSTER = 'tracepoint-production';
const SERVICE = 'tracepoint-production';

function aws(parts) {
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...parts, '--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'json'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, 'PINNED_AWS_OPERATION_FAILED');
  return JSON.parse(result.stdout);
}
function awsWait(parts) {
  const result = spawnSync(process.platform === 'win32' ? 'aws.exe' : 'aws',
    [...parts, '--profile', 'tracepoint-production', '--region', 'us-east-1'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 660_000 });
  assert.equal(result.status, 0, 'PINNED_AWS_WAIT_FAILED');
}
async function readSecret(name, versionStage) {
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: name,
    ...(versionStage ? { VersionStage: versionStage } : {}) }));
  assert.equal(result.Name, name, 'SECRET_NAME_MISMATCH');
  assert.match(result.ARN ?? '', /^arn:aws:secretsmanager:us-east-1:193644343389:secret:/,
    'SECRET_ACCOUNT_MISMATCH');
  assert.equal(typeof result.SecretString, 'string', 'SECRET_STRING_REQUIRED');
  return { value: result.SecretString, versionId: result.VersionId };
}
async function vercel(token, method, path, body) {
  const response = await fetch(`https://api.vercel.com${withExactVercelTeam(path)}`, {
    method, headers: { authorization: `Bearer ${token}`, accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(25_000),
  });
  let json = null;
  try { json = await response.json(); } catch { /* status remains authoritative */ }
  assert.equal(response.status, 200, `VERCEL_${method}_HTTP_${response.status}`);
  return json;
}
async function externalStatus(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  await response.arrayBuffer();
  return response.status;
}
async function requireProductionFirewallDeny(token) {
  const path = `/v1/security/firewall/config?projectId=${VERCEL_PROJECT_ID}`;
  const config = await vercel(token, 'GET', path);
  const rules = config?.active?.rules;
  assert.ok(Array.isArray(rules), 'VERCEL_ACTIVE_FIREWALL_CONFIG_MISSING');
  const matches = rules.filter(rule => rule?.name ===
    'TracePoint cutover production deny 20260928');
  assert.equal(matches.length, 1, 'VERCEL_PRODUCTION_DENY_RULE_NOT_UNIQUE');
  const rule = matches[0];
  assert.equal(rule.active, true, 'VERCEL_PRODUCTION_DENY_NOT_ACTIVE');
  assert.equal(rule.action?.mitigate?.action, 'deny', 'VERCEL_PRODUCTION_DENY_ACTION_DRIFT');
  assert.equal(rule.conditionGroup?.length, 1, 'VERCEL_PRODUCTION_DENY_GROUP_DRIFT');
  assert.equal(rule.conditionGroup[0]?.conditions?.length, 1,
    'VERCEL_PRODUCTION_DENY_CONDITION_COUNT_DRIFT');
  const condition = rule.conditionGroup[0].conditions[0];
  assert.equal(condition.type, 'environment', 'VERCEL_PRODUCTION_DENY_TYPE_DRIFT');
  assert.equal(condition.op, 'eq', 'VERCEL_PRODUCTION_DENY_OPERATOR_DRIFT');
  assert.equal(condition.value, 'production', 'VERCEL_PRODUCTION_DENY_VALUE_DRIFT');
  assert.ok(condition.neg === false || condition.neg == null,
    'VERCEL_PRODUCTION_DENY_NEGATED');
}
let stage = 'identity';
try {
  assert.equal(aws(['sts', 'get-caller-identity']).Account, '193644343389',
    'PRODUCTION_ACCOUNT_REQUIRED');
  stage = 'secret-read';
  const [oldRecord, appRecord, rollbackRecord, tokenRecord] = await Promise.all([
    readSecret(PRODUCTION_MIGRATION_REST_SECRET), readSecret(PRODUCTION_APPLICATION_SECRET),
    readSecret(PRODUCTION_ROLLBACK_SECRET), readSecret(VERCEL_TOKEN_SECRET),
  ]);
  const currentMigration = JSON.parse(oldRecord.value);
  assert.equal(currentMigration.projectUrl, 'https://izlkwggluhlhzlumtzes.supabase.co',
    'OLD_SOURCE_PROJECT_MISMATCH');
  const rollbackKey = extractProductionEpochKey(rollbackRecord.value,
    PRODUCTION_EPOCH.rollbackSecretName);
  let oldKey = currentMigration.serviceRoleKey;
  if (oldKey === rollbackKey) {
    const previous = JSON.parse((await readSecret(PRODUCTION_MIGRATION_REST_SECRET,
      'AWSPREVIOUS')).value);
    assert.equal(previous.projectUrl, currentMigration.projectUrl,
      'PREVIOUS_SOURCE_PROJECT_MISMATCH');
    oldKey = previous.serviceRoleKey;
  }
  assert.match(oldKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/, 'OLD_MODERN_KEY_REQUIRED');
  assert.notEqual(rollbackKey, oldKey, 'ROLLBACK_KEY_NOT_DISTINCT');
  const app = JSON.parse(appRecord.value);
  assert.match(app.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    /^sb_publishable_[A-Za-z0-9_-]{20,}$/,
    'BRIDGE_MODERN_PUBLISHABLE_KEY_REQUIRED');
  const appAlreadyRestored = app.SUPABASE_SECRET_KEY === rollbackKey;
  const restAlreadyRestored = currentMigration.serviceRoleKey === rollbackKey;
  assert.ok(app.SUPABASE_SECRET_KEY === oldKey || appAlreadyRestored,
    'BRIDGE_KEY_UNEXPECTED');
  const wrappedToken = tokenRecord.value.startsWith('{') ? JSON.parse(tokenRecord.value) : null;
  if (wrappedToken) assert.deepEqual(Object.keys(wrappedToken), [VERCEL_TOKEN_SECRET]);
  const token = wrappedToken ? wrappedToken[VERCEL_TOKEN_SECRET] : tokenRecord.value;
  assert.ok(typeof token === 'string' && token.length >= 32 && !/\s/.test(token),
    'VERCEL_TOKEN_INVALID');
  stage = 'vercel-attestation';
  const [project, listed, baseline] = await Promise.all([
    vercel(token, 'GET', `/v9/projects/${VERCEL_PROJECT_ID}`),
    vercel(token, 'GET', `/v9/projects/${VERCEL_PROJECT_ID}/env`),
    vercel(token, 'GET', `/v13/deployments/${BASELINE_DEPLOYMENT_UID}`),
  ]);
  attestVercelProject(project);
  const envs = listed.envs ?? listed;
  attestVercelVariables(envs);
  const publishable = envs.filter(entry =>
    entry.key === 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY' &&
    entry.target?.includes('production'));
  assert.equal(publishable.length, 1, 'VERCEL_PRODUCTION_PUBLISHABLE_AMBIGUOUS');
  assert.deepEqual(publishable[0].target, ['production'],
    'VERCEL_PRODUCTION_PUBLISHABLE_TARGET_DRIFT');
  assert.match(publishable[0].id ?? '', /^[A-Za-z0-9]+$/,
    'VERCEL_PRODUCTION_PUBLISHABLE_ID_INVALID');
  attestVercelDeployment(baseline);
  const detail = await vercel(token, 'GET',
    `/v1/projects/${VERCEL_PROJECT_ID}/env/${PRODUCTION_SECRET_ENV_ID}`);
  assert.equal(detail.id, PRODUCTION_SECRET_ENV_ID, 'VERCEL_ENV_ID_MISMATCH');
  assert.equal(detail.key, 'SUPABASE_SECRET_KEY', 'VERCEL_ENV_KEY_MISMATCH');
  assert.deepEqual(detail.target, ['production'], 'VERCEL_ENV_TARGET_MISMATCH');
  assert.equal(detail.type, 'sensitive', 'VERCEL_ENV_TYPE_MISMATCH');
  const publishableDetail = await vercel(token, 'GET',
    `/v1/projects/${VERCEL_PROJECT_ID}/env/${publishable[0].id}`);
  assert.equal(publishableDetail.id, publishable[0].id,
    'VERCEL_PUBLISHABLE_DETAIL_ID_MISMATCH');
  assert.equal(publishableDetail.key, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'VERCEL_PUBLISHABLE_DETAIL_KEY_MISMATCH');
  assert.deepEqual(publishableDetail.target, ['production'],
    'VERCEL_PUBLISHABLE_DETAIL_TARGET_MISMATCH');
  const plan = buildVercelSourceAbortRequests(project, envs, baseline, rollbackKey);
  stage = 'ecs-attestation';
  const baselineDefinition = aws(['ecs', 'describe-task-definition',
    '--task-definition', BASELINE_TASK]).taskDefinition;
  const restoreDefinition = aws(['ecs', 'describe-task-definition',
    '--task-definition', RESTORE_TASK]).taskDefinition;
  assert.equal(restoreDefinition.taskDefinitionArn, RESTORE_TASK,
    'RESTORE_TASK_ARN_MISMATCH');
  assert.equal(restoreDefinition.status, 'ACTIVE', 'RESTORE_TASK_NOT_ACTIVE');
  assert.equal(restoreDefinition.containerDefinitions?.length, 1,
    'RESTORE_CONTAINER_COUNT_DRIFT');
  assert.equal(restoreDefinition.containerDefinitions[0].image, RESTORE_IMAGE,
    'RESTORE_IMAGE_DRIFT');
  for (const field of ['executionRoleArn', 'taskRoleArn', 'cpu', 'memory', 'networkMode'])
    assert.equal(restoreDefinition[field], baselineDefinition[field],
      `RESTORE_TASK_${field}_DRIFT`);
  const baselineContainer = { ...baselineDefinition.containerDefinitions[0] };
  const restoreContainer = { ...restoreDefinition.containerDefinitions[0] };
  delete baselineContainer.image;
  delete restoreContainer.image;
  assert.deepEqual(restoreContainer, baselineContainer,
    'RESTORE_CONTAINER_CONFIG_DRIFT');
  const restoreScan = aws(['ecr', 'describe-image-scan-findings',
    '--repository-name', 'tracepoint-production', '--image-id',
    'imageDigest=sha256:e7f6cf81fd748b60450b2e4c6ee07b53dd8fbceaf5460a4e9973bd4c2534d9ce']);
  assert.equal(restoreScan.imageScanStatus?.status, 'COMPLETE',
    'RESTORE_IMAGE_SCAN_NOT_COMPLETE');
  assert.equal(Object.values(restoreScan.imageScanFindings?.findingSeverityCounts ?? {})
    .reduce((count, value) => count + Number(value), 0), 0,
  'RESTORE_IMAGE_SCAN_FINDINGS');
  const services = aws(['ecs', 'describe-services', '--cluster', CLUSTER,
    '--services', SERVICE]).services;
  assert.equal(services?.length, 1, 'PUBLIC_SERVICE_MISSING');
  const service = services[0];
  assert.equal(service.status, 'ACTIVE', 'PUBLIC_SERVICE_NOT_ACTIVE');
  assert.equal(service.taskDefinition, BASELINE_TASK, 'PUBLIC_BRIDGE_REVISION_DRIFT');
  if (check) {
    console.log(JSON.stringify({ status: 'PREAUTHORITY_SOURCE_RESTORE_EXECUTABLE',
      sourceProject: PRODUCTION_EPOCH.projectRef, vercelProjectId: VERCEL_PROJECT_ID,
      baselineGitSha: BASELINE_GIT_SHA, publicTaskDefinition: BASELINE_TASK,
      restoreTaskDefinition: RESTORE_TASK, restoreImage: RESTORE_IMAGE,
      productionVercelEnvId: PRODUCTION_SECRET_ENV_ID,
      productionPublishableEnvId: publishable[0].id,
      rollbackSecretName: PRODUCTION_ROLLBACK_SECRET,
      rollbackKeyDistinct: true, sensitiveValueUnreadable: true,
      awsSecretWritePathPrepared: true, vercelPatchAndFreshDeploymentPrepared: true,
      ecsRestartPrepared: true, productionMutations: false, keyValuesLogged: false }));
    process.exit(0);
  }
  stage = 'active-fence';
  await requireProductionFirewallDeny(token);
  assert.equal(service.desiredCount, 0, 'BRIDGE_NOT_STOPPED');
  assert.equal(service.runningCount, 0, 'BRIDGE_TASK_STILL_RUNNING');
  assert.equal(await externalStatus('https://www.tracepointhq.com/landing'), 503,
    'PUBLIC_MAINTENANCE_NOT_ACTIVE');
  assert.ok([403, 503].includes(await externalStatus('https://tracepoint-amber.vercel.app/landing')),
    'VERCEL_PRODUCTION_NOT_BLOCKED_BEFORE_RESTORE');
  const catalog = spawnSync(process.execPath,
    [fileURLToPath(new URL('./inspect-production-source-catalog.mjs', import.meta.url))],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  assert.equal(catalog.status, 0, 'SOURCE_CATALOG_UNAVAILABLE');
  const sourceState = JSON.parse(catalog.stdout);
  assert.equal(sourceState.projectRef, 'izlkwggluhlhzlumtzes');
  assert.equal(sourceState.existingFenceTriggerCount, 174, 'SOURCE_SQL_FENCE_NOT_ACTIVE');
  const oldStatus = await externalStatus(`https://izlkwggluhlhzlumtzes.supabase.co/rest/v1/departments?select=id&limit=1`);
  // A no-key request can be rejected independently; the direct old-key probe
  // below is the actual credential-epoch check.
  assert.ok(rejectedCredential(oldStatus), 'UNAUTHENTICATED_SOURCE_READ_UNEXPECTED');
  const oldResponse = await fetch('https://izlkwggluhlhzlumtzes.supabase.co/rest/v1/departments?select=id&limit=1', {
    headers: { apikey: oldKey }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  await oldResponse.arrayBuffer();
  assert.ok(rejectedCredential(oldResponse.status), 'OLD_CREDENTIAL_STILL_ACTIVE');
  stage = 'secret-distribution';
  const [currentAppVersion, currentMigrationVersion] = await Promise.all([
    readSecret(PRODUCTION_APPLICATION_SECRET), readSecret(PRODUCTION_MIGRATION_REST_SECRET),
  ]);
  assert.equal(currentAppVersion.versionId, appRecord.versionId,
    'APPLICATION_SECRET_CONCURRENT_CHANGE');
  assert.equal(currentMigrationVersion.versionId, oldRecord.versionId,
    'MIGRATION_SECRET_CONCURRENT_CHANGE');
  if (!restAlreadyRestored) {
    const next = replaceMigrationRestKey(currentMigration, oldKey, rollbackKey);
    await secrets.send(new PutSecretValueCommand({ SecretId: PRODUCTION_MIGRATION_REST_SECRET,
      SecretString: JSON.stringify(next) }));
  }
  if (!appAlreadyRestored) {
    const next = replaceBridgeElevatedKey(app, oldKey, rollbackKey);
    await secrets.send(new PutSecretValueCommand({ SecretId: PRODUCTION_APPLICATION_SECRET,
      SecretString: JSON.stringify(next) }));
  }
  stage = 'vercel-publishable-variable';
  const publicPatched = await vercel(token, 'PATCH',
    `/v9/projects/${VERCEL_PROJECT_ID}/env/${publishable[0].id}`,
    { value: app.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
  assert.equal(publicPatched?.id, publishable[0].id,
    'VERCEL_PUBLISHABLE_PATCH_ID_MISMATCH');
  stage = 'vercel-production-variable';
  const patched = await vercel(token, 'PATCH', plan.patch.path, plan.patch.body);
  assert.equal(patched?.id, PRODUCTION_SECRET_ENV_ID, 'VERCEL_PATCH_ID_MISMATCH');
  stage = 'vercel-new-deployment';
  const created = await vercel(token, 'POST', plan.deploy.path, plan.deploy.body);
  const uid = created?.uid ?? created?.id;
  assert.match(uid ?? '', /^dpl_[A-Za-z0-9]+$/, 'VERCEL_NEW_DEPLOYMENT_ID_MISSING');
  assert.equal(created?.projectId, VERCEL_PROJECT_ID, 'VERCEL_NEW_DEPLOYMENT_PROJECT_MISMATCH');
  assert.equal(created?.target, 'production', 'VERCEL_NEW_DEPLOYMENT_TARGET_MISMATCH');
  let ready = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const state = await vercel(token, 'GET', `/v13/deployments/${uid}`);
    assert.equal(state?.projectId, VERCEL_PROJECT_ID);
    assert.equal(state?.target, 'production');
    assert.equal(state?.meta?.githubCommitSha, BASELINE_GIT_SHA,
      'VERCEL_NEW_DEPLOYMENT_CODE_MISMATCH');
    ready = state.readyState;
    if (['READY', 'ERROR', 'CANCELED'].includes(ready)) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(ready, 'READY', `VERCEL_NEW_DEPLOYMENT_${ready ?? 'TIMEOUT'}`);
  stage = 'post-deployment-firewall';
  await requireProductionFirewallDeny(token);
  assert.equal(await externalStatus('https://tracepoint-amber.vercel.app/landing'), 403,
    'VERCEL_PRODUCTION_NOT_DENIED_AFTER_DEPLOYMENT');
  stage = 'ecs-bridge-restart';
  const updated = aws(['ecs', 'update-service', '--cluster', CLUSTER, '--service', SERVICE,
    '--task-definition', RESTORE_TASK, '--desired-count', '1', '--force-new-deployment']);
  assert.equal(updated.service?.taskDefinition, RESTORE_TASK, 'BRIDGE_RESTART_TASK_MISMATCH');
  assert.equal(updated.service?.desiredCount, 1, 'BRIDGE_RESTART_DESIRED_MISMATCH');
  awsWait(['ecs', 'wait', 'services-stable', '--cluster', CLUSTER, '--services', SERVICE]);
  const settled = aws(['ecs', 'describe-services', '--cluster', CLUSTER,
    '--services', SERVICE]).services?.[0];
  assert.equal(settled?.taskDefinition, RESTORE_TASK, 'BRIDGE_RESTART_SETTLED_TASK_MISMATCH');
  assert.equal(settled?.desiredCount, 1, 'BRIDGE_RESTART_SETTLED_DESIRED_MISMATCH');
  assert.equal(settled?.runningCount, 1, 'BRIDGE_RESTART_NOT_RUNNING');
  console.log(JSON.stringify({ status: 'PREAUTHORITY_SOURCE_RESTORE_DISTRIBUTED',
    sourceProject: PRODUCTION_EPOCH.projectRef, vercelDeploymentUid: uid,
    gitSha: BASELINE_GIT_SHA, publicTaskDefinition: RESTORE_TASK,
    maintenanceStillRequired: true, sourceFenceStillRequired: true,
    authStorageRestorationStillRequired: true, sourceWriteReadbackStillRequired: true,
    publicAuthorityNotRestoredByThisScript: true, keyValuesLogged: false }));
} catch (error) {
  console.error(JSON.stringify({ status: 'PREAUTHORITY_SOURCE_RESTORE_BLOCKED', stage,
    code: /^[A-Z0-9_:]+$/.test(error?.message ?? '') ? error.message : 'RESTORE_FAILED',
    maintainFenceAndMaintenance: true }));
  process.exitCode = 2;
} finally { secrets.destroy(); }
