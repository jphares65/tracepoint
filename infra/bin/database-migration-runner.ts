#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DatabaseMigrationRunnerStack } from '../lib/database-migration-runner-stack';

const app = new cdk.App();
const context = (name: string) => app.node.tryGetContext(name);
const environmentName = context('environment');
const account = context('account');
const region = context('region');
new DatabaseMigrationRunnerStack(app, `tracepoint-${environmentName}-database-migration-${context('runId')}`, {
  env: { account, region }, environmentName, runId: context('runId'), authorizationReference: context('authorizationReference'),
  commit: context('commit'), imageDigest: context('imageDigest'), repositoryName: context('repositoryName'), clusterName: context('clusterName'),
  vpcId: context('vpcId'), publicSubnetIds: String(context('publicSubnetIds') ?? '').split(',').filter(Boolean),
  databaseSecurityGroupId: context('databaseSecurityGroupId'), sourceSecretArn: context('sourceSecretArn'), targetSecretArn: context('targetSecretArn'),
  sourceHost: context('sourceHost'), sourceProjectRef: context('sourceProjectRef'), sourceDatabase: context('sourceDatabase'), targetHost: context('targetHost'), targetDatabase: context('targetDatabase'),
  terminationProtection: true,
  description: 'Temporary guarded TracePoint PostgreSQL migration runner; never an application runtime dependency',
});
