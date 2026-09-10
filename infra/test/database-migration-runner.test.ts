import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { DatabaseMigrationRunnerStack, type DatabaseMigrationRunnerStackProps } from '../lib/database-migration-runner-stack';

const props: DatabaseMigrationRunnerStackProps = {
  env: { account: '559054714699', region: 'us-east-1' }, environmentName: 'staging', runId: '11111111-1111-4111-8111-111111111111',
  authorizationReference: 'STAGING-MIGRATION-2026', commit: 'a'.repeat(40), imageDigest: `sha256:${'b'.repeat(64)}`,
  repositoryName: 'tracepoint-staging', clusterName: 'tracepoint-staging', vpcId: 'vpc-12345678', publicSubnetIds: ['subnet-11111111', 'subnet-22222222'],
  databaseSecurityGroupId: 'sg-11111111', sourceSecretArn: 'arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/migration/source-abc123',
  targetSecretArn: 'arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/database/migrator-abc123', sourceHost: 'db.abcdefghijklmnopqrst.supabase.co', sourceProjectRef: 'abcdefghijklmnopqrst',
  sourceDatabase: 'postgres', targetHost: 'tracepoint-staging.abc.us-east-1.rds.amazonaws.com', targetDatabase: 'tracepoint',
};

test('migration task is isolated from runtime and receives only two exact secrets', () => {
  const stack = new DatabaseMigrationRunnerStack(new cdk.App(), 'runner', props);
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::ECS::Service', 0);
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    Cpu: '512', Memory: '1024', EphemeralStorage: { SizeInGiB: 30 },
    ContainerDefinitions: [Match.objectLike({
      Name: 'migration', ReadonlyRootFilesystem: true,
      MountPoints: [{ ContainerPath: '/tmp', ReadOnly: false, SourceVolume: 'migration-tmp' }],
      Image: Match.anyValue(),
      Command: ['--execute', '--acknowledge-source-read', '--acknowledge-target-write'],
      Secrets: Match.arrayWith([
        Match.objectLike({ Name: 'SOURCE_DATABASE_SECRET_JSON' }),
        Match.objectLike({ Name: 'TARGET_DATABASE_SECRET_JSON' }),
      ]),
    })],
  });
  template.hasResourceProperties('AWS::ECS::TaskDefinition', { Volumes: [{ Name: 'migration-tmp' }] });
  const serialized = JSON.stringify(template.toJSON());
  assert.match(serialized, /sha256:[0-9a-f]{64}/);
  assert.doesNotMatch(serialized, /SUPABASE_SERVICE_ROLE|NEXT_PUBLIC_SUPABASE|BREVO_API_KEY/);
});

test('migration task refuses management, cross-account staging, mutable images, and duplicate secrets', () => {
  for (const change of [
    { env: { account: '265544358665', region: 'us-east-1' } }, { env: { account: '222222222222', region: 'us-east-1' } },
    { imageDigest: 'latest' }, { targetSecretArn: props.sourceSecretArn }, { publicSubnetIds: ['subnet-11111111'] },
  ]) assert.throws(() => new DatabaseMigrationRunnerStack(new cdk.App(), `invalid-${Math.random()}`, { ...props, ...change }));
});
