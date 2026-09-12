import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { IdentityMigrationRunnerStack, type IdentityMigrationRunnerStackProps } from '../lib/identity-migration-runner-stack';

const props: IdentityMigrationRunnerStackProps = {
  env: { account: '559054714699', region: 'us-east-1' }, environmentName: 'staging', mode: 'execute', runId: '11111111-1111-4111-8111-111111111111',
  authorizationReference: 'STAGING-IDENTITY-2026', manifestSha256: 'c'.repeat(64), commit: 'a'.repeat(40), imageDigest: `sha256:${'b'.repeat(64)}`,
  repositoryName: 'tracepoint-staging', clusterName: 'tracepoint-staging', vpcId: 'vpc-12345678', publicSubnetIds: ['subnet-11111111', 'subnet-22222222'], databaseSecurityGroupId: 'sg-11111111',
  databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:559054714699:secret:tracepoint/staging/database/runtime-abc123',
  artifactBucketName: 'tracepoint-staging-private-559054714699', artifactKeyArn: 'arn:aws:kms:us-east-1:559054714699:key/11111111-1111-4111-8111-111111111111',
  userPoolId: 'us-east-1_Synthetic', clientId: 'syntheticclient', fromAddress: 'notifications@staging.tracepointhq.com', sesConfigurationSet: 'tracepoint-staging',
  stagingRecipientSha256: ['d'.repeat(64)],
};

test('identity task is one-shot, immutable, least-privilege, and AWS-native only', () => {
  const template = Template.fromStack(new IdentityMigrationRunnerStack(new cdk.App(), 'runner', props));
  template.resourceCountIs('AWS::ECS::Service', 0);
  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    Cpu: '512', Memory: '1024',
    ContainerDefinitions: [Match.objectLike({
      Name: 'migration', ReadonlyRootFilesystem: true,
      Command: ['--execute'],
      MountPoints: [{ ContainerPath: '/tmp', ReadOnly: false, SourceVolume: 'migration-tmp' }],
      Secrets: Match.arrayWith([
        Match.objectLike({ Name: 'TRACEPOINT_DATABASE_SECRET_JSON' }),
      ]),
      Environment: Match.arrayWith([
        Match.objectLike({ Name: 'TRACEPOINT_RUNTIME_PROVIDER_MODE', Value: 'aws-native' }),
        Match.objectLike({ Name: 'TRACEPOINT_EMAIL_PROVIDER', Value: 'ses' }),
      ]),
    })],
  });
  const serialized = JSON.stringify(template.toJSON());
  assert.match(serialized, /sha256:[0-9a-f]{64}/);
  assert.match(serialized, /cognito-idp:AdminCreateUser/);
  assert.match(serialized, /ses:SendEmail/);
  assert.doesNotMatch(serialized, /SUPABASE|VERCEL|BREVO|AdminDeleteUser|TRACEPOINT_AUTH_STATE_KEYS|TRACEPOINT_AUTH_REFRESH_KEYS/);
});

test('private preparation can read one department without Cognito or SES mutation authority', () => {
  const prepared = { ...props, mode: 'prepare' as const, manifestSha256: '', actorUserId: '22222222-2222-4222-8222-222222222222', departmentId: '33333333-3333-4333-8333-333333333333' };
  const template = Template.fromStack(new IdentityMigrationRunnerStack(new cdk.App(), 'prepare', prepared));
  template.hasResourceProperties('AWS::ECS::TaskDefinition', { ContainerDefinitions: [Match.objectLike({ Command: ['--prepare'] })] });
  const serialized = JSON.stringify(template.toJSON());
  assert.doesNotMatch(serialized, /cognito-idp:AdminCreateUser|cognito-idp:AdminGetUser|ses:SendEmail/);
  assert.match(serialized, /manifest\.json/);
});

test('identity task rejects account, mutable-image, artifact, and authorization drift', () => {
  for (const change of [
    { env: { account: '265544358665', region: 'us-east-1' } },
    { env: { account: '222222222222', region: 'us-east-1' } },
    { imageDigest: 'latest' },
    { artifactBucketName: 'tracepoint-staging-migration-559054714699' },
    { manifestSha256: 'short' },
    { publicSubnetIds: ['subnet-11111111'] },
    { stagingRecipientSha256: [] },
  ]) assert.throws(() => new IdentityMigrationRunnerStack(new cdk.App(), `invalid-${Math.random()}`, { ...props, ...change }));
});

test('production identity runner is pinned to the production account and constrained by the boundary', () => {
  const production = {
    ...props,
    env: { account: '193644343389', region: 'us-east-1' },
    environmentName: 'production' as const,
    databaseSecretArn: 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/database/runtime-abc123',
    artifactBucketName: 'tracepoint-production-private-193644343389',
    artifactKeyArn: 'arn:aws:kms:us-east-1:193644343389:key/11111111-1111-4111-8111-111111111111',
    repositoryName: 'tracepoint-production',
    clusterName: 'tracepoint-production',
    fromAddress: 'notifications@tracepointhq.com',
    sesConfigurationSet: 'tracepoint-production',
    stagingRecipientSha256: [],
  };
  const template = Template.fromStack(new IdentityMigrationRunnerStack(new cdk.App(), 'production-runner', production));
  const roles = Object.values(template.findResources('AWS::IAM::Role'));
  assert.equal(roles.length, 2);
  for (const role of roles) {
    assert.match(JSON.stringify(role.Properties.PermissionsBoundary), /TracePointProductionBoundary/);
    const trust = JSON.stringify(role.Properties.AssumeRolePolicyDocument);
    assert.match(trust, /aws:SourceAccount.*193644343389/);
    assert.match(trust, /aws:SourceArn.*ecs.*us-east-1.*193644343389/);
  }
  assert.throws(() => new IdentityMigrationRunnerStack(new cdk.App(), 'wrong-production', {
    ...production,
    env: { account: '222222222222', region: 'us-east-1' },
  }));
});
