import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPROVED_ALARMS, assertApprovedChangeSet, assertApprovedWorkerTemplate, assertPatchIsExact, buildPatchedWorkerTemplate } from './staging-ses-worker-alarm-patch-core.mjs';

function template() {
  const resources = { Worker: { Type: 'AWS::Lambda::Function', Properties: { Runtime: 'nodejs24.x' } } };
  for (const [logicalId, contract] of Object.entries(APPROVED_ALARMS)) {
    resources[logicalId] = { Type: 'AWS::CloudWatch::Alarm', Properties: {
      MetricName: contract.metricName, Namespace: contract.namespace, Threshold: contract.threshold,
      ComparisonOperator: contract.comparison, Period: contract.period, EvaluationPeriods: contract.evaluationPeriods,
      Dimensions: [{ Name: 'RequiredDimension', Value: 'preserved' }],
    } };
  }
  resources.QueueAgeAlarmC3F61350 = { Type: 'AWS::CloudWatch::Alarm', Properties: { MetricName: 'ApproximateAgeOfOldestMessage', Namespace: 'AWS/SQS', Threshold: 300, ComparisonOperator: 'GreaterThanOrEqualToThreshold', Period: 300, EvaluationPeriods: 2, Dimensions: [{ Name: 'QueueName', Value: 'preserved' }] } };
  return { AWSTemplateFormatVersion: '2010-09-09', Parameters: { Keep: { Type: 'String' } }, Outputs: { Keep: { Value: 'preserved' } }, Resources: resources };
}

function changeSet() {
  return { Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', Changes: Object.keys(APPROVED_ALARMS).map((logicalId) => ({ ResourceChange: {
    Action: 'Modify', ResourceType: 'AWS::CloudWatch::Alarm', LogicalResourceId: logicalId, Replacement: 'False',
    Details: [{ Target: { Attribute: 'Properties', Name: 'TreatMissingData' } }],
  } })) };
}

test('patch adds only notBreaching to the three approved idle-worker alarms', () => {
  const before = template();
  const after = buildPatchedWorkerTemplate(before);
  assertApprovedWorkerTemplate(before);
  assertPatchIsExact(before, after);
  assert.equal(after.Resources.QueueAgeAlarmC3F61350.Properties.TreatMissingData, undefined);
});

for (const [name, mutate] of [
  ['Lambda property change', (value) => { value.Resources.Worker.Properties.Runtime = 'nodejs22.x'; }],
  ['alarm metric change', (value) => { value.Resources.DeadLetterAlarmBB7AE56D.Properties.MetricName = 'MessagesDeleted'; }],
  ['threshold change', (value) => { value.Resources.WorkerErrorsAlarm1932B217.Properties.Threshold = 2; }],
  ['fourth alarm change', (value) => { value.Resources.QueueAgeAlarmC3F61350.Properties.TreatMissingData = 'notBreaching'; }],
  ['resource addition', (value) => { value.Resources.NewResource = { Type: 'AWS::SQS::Queue', Properties: {} }; }],
  ['resource deletion', (value) => { delete value.Resources.Worker; }],
  ['alarm name change', (value) => { value.Resources.WorkerThrottlesAlarm3D9E14E4.Properties.AlarmName = 'renamed'; }],
  ['other missing-data value', (value) => { value.Resources.DeadLetterAlarmBB7AE56D.Properties.TreatMissingData = 'breaching'; }],
]) {
  test(`patch guard rejects ${name}`, () => {
    const before = template();
    const after = buildPatchedWorkerTemplate(before);
    mutate(after);
    assert.throws(() => assertPatchIsExact(before, after));
  });
}

test('change-set guard accepts exactly three in-place TreatMissingData changes', () => assert.doesNotThrow(() => assertApprovedChangeSet(changeSet())));
for (const [name, mutate] of [
  ['replacement', (value) => { value.Changes[0].ResourceChange.Replacement = 'True'; }],
  ['unapproved resource', (value) => { value.Changes[0].ResourceChange.LogicalResourceId = 'QueueAgeAlarmC3F61350'; }],
  ['non-property detail', (value) => { value.Changes[0].ResourceChange.Details[0].Target.Name = 'Threshold'; }],
]) test(`change-set guard rejects ${name}`, () => {
  const value = changeSet(); mutate(value); assert.throws(() => assertApprovedChangeSet(value));
});
