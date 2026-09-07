import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import * as cdk from 'aws-cdk-lib';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {ProductionAccountBaselineStack, ProductionCostControlsStack} from '../lib/production-account-baseline-stack';

const env = {account: '222222222222', region: 'us-east-1'};

test('production account baseline owns protected audit and security services', () => {
  const stack = new ProductionAccountBaselineStack(new cdk.App(), 'Baseline', {env, accountId: env.account, terminationProtection: true});
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::CloudTrail::Trail', {EnableLogFileValidation: true, IncludeGlobalServiceEvents: true, IsMultiRegionTrail: true, IsLogging: true});
  template.hasResourceProperties('AWS::Config::ConfigurationRecorder', {RecordingMode: {RecordingFrequency: 'CONTINUOUS'}, RecordingGroup: {AllSupported: false, IncludeGlobalResourceTypes: false, RecordingStrategy: {UseOnly: 'INCLUSION_BY_RESOURCE_TYPES'}}});
  template.hasResourceProperties('AWS::GuardDuty::Detector', {Enable: true, FindingPublishingFrequency: 'FIFTEEN_MINUTES'});
  template.resourceCountIs('AWS::SecurityHub::HubV2', 1);
  template.hasResourceProperties('AWS::S3::Bucket', {BucketEncryption: Match.anyValue(), PublicAccessBlockConfiguration: {BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true}, VersioningConfiguration: {Status: 'Enabled'}});
  template.hasResourceProperties('AWS::IAM::Role', {PermissionsBoundary: Match.anyValue()});
  for (const role of Object.values(template.findResources('AWS::IAM::Role'))) {
    assert.match(JSON.stringify(role.Properties.PermissionsBoundary), /TracePointProductionBoundary/);
  }
  assert.equal(stack.terminationProtection, true);
});

test('production cost controls use encrypted durable notifications', () => {
  const stack = new ProductionCostControlsStack(new cdk.App(), 'Costs', {env, accountId: env.account, monthlyBudgetUsd: 150, terminationProtection: true});
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Budgets::Budget', {Budget: {BudgetName: 'tracepoint-production-monthly', BudgetLimit: {Amount: 150, Unit: 'USD'}, BudgetType: 'COST', TimeUnit: 'MONTHLY'}});
  template.hasResourceProperties('AWS::CE::AnomalyMonitor', {MonitorDimension: 'SERVICE', MonitorType: 'DIMENSIONAL'});
  template.hasResourceProperties('AWS::CE::AnomalySubscription', {Frequency: 'IMMEDIATE', Subscribers: Match.arrayWith([Match.objectLike({Type: 'SNS'})])});
  template.hasResourceProperties('AWS::SNS::Topic', {KmsMasterKeyId: Match.anyValue()});
  template.resourceCountIs('AWS::SQS::Queue', 2);
  assert.equal(stack.terminationProtection, true);
});
