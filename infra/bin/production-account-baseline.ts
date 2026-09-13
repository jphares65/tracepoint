import * as cdk from 'aws-cdk-lib';
import {AwsSolutionsChecks} from 'cdk-nag';
import {execFileSync} from 'node:child_process';
import {ProductionAccountBaselineStack, ProductionCostControlsStack} from '../lib/production-account-baseline-stack';

const app = new cdk.App();
const account = app.node.tryGetContext('account');
const region = app.node.tryGetContext('region');
const mode = app.node.tryGetContext('productionOperation');
if (account !== '193644343389' || region !== 'us-east-1' || !['preview', 'authorized'].includes(mode)) {
  throw new Error('Exact production account, region and operation are required');
}
if (mode === 'authorized') {
  let identity: {Account?: string; Arn?: string};
  try {
    identity = JSON.parse(execFileSync('aws.exe', ['sts', 'get-caller-identity', '--region', region, '--output', 'json'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}));
  } catch {
    throw new Error('Production identity unavailable');
  }
  if (identity.Account !== account || !new RegExp(`^arn:aws:sts::${account}:assumed-role/TracePointMigrationProduction/[^/]+$`).test(identity.Arn ?? '')) {
    throw new Error('Exact production migration role required');
  }
}

const common: cdk.StackProps = {
  env: {account, region},
  terminationProtection: true,
  tags: {
    Application: 'TracePoint',
    Environment: 'production',
    Owner: 'TracePoint',
    ManagedBy: 'AWS-CDK',
    CostCenter: 'TracePoint-Production',
    DataClassification: 'PublicSafety-Sensitive',
  },
};
new ProductionAccountBaselineStack(app, 'tracepoint-production-account-baseline', {...common, accountId: account});
new ProductionCostControlsStack(app, 'tracepoint-production-cost-controls', {...common, accountId: account, monthlyBudgetUsd: 150});
cdk.Aspects.of(app).add(new AwsSolutionsChecks({verbose: true}));
