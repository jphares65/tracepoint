import * as cdk from 'aws-cdk-lib';
import { ProductionNativeAuthorityRehearsalStack } from '../lib/production-native-authority-rehearsal-stack';

const app = new cdk.App();
if (app.node.tryGetContext('account') !== '193644343389' ||
    app.node.tryGetContext('region') !== 'us-east-1' ||
    app.node.tryGetContext('proofOnly') !== 'true') {
  throw new Error('Exact account, region, and isolated proof context required');
}
new ProductionNativeAuthorityRehearsalStack(app,
  'tracepoint-production-native-authority-rehearsal', {
    env: { account: '193644343389', region: 'us-east-1' },
    terminationProtection: true,
    description: 'No-public-route managed ECS service rehearsal; never production authority',
    tags: { Application: 'TracePoint', Environment: 'production', Owner: 'TracePoint',
      ManagedBy: 'AWS-CDK', ProofOnly: 'true' },
  });
