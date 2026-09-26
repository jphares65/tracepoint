import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = ['--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'json'];
const aws = args => JSON.parse(execFileSync('aws', [...args, ...base], { encoding: 'utf8', maxBuffer: 5_000_000 }));
const role = 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-task-v1';
const execution = 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-execution-v1';
const task = {
  family: 'tracepoint-production-aws-native-ses-simulator-proof',
  taskRoleArn: role, executionRoleArn: execution, networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'], cpu: '256', memory: '512',
  containerDefinitions: [{
    name: 'ses-simulator-only', image: 'public.ecr.aws/aws-cli/aws-cli:2.36.34',
    essential: true, readonlyRootFilesystem: true,
    command: [
      'sesv2', 'send-email',
      '--from-email-address', 'notifications@tracepointhq.com',
      '--destination', 'ToAddresses=success@simulator.amazonses.com',
      '--content', 'Simple={Subject={Data=TracePoint isolated native proof},Body={Text={Data=Synthetic simulator-only cutover readiness proof.}}}',
      '--configuration-set-name', 'tracepoint-production',
      '--region', 'us-east-1', '--query', 'MessageId', '--output', 'text',
    ],
    logConfiguration: { logDriver: 'awslogs', options: {
      'awslogs-group': '/tracepoint/production/application',
      'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'ses-simulator-proof',
    } },
  }],
};
const registered = aws(['ecs', 'register-task-definition', '--cli-input-json', JSON.stringify(task)]).taskDefinition;
assert.equal(registered.taskRoleArn, role);
assert.equal(registered.executionRoleArn, execution);
assert.equal(registered.containerDefinitions[0].command[5], 'ToAddresses=success@simulator.amazonses.com');
const launched = aws(['ecs', 'run-task', '--cluster', 'tracepoint-production',
  '--task-definition', registered.taskDefinitionArn, '--launch-type', 'FARGATE', '--count', '1',
  '--network-configuration', 'awsvpcConfiguration={subnets=[subnet-0f4cbed3e60d90bfc],securityGroups=[sg-0ccc72ae99581cdfd],assignPublicIp=ENABLED}']);
assert.equal(launched.failures.length, 0);
assert.equal(launched.tasks.length, 1);
const arn = launched.tasks[0].taskArn;
console.log(JSON.stringify({ launched: arn, taskDefinition: registered.taskDefinitionArn,
  recipientClass: 'aws-ses-simulator-only' }));
execFileSync('aws', ['ecs', 'wait', 'tasks-stopped', '--cluster', 'tracepoint-production',
  '--tasks', arn, ...base], { encoding: 'utf8', timeout: 25 * 60_000 });
const finished = aws(['ecs', 'describe-tasks', '--cluster', 'tracepoint-production', '--tasks', arn]).tasks[0];
console.log(JSON.stringify({ task: arn, exitCode: finished.containers[0].exitCode,
  imageDigest: finished.containers[0].imageDigest,
  logStream: `ses-simulator-proof/ses-simulator-only/${arn.split('/').at(-1)}` }));
if (finished.containers[0].exitCode !== 0) process.exitCode = 1;
