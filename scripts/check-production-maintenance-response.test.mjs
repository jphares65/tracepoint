import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { assertLiveContract, assertPendingChangeSet, assertTemplateContract } from './check-production-maintenance-response.mjs';

const directory = resolve('infra/changesets/production-maintenance-response-20260926');
const pinned = JSON.parse(readFileSync(resolve(directory, 'baseline.json'), 'utf8'));
const template = JSON.parse(readFileSync(resolve(directory, 'maintenance.json'), 'utf8'));
const copy = value => structuredClone(value);

function fixture(active = false) {
  const rule = template.Resources.PublicAppMaintenanceResponse.Properties;
  return {
    caller: { Account: pinned.account },
    resource: { StackResourceDetail: { PhysicalResourceId: pinned.runtimeListenerArn,
      ResourceType: 'AWS::ElasticLoadBalancingV2::Listener',
      DriftInformation: { StackResourceDriftStatus: 'IN_SYNC' } } },
    listener: { ListenerArn: pinned.runtimeListenerArn, Port: 443, Protocol: 'HTTPS',
      DefaultActions: copy(pinned.defaultActions) },
    rules: [
      ...['10', '11', '12', '13'].map(Priority => ({ Priority })),
      { Priority: 'default', Actions: copy(pinned.defaultActions) },
      ...(active ? [{ Priority: pinned.maintenancePriority,
        Conditions: copy(rule.Conditions), Actions: copy(rule.Actions) }] : []),
    ],
    dns: { Name: `${pinned.publicHost}.`, Type: 'A', AliasTarget: {
      DNSName: pinned.publicAliasDnsName, EvaluateTargetHealth: false,
    } },
    health: [{ TargetHealth: { State: 'healthy' } }],
    service: { serviceName: 'tracepoint-production', desiredCount: 1, runningCount: 1,
      loadBalancers: [{ targetGroupArn: pinned.publicTargetGroupArn }] },
  };
}

test('template adds only exact-host 503 rule, never modifies default listener', () => {
  assert.doesNotThrow(() => assertTemplateContract(template, pinned));
  const wildcard = copy(template);
  wildcard.Resources.PublicAppMaintenanceResponse.Properties.Conditions[0].HostHeaderConfig.Values = ['*.tracepointhq.com'];
  assert.throws(() => assertTemplateContract(wildcard, pinned));
  const broader = copy(template);
  broader.Resources.Unrelated = { Type: 'AWS::S3::Bucket' };
  assert.throws(() => assertTemplateContract(broader, pinned));
});

test('baseline and exact reversal retain original forward/health/service', () => {
  assert.doesNotThrow(() => assertLiveContract(fixture(), 'baseline', pinned));
  assert.doesNotThrow(() => assertLiveContract(fixture(), 'restored', pinned));
});

test('active state requires host-only 503 while default forward stays exact', () => {
  assert.doesNotThrow(() => assertLiveContract(fixture(true), 'active', pinned));
  const changedDefault = fixture(true);
  changedDefault.listener.DefaultActions = [{ Type: 'fixed-response' }];
  assert.throws(() => assertLiveContract(changedDefault, 'active', pinned));
  const changedHost = fixture(true);
  changedHost.rules.find(rule => rule.Priority === '5').Conditions[0].HostHeaderConfig.Values = ['tracepointhq.com'];
  assert.throws(() => assertLiveContract(changedHost, 'active', pinned));
  const unhealthy = fixture(true);
  unhealthy.health[0].TargetHealth.State = 'unused';
  assert.throws(() => assertLiveContract(unhealthy, 'active', pinned));
});

test('pending change set must be available and contain only the reviewed rule', () => {
  const stack = { StackStatus: 'REVIEW_IN_PROGRESS', StackId:
    'arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260926/863d2100-ba27-11f1-aed4-0affffd37699' };
  const changeSet = { Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', Changes: [{
    ResourceChange: { Action: 'Add', LogicalResourceId: 'PublicAppMaintenanceResponse',
      ResourceType: 'AWS::ElasticLoadBalancingV2::ListenerRule', Scope: [], Details: [] },
  }] };
  assert.doesNotThrow(() => assertPendingChangeSet(changeSet, template, stack, pinned));
  const extra = copy(changeSet);
  extra.Changes.push(copy(extra.Changes[0]));
  assert.throws(() => assertPendingChangeSet(extra, template, stack, pinned));
  const altered = copy(template);
  altered.Resources.PublicAppMaintenanceResponse.Properties.Priority = 6;
  assert.throws(() => assertPendingChangeSet(changeSet, altered, stack, pinned));
});
