import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const profile = 'tracepoint-production';
const region = 'us-east-1';
const cluster = 'tracepoint-production';
const family = 'tracepoint-production-aws-native-no-traffic-proof';
const digest = 'sha256:cf19c9887eee2c79eac2abf2e0337f5a2bb95beefc5e20d0f1ffc0453a2f7b46';
const role = 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-task-v1';
const resourceId = 'db-X4DYNS3TMVSAP7Z3RISDWEYDVE';
const base = ['--profile', profile, '--region', region, '--output', 'json'];
function aws(args) {
  return JSON.parse(execFileSync('aws', [...args, ...base], { encoding: 'utf8', maxBuffer: 5_000_000 }));
}

const taskDefinition = aws(['ecs', 'describe-task-definition', '--task-definition', family]).taskDefinition;
assert.equal(taskDefinition.taskRoleArn, role);
assert.equal(taskDefinition.containerDefinitions.length, 1);
assert.equal(taskDefinition.containerDefinitions[0].name, 'tracepoint');
assert.equal(taskDefinition.containerDefinitions[0].image,
  `193644343389.dkr.ecr.${region}.amazonaws.com/tracepoint-production@${digest}`);
const db = aws(['rds', 'describe-db-instances', '--db-instance-identifier',
  'tracepoint-production-final-cutover-20260926']).DBInstances[0];
assert.equal(db.DbiResourceId, resourceId);
assert.equal(db.Endpoint.Address,
  'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com');
assert.equal(db.PubliclyAccessible, false);
assert.equal(db.DeletionProtection, true);
const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'production-native-no-traffic-proof.cjs'), 'utf8');
const launched = aws(['ecs', 'run-task', '--cluster', cluster,
  '--task-definition', taskDefinition.taskDefinitionArn, '--launch-type', 'FARGATE', '--count', '1',
  '--network-configuration', 'awsvpcConfiguration={subnets=[subnet-0f4cbed3e60d90bfc],securityGroups=[sg-0ccc72ae99581cdfd],assignPublicIp=ENABLED}',
  '--overrides', JSON.stringify({ containerOverrides: [{ name: 'tracepoint', command: ['-e', script] }] })]);
assert.equal(launched.failures.length, 0, 'Fargate launch failure');
assert.equal(launched.tasks.length, 1);
const taskArn = launched.tasks[0].taskArn;
console.log(JSON.stringify({ launched: taskArn, taskDefinition: taskDefinition.taskDefinitionArn,
  imageDigest: digest, rdsResourceId: resourceId }));
execFileSync('aws', ['ecs', 'wait', 'tasks-stopped', '--cluster', cluster, '--tasks', taskArn,
  ...base], { encoding: 'utf8', timeout: 25 * 60_000 });
const task = aws(['ecs', 'describe-tasks', '--cluster', cluster, '--tasks', taskArn]).tasks[0];
console.log(JSON.stringify({ task: taskArn, stoppedReason: task.stoppedReason,
  containerExitCode: task.containers[0].exitCode,
  logStream: `native-proof/tracepoint/${taskArn.split('/').at(-1)}` }));
if (task.containers[0].exitCode !== 0) process.exitCode = 1;
