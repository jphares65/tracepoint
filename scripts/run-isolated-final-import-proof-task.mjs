#!/usr/bin/env node
// Starts only the one-shot paid-artifact-to-private-clone proof task.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const ACCOUNT = '193644343389';
const REGION = 'us-east-1';
const PROFILE = 'tracepoint-production';
const CLUSTER = 'tracepoint-production';
const TASK = 'tracepoint-production-final-import-proof-20260928:12';
const IMAGE_DIGEST = 'sha256:2ed5abefd80ca2848dfa97c210c5c08e5dcc5abc6ef552395bb88c20669a99d8';
const SUBNET = 'subnet-0f4cbed3e60d90bfc';
const GROUP = 'sg-030d7ad5f033167b1';

function aws(args) {
  const result = spawnSync('aws', [...args, '--profile', PROFILE, '--region', REGION, '--output', 'json'],
    { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, `ISOLATED_PROOF_AWS_CALL_FAILED:${args[0]}:${args[1]}`);
  return JSON.parse(result.stdout);
}

export function proofTaskOverrides(mode) {
  assert.ok(['baseline', 'rollback', 'apply'].includes(mode), 'ISOLATED_PROOF_MODE_REQUIRED');
  return { containerOverrides: [{ name: 'isolated-import-proof', environment: [
    { name: 'TRACEPOINT_ISOLATED_IMPORT_PROOF', value: 'paid-capture-b-to-proof-rds-v1' },
    { name: 'TRACEPOINT_ISOLATED_IMPORT_MODE', value: mode },
  ] }] };
}

export function runProofTask(mode) {
  const overrides = proofTaskOverrides(mode);
  assert.equal(aws(['sts', 'get-caller-identity']).Account, ACCOUNT, 'ISOLATED_PROOF_ACCOUNT_MISMATCH');
  const scan = aws(['ecr', 'describe-image-scan-findings', '--repository-name', 'tracepoint-production',
    '--image-id', `imageDigest=${IMAGE_DIGEST}`]);
  assert.equal(scan.imageScanStatus?.status, 'COMPLETE', 'ISOLATED_PROOF_SCAN_INCOMPLETE');
  assert.deepEqual(scan.imageScanFindings?.findingSeverityCounts ?? {}, {}, 'ISOLATED_PROOF_SCAN_FINDINGS');
  const task = aws(['ecs', 'describe-task-definition', '--task-definition', TASK]).taskDefinition;
  assert.equal(task?.taskDefinitionArn,
    `arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/${TASK}`, 'ISOLATED_PROOF_TASK_MISMATCH');
  assert.equal(task?.containerDefinitions?.[0]?.image,
    `${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/tracepoint-production@${IMAGE_DIGEST}`,
  'ISOLATED_PROOF_IMAGE_MISMATCH');
  assert.equal(task?.containerDefinitions?.[0]?.entryPoint?.join(' '),
    'node scripts/run-isolated-final-import-proof.mjs', 'ISOLATED_PROOF_ENTRYPOINT_MISMATCH');
  assert.ok(!task.containerDefinitions[0].environment.some(item =>
    item.name === 'TRACEPOINT_ISOLATED_IMPORT_PROOF' || item.name === 'TRACEPOINT_ISOLATED_IMPORT_MODE'),
  'ISOLATED_PROOF_DEFAULT_GUARD_UNSAFE');
  const database = aws(['rds', 'describe-db-instances', '--db-instance-identifier',
    'tracepoint-production-final-import-proof-20260928']).DBInstances?.[0];
  assert.equal(database?.DbiResourceId, 'db-4HOQR2UMDO6A3W7IEJFDGGDKVQ',
    'ISOLATED_PROOF_DATABASE_RESOURCE_MISMATCH');
  assert.equal(database?.PubliclyAccessible, false, 'ISOLATED_PROOF_DATABASE_PUBLIC');
  assert.equal(database?.DBInstanceStatus, 'available', 'ISOLATED_PROOF_DATABASE_UNAVAILABLE');
  const launch = aws(['ecs', 'run-task', '--cluster', CLUSTER, '--task-definition', TASK,
    '--launch-type', 'FARGATE', '--count', '1',
    '--network-configuration',
    `awsvpcConfiguration={subnets=[${SUBNET}],securityGroups=[${GROUP}],assignPublicIp=ENABLED}`,
    '--overrides', JSON.stringify(overrides)]);
  assert.deepEqual(launch.failures ?? [], [], 'ISOLATED_PROOF_ECS_LAUNCH_FAILED');
  assert.equal(launch.tasks?.length, 1, 'ISOLATED_PROOF_TASK_COUNT_MISMATCH');
  return { status: 'ISOLATED_PROOF_TASK_STARTED', mode,
    taskArn: launch.tasks[0].taskArn, targetResourceId: database.DbiResourceId };
}

if (import.meta.main) {
  try {
    assert.equal(process.argv.length, 3, 'ISOLATED_PROOF_ONE_MODE_REQUIRED');
    console.log(JSON.stringify(runProofTask(process.argv[2])));
  } catch (error) {
    console.error(JSON.stringify({ status: 'BLOCKED', code: error?.message ?? 'ISOLATED_PROOF_LAUNCH_FAILED' }));
    process.exitCode = 1;
  }
}
