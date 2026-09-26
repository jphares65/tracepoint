import * as cdk from 'aws-cdk-lib';
import { ProductionNativeProofStack } from '../lib/production-native-proof-stack';

const app = new cdk.App();
if (app.node.tryGetContext('account') !== '193644343389' ||
    app.node.tryGetContext('region') !== 'us-east-1' ||
    app.node.tryGetContext('proofOnly') !== 'true') {
  throw new Error('Exact account, region, and no-traffic proof context required');
}
new ProductionNativeProofStack(app, 'tracepoint-production-aws-native-no-traffic-proof', {
  env: { account: '193644343389', region: 'us-east-1' },
  terminationProtection: true,
  description: 'Isolated AWS-native production IAM and immutable-image proof; no service, listener, or DNS',
  tags: { Application: 'TracePoint', Environment: 'production', Owner: 'TracePoint', ManagedBy: 'AWS-CDK',
    CostCenter: 'TracePoint-Production', DataClassification: 'PublicSafety-Sensitive', ProofOnly: 'true' },
});
