import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { assertIngressTemplate, assertIngressRules, assertChangeSet, assertExternalIngress,
  assertEcsIngress } from './check-production-maintenance-ingress.mjs';

const template = JSON.parse(readFileSync(resolve('infra/changesets/production-maintenance-response-20260927/maintenance.json')));
const baseline = JSON.parse(readFileSync(resolve('infra/changesets/production-maintenance-response-20260926/baseline.json')));
const copy = value => structuredClone(value);
const isolatedRules = [
  { Priority: '10', Conditions: [{ Field: 'host-header', HostHeaderConfig: { Values: ['shadow.tracepointhq.com'] } }],
    Actions: [{ Type: 'forward', TargetGroupArn: 'arn:aws:elasticloadbalancing:us-east-1:193644343389:targetgroup/tracep-Targe-OJRNYZ9NIKXQ/21eca2a813ccde0d' }] },
  { Priority: '11', Conditions: [{ Field: 'host-header', HostHeaderConfig: { Values: ['shadow.tracepointhq.com'] } }],
    Actions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '403' } }] },
  { Priority: '12', Conditions: [{ Field: 'host-header', HostHeaderConfig: { Values: ['shadow-rehearsal.tracepointhq.com'] } }],
    Actions: [{ Type: 'forward', TargetGroupArn: 'arn:aws:elasticloadbalancing:us-east-1:193644343389:targetgroup/tracep-Targe-7OUSA2XRQM5A/bd67f4134e0c93f4' }] },
  { Priority: '13', Conditions: [{ Field: 'host-header', HostHeaderConfig: { Values: ['shadow-rehearsal.tracepointhq.com'] } }],
    Actions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '403' } }] },
];
const activeRules = () => [
  ...copy(isolatedRules),
  ...Object.values(template.Resources).map(rule => ({ Priority: String(rule.Properties.Priority),
    Conditions: copy(rule.Properties.Conditions), Actions: copy(rule.Properties.Actions) })),
  { Priority: 'default', Actions: copy(baseline.defaultActions) },
];

test('template pins exactly two 503 rules and leaves default listener unmanaged', () => {
  assert.doesNotThrow(() => assertIngressTemplate());
  const altered = copy(template);
  altered.Resources.UnmatchedHostMaintenanceResponse.Properties.Priority = 4;
  assert.throws(() => assertIngressTemplate(altered));
  altered.Resources.UnmatchedHostMaintenanceResponse.Properties.Priority = 20;
  altered.Resources.Unrelated = {};
  assert.throws(() => assertIngressTemplate(altered));
});

test('active state covers public and fallback while preserving isolated rules and exact default forward', () => {
  assert.doesNotThrow(() => assertIngressRules(activeRules(), 'active'));
  const awsShape = activeRules();
  for (const priority of ['5', '20']) {
    const condition = awsShape.find(rule => rule.Priority === priority).Conditions[0];
    condition.Values = copy(condition.HostHeaderConfig?.Values ?? condition.PathPatternConfig?.Values);
  }
  assert.doesNotThrow(() => assertIngressRules(awsShape, 'active'));
  awsShape.find(rule => rule.Priority === '5').Conditions[0].Values = ['other.example'];
  assert.throws(() => assertIngressRules(awsShape, 'active'));
  const missing = activeRules().filter(rule => rule.Priority !== '20');
  assert.throws(() => assertIngressRules(missing, 'active'));
  const changed = activeRules();
  changed.find(rule => rule.Priority === 'default').Actions = [];
  assert.throws(() => assertIngressRules(changed, 'active'));
  const bypass = activeRules();
  bypass.find(rule => rule.Priority === '20').Conditions[0].PathPatternConfig.Values = ['/landing'];
  assert.throws(() => assertIngressRules(bypass, 'active'));
  const baselineRules = activeRules().filter(rule => !['5', '20'].includes(rule.Priority));
  assert.doesNotThrow(() => assertIngressRules(baselineRules, 'baseline'));
  assert.doesNotThrow(() => assertIngressRules(baselineRules, 'restored'));
});

test('change set is exactly the two reviewed rule additions', () => {
  const changes = Object.keys(template.Resources).map(LogicalResourceId => ({ ResourceChange: {
    Action: 'Add', LogicalResourceId, ResourceType: 'AWS::ElasticLoadBalancingV2::ListenerRule',
  } }));
  assert.doesNotThrow(() => assertChangeSet({ Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', Changes: changes }, template));
  assert.throws(() => assertChangeSet({ Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', Changes: changes.slice(0, 1) }, template));
});

test('external verifier requires both public and unmatched hosts to receive exact 503', () => {
  const maintenance = { status: 503, body: baseline.maintenanceMessage };
  assert.doesNotThrow(() => assertExternalIngress(maintenance, maintenance, 'active'));
  assert.throws(() => assertExternalIngress(maintenance, { status: 200, body: 'ok' }, 'active'));
  assert.doesNotThrow(() => assertExternalIngress({ status: 200, body: 'ok' }, { status: 200, body: 'ok' }, 'restored'));
});

test('public task ingress must be limited to the exact ALB security group', () => {
  const sample = {
    service: { serviceName: 'tracepoint-production', desiredCount: 1, runningCount: 1,
      networkConfiguration: { awsvpcConfiguration: { securityGroups: ['sg-0ccc72ae99581cdfd'] } } },
    task: { lastStatus: 'RUNNING' },
    networkInterface: { Groups: [{ GroupId: 'sg-0ccc72ae99581cdfd' }] },
    loadBalancer: { SecurityGroups: ['sg-0a7ba07ccc254d6b6'] },
    securityGroup: { IpPermissions: [{ IpProtocol: 'tcp', FromPort: 3000, ToPort: 3000,
      UserIdGroupPairs: [{ GroupId: 'sg-0a7ba07ccc254d6b6' }],
      IpRanges: [], Ipv6Ranges: [], PrefixListIds: [] }] },
  };
  assert.doesNotThrow(() => assertEcsIngress(sample));
  const drift = copy(sample);
  drift.securityGroup.IpPermissions[0].IpRanges.push({ CidrIp: '0.0.0.0/0' });
  assert.throws(() => assertEcsIngress(drift));
});
