import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const base = ['--profile', 'tracepoint-production', '--region', 'us-east-1', '--output', 'json'];
const aws = args => JSON.parse(execFileSync('aws', [...args, ...base], { encoding: 'utf8', maxBuffer: 5_000_000 }));
const definition = {
  family: 'tracepoint-production-aws-native-cognito-read-proof',
  taskRoleArn: 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-task-v1',
  executionRoleArn: 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-execution-v1',
  networkMode: 'awsvpc', requiresCompatibilities: ['FARGATE'], cpu: '256', memory: '512',
  containerDefinitions: [{
    name: 'cognito-read-only', image: 'public.ecr.aws/aws-cli/aws-cli:2.36.34',
    essential: true, readonlyRootFilesystem: true,
    command: ['cognito-idp', 'admin-get-user', '--user-pool-id', 'us-east-1_diFmWDMe9',
      '--username', 'tracepoint-absent-native-proof-20260926@example.invalid',
      '--region', 'us-east-1', '--output', 'json'],
    logConfiguration: { logDriver: 'awslogs', options: {
      'awslogs-group': '/tracepoint/production/application',
      'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'cognito-read-proof',
    } },
  }],
};
const registered = aws(['ecs', 'register-task-definition', '--cli-input-json', JSON.stringify(definition)]).taskDefinition;
assert.equal(registered.taskRoleArn, definition.taskRoleArn);
const launched = aws(['ecs', 'run-task', '--cluster', 'tracepoint-production',
  '--task-definition', registered.taskDefinitionArn, '--launch-type', 'FARGATE', '--count', '1',
  '--network-configuration', 'awsvpcConfiguration={subnets=[subnet-0f4cbed3e60d90bfc],securityGroups=[sg-0ccc72ae99581cdfd],assignPublicIp=ENABLED}']);
assert.equal(launched.failures.length, 0);
assert.equal(launched.tasks.length, 1);
const arn = launched.tasks[0].taskArn;
console.log(JSON.stringify({ launched: arn, targetPool: 'us-east-1_diFmWDMe9', mode: 'read-only-absent-identity' }));
execFileSync('aws', ['ecs', 'wait', 'tasks-stopped', '--cluster', 'tracepoint-production',
  '--tasks', arn, ...base], { encoding: 'utf8', timeout: 25 * 60_000 });
const stopped = aws(['ecs', 'describe-tasks', '--cluster', 'tracepoint-production', '--tasks', arn]).tasks[0];
console.log(JSON.stringify({ task: arn, exitCode: stopped.containers[0].exitCode,
  logStream: `cognito-read-proof/cognito-read-only/${arn.split('/').at(-1)}` }));
// The exact expected proof response is UserNotFoundException, so the CLI exits nonzero.
// The caller must inspect the isolated log stream before marking the gate passed.
