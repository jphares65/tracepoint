import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ProductionNativeAuthorityRehearsalStack } from '../lib/production-native-authority-rehearsal-stack';

const app = new cdk.App();
const stack = new ProductionNativeAuthorityRehearsalStack(app, 'authority-proof', {
  env: { account: '193644343389', region: 'us-east-1' },
});
const template = Template.fromStack(stack).toJSON();
const resources = Object.values(template.Resources) as Array<{ Type: string; Properties?: Record<string, unknown> }>;
assert.deepEqual(resources.map(resource => resource.Type), ['AWS::ECS::Service']);
const service = resources[0].Properties ?? {};
assert.equal(service.Cluster, 'tracepoint-production');
assert.equal(service.ServiceName, 'tracepoint-production-native-authority-rehearsal');
assert.equal(service.TaskDefinition,
  'arn:aws:ecs:us-east-1:193644343389:task-definition/tracepoint-production-aws-native-no-traffic-proof:1');
assert.equal(service.LoadBalancers, undefined);
assert.equal(service.ServiceRegistries, undefined);
assert.equal(service.DesiredCount && typeof service.DesiredCount, 'object');
assert.equal(JSON.stringify(template).includes('AWS::ElasticLoadBalancing'), false);
assert.equal(JSON.stringify(template).includes('AWS::Route53'), false);
console.log('NO_PUBLIC_ROUTE_AUTHORITY_REHEARSAL_TEMPLATE_PASS');
