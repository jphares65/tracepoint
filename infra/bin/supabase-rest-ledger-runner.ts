#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SupabaseRestLedgerRunnerStack } from '../lib/supabase-rest-ledger-runner-stack';

const app = new cdk.App();
const context = (name: string) => app.node.tryGetContext(name);
new SupabaseRestLedgerRunnerStack(app, `tracepoint-production-supabase-rest-ledger-${String(context('runId')).slice(0, 8)}`, {
  env: { account: context('account'), region: context('region') }, runId: context('runId'), authorizationReference: context('authorizationReference'), commit: context('commit'), imageDigest: context('imageDigest'), repositoryName: context('repositoryName'), clusterName: context('clusterName'), vpcId: context('vpcId'), publicSubnetIds: String(context('publicSubnetIds') ?? '').split(',').filter(Boolean), sourceSecretArn: context('sourceSecretArn'), terminationProtection: true,
  description: 'Temporary isolated TracePoint source-only Supabase REST/Admin ledger runner',
});
