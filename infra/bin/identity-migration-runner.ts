#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { IdentityMigrationRunnerStack } from '../lib/identity-migration-runner-stack';

const app = new cdk.App();
const context = (name: string) => app.node.tryGetContext(name);
const environmentName = context('environment');
const mode = context('mode');
new IdentityMigrationRunnerStack(app, `tracepoint-${environmentName}-identity-${mode}-${context('runId')}`, {
  env: { account: context('account'), region: context('region') },
  environmentName,
  mode,
  runId: context('runId'),
  authorizationReference: context('authorizationReference'),
  manifestSha256: context('manifestSha256'),
  actorUserId: context('actorUserId') || undefined,
  departmentId: context('departmentId') || undefined,
  commit: context('commit'),
  imageDigest: context('imageDigest'),
  repositoryName: context('repositoryName'),
  clusterName: context('clusterName'),
  vpcId: context('vpcId'),
  publicSubnetIds: String(context('publicSubnetIds') ?? '').split(',').filter(Boolean),
  databaseSecurityGroupId: context('databaseSecurityGroupId'),
  databaseSecretArn: context('databaseSecretArn'),
  artifactBucketName: context('artifactBucketName'),
  artifactKeyArn: context('artifactKeyArn'),
  userPoolId: context('userPoolId'),
  clientId: context('clientId'),
  fromAddress: context('fromAddress'),
  sesConfigurationSet: context('sesConfigurationSet'),
  stagingRecipientSha256: String(context('stagingRecipientSha256') ?? '').split(',').filter(Boolean),
  terminationProtection: true,
  description: 'Temporary guarded TracePoint Cognito identity migration runner; never an application runtime dependency',
});
