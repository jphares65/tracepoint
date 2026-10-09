import assert from 'node:assert/strict';

export const STACK_NAME = 'tracepoint-staging-ses-feedback-worker';
export const APPROVED_ALARMS = Object.freeze({
  DeadLetterAlarmBB7AE56D: {
    metricName: 'ApproximateNumberOfMessagesVisible', namespace: 'AWS/SQS', threshold: 1,
    comparison: 'GreaterThanOrEqualToThreshold', period: 300, evaluationPeriods: 1,
  },
  WorkerErrorsAlarm1932B217: {
    metricName: 'Errors', namespace: 'AWS/Lambda', threshold: 1,
    comparison: 'GreaterThanOrEqualToThreshold', period: 300, evaluationPeriods: 1,
  },
  WorkerThrottlesAlarm3D9E14E4: {
    metricName: 'Throttles', namespace: 'AWS/Lambda', threshold: 1,
    comparison: 'GreaterThanOrEqualToThreshold', period: 300, evaluationPeriods: 1,
  },
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function changes(before, after, path = '') {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return [{ path, before, after }];
    return before.flatMap((value, index) => changes(value, after[index], `${path}[${index}]`));
  }
  if (isObject(before) && isObject(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) => changes(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [{ path, before, after }];
}

export function assertApprovedWorkerTemplate(template) {
  assert.ok(isObject(template) && isObject(template.Resources), 'deployed template must contain Resources');
  for (const [logicalId, contract] of Object.entries(APPROVED_ALARMS)) {
    const resource = template.Resources[logicalId];
    assert.equal(resource?.Type, 'AWS::CloudWatch::Alarm', `${logicalId} must remain a CloudWatch alarm`);
    const properties = resource.Properties;
    assert.equal(properties?.MetricName, contract.metricName, `${logicalId} metric must match the deployed contract`);
    assert.equal(properties?.Namespace, contract.namespace, `${logicalId} namespace must match the deployed contract`);
    assert.equal(properties?.Threshold, contract.threshold, `${logicalId} threshold must match the deployed contract`);
    assert.equal(properties?.ComparisonOperator, contract.comparison, `${logicalId} comparison must match the deployed contract`);
    assert.equal(properties?.Period, contract.period, `${logicalId} period must match the deployed contract`);
    assert.equal(properties?.EvaluationPeriods, contract.evaluationPeriods, `${logicalId} evaluation periods must match the deployed contract`);
    assert.equal(properties?.TreatMissingData, undefined, `${logicalId} must begin with the deployed default missing-data policy`);
    assert.ok(Array.isArray(properties?.Dimensions) && properties.Dimensions.length > 0, `${logicalId} must retain its metric dimensions`);
  }
}

export function buildPatchedWorkerTemplate(deployedTemplate) {
  assertApprovedWorkerTemplate(deployedTemplate);
  const patched = structuredClone(deployedTemplate);
  for (const logicalId of Object.keys(APPROVED_ALARMS)) {
    patched.Resources[logicalId].Properties.TreatMissingData = 'notBreaching';
  }
  assertPatchIsExact(deployedTemplate, patched);
  return patched;
}

export function assertPatchIsExact(before, after) {
  assert.equal(Object.keys(before.Resources ?? {}).length, Object.keys(after.Resources ?? {}).length, 'resource count must not change');
  assert.deepEqual(Object.keys(after.Resources ?? {}).sort(), Object.keys(before.Resources ?? {}).sort(), 'resource logical IDs must not change');
  const observed = changes(before, after);
  const expectedPaths = Object.keys(APPROVED_ALARMS)
    .map((logicalId) => `Resources.${logicalId}.Properties.TreatMissingData`)
    .sort();
  assert.deepEqual(observed.map((entry) => entry.path).sort(), expectedPaths, 'only the three approved TreatMissingData paths may change');
  for (const entry of observed) {
    assert.equal(entry.before, undefined, `${entry.path} must be an addition to the deployed template`);
    assert.equal(entry.after, 'notBreaching', `${entry.path} must set notBreaching`);
  }
}

export function assertApprovedChangeSet(changeSet) {
  assert.equal(changeSet.Status, 'CREATE_COMPLETE', 'change set creation must complete');
  assert.equal(changeSet.ExecutionStatus, 'AVAILABLE', 'change set must be available for guarded execution');
  assert.equal(changeSet.Changes?.length, 3, 'change set must modify exactly three resources');
  const expected = Object.keys(APPROVED_ALARMS).sort();
  const observed = [];
  for (const change of changeSet.Changes) {
    const resource = change.ResourceChange;
    assert.equal(resource?.Action, 'Modify', 'change set may only modify existing resources');
    assert.equal(resource?.ResourceType, 'AWS::CloudWatch::Alarm', 'change set may only modify CloudWatch alarms');
    assert.equal(resource?.Replacement, 'False', 'alarm modification must be in place without replacement');
    assert.ok(APPROVED_ALARMS[resource?.LogicalResourceId], `unapproved resource ${resource?.LogicalResourceId ?? '<missing>'}`);
    assert.equal(resource.Details?.length, 1, `${resource.LogicalResourceId} must have exactly one changed property`);
    const target = resource.Details[0]?.Target;
    assert.equal(target?.Attribute, 'Properties', `${resource.LogicalResourceId} must only change resource properties`);
    assert.equal(target?.Name, 'TreatMissingData', `${resource.LogicalResourceId} must only change TreatMissingData`);
    observed.push(resource.LogicalResourceId);
  }
  assert.deepEqual(observed.sort(), expected, 'change set resource set must exactly match the approved alarms');
}
