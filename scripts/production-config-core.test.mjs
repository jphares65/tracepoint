import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateProductionConfig, productionConfigDefinition, productionConfigResourceTypes} from './production-config-core.mjs';

test('production Config definition is exact, selective and continuously recording', () => {
  const account = '222222222222';
  const desired = productionConfigDefinition(account);
  assert.equal(desired.recorder.roleARN, `arn:aws:iam::${account}:role/TracePoint-Production-Config`);
  assert.equal(desired.channel.s3BucketName, `tracepoint-production-audit-primary-${account}`);
  assert.equal(desired.recorder.recordingMode.recordingFrequency, 'CONTINUOUS');
  assert.equal(desired.recorder.recordingGroup.recordingStrategy.useOnly, 'INCLUSION_BY_RESOURCE_TYPES');
  assert.ok(productionConfigResourceTypes.includes('AWS::ECS::Service'));
  assert.throws(() => productionConfigDefinition('265544358665'));
});

test('production Config evidence requires exact resources and successful recording', () => {
  const account = '222222222222';
  const desired = productionConfigDefinition(account);
  assert.deepEqual(evaluateProductionConfig({recorders: [{...desired.recorder, arn: 'generated', recordingScope: 'PAID'}], channels: [desired.channel], statuses: [{name: desired.recorder.name, recording: true, lastStatus: 'SUCCESS'}]}, account), {recorderMatches: true, channelMatches: true, recording: true});
  assert.equal(evaluateProductionConfig({recorders: [], channels: [], statuses: []}, account).recording, false);
});
