#!/usr/bin/env node
// Read-only contract for the complete public ingress barrier. No AWS mutation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = JSON.parse(readFileSync(resolve(root, 'infra/changesets/production-maintenance-response-20260926/baseline.json')));
const template = JSON.parse(readFileSync(resolve(root, 'infra/changesets/production-maintenance-response-20260927/maintenance.json')));

export function assertIngressTemplate(value = template, pinned = baseline) {
  assert.deepEqual(Object.keys(value.Resources).sort(), [
    'PublicAppMaintenanceResponse', 'UnmatchedHostMaintenanceResponse',
  ]);
  const expectedAction = [{ Type: 'fixed-response', FixedResponseConfig: {
    StatusCode: '503', ContentType: 'text/plain', MessageBody: pinned.maintenanceMessage,
  } }];
  for (const [name, priority, conditions] of [
    ['PublicAppMaintenanceResponse', 5, [{ Field: 'host-header', HostHeaderConfig: { Values: [pinned.publicHost] } }]],
    ['UnmatchedHostMaintenanceResponse', 20, [{ Field: 'path-pattern', PathPatternConfig: { Values: ['/*'] } }]],
  ]) {
    const rule = value.Resources[name];
    assert.equal(rule.Type, 'AWS::ElasticLoadBalancingV2::ListenerRule');
    assert.equal(rule.DeletionPolicy, 'Delete');
    assert.equal(rule.Properties.ListenerArn, pinned.runtimeListenerArn);
    assert.equal(rule.Properties.Priority, priority);
    assert.deepEqual(rule.Properties.Conditions, conditions);
    assert.deepEqual(rule.Properties.Actions, expectedAction);
  }
}

export function assertIngressRules(rules, mode, pinned = baseline) {
  assert.ok(['baseline', 'active', 'restored'].includes(mode));
  const byPriority = new Map(rules.map(rule => [rule.Priority, rule]));
  assert.equal(byPriority.size, rules.length, 'Duplicate priorities');
  assert.deepEqual([...byPriority.keys()].sort(),
    (mode === 'active' ? ['5', '10', '11', '12', '13', '20', 'default'] :
      ['10', '11', '12', '13', 'default']).sort(), 'UNREVIEWED_LISTENER_RULE');
  for (const [priority, host, type, target] of [
    ['10', 'shadow.tracepointhq.com', 'forward',
      'arn:aws:elasticloadbalancing:us-east-1:193644343389:targetgroup/tracep-Targe-OJRNYZ9NIKXQ/21eca2a813ccde0d'],
    ['11', 'shadow.tracepointhq.com', 'fixed-response', null],
    ['12', 'shadow-rehearsal.tracepointhq.com', 'forward',
      'arn:aws:elasticloadbalancing:us-east-1:193644343389:targetgroup/tracep-Targe-7OUSA2XRQM5A/bd67f4134e0c93f4'],
    ['13', 'shadow-rehearsal.tracepointhq.com', 'fixed-response', null],
  ]) {
    const rule = byPriority.get(priority);
    assert.ok(rule, `Missing isolated rule ${priority}`);
    assert.ok(rule.Conditions.some(condition => condition.Field === 'host-header' &&
      JSON.stringify(condition.HostHeaderConfig?.Values) === JSON.stringify([host])));
    assert.equal(rule.Actions.length, 1);
    assert.equal(rule.Actions[0].Type, type);
    if (target) assert.equal(rule.Actions[0].TargetGroupArn, target);
    else assert.equal(rule.Actions[0].FixedResponseConfig?.StatusCode, '403');
  }
  const defaultRule = byPriority.get('default');
  assert.ok(defaultRule);
  assert.deepEqual(defaultRule.Actions, pinned.defaultActions);
  for (const [name, priority] of [['PublicAppMaintenanceResponse', '5'], ['UnmatchedHostMaintenanceResponse', '20']]) {
    const actual = byPriority.get(priority);
    if (mode !== 'active') { assert.equal(actual, undefined); continue; }
    assert.ok(actual, `Missing ${priority} maintenance rule`);
    const expected = template.Resources[name].Properties;
    assert.deepEqual(actual.Conditions, expected.Conditions);
    assert.deepEqual(actual.Actions, expected.Actions);
  }
}

export function assertChangeSet(changeSet, body) {
  if (typeof body === 'string') body = JSON.parse(body);
  assertIngressTemplate(body);
  assert.deepEqual(body, template, 'CHANGE_SET_TEMPLATE_DRIFT');
  assert.equal(changeSet.Status, 'CREATE_COMPLETE');
  assert.equal(changeSet.ExecutionStatus, 'AVAILABLE');
  assert.deepEqual(changeSet.Changes.map(change => ({
    Action: change.ResourceChange.Action,
    LogicalResourceId: change.ResourceChange.LogicalResourceId,
    ResourceType: change.ResourceChange.ResourceType,
  })).sort((a, b) => a.LogicalResourceId.localeCompare(b.LogicalResourceId)), [
    { Action: 'Add', LogicalResourceId: 'PublicAppMaintenanceResponse', ResourceType: 'AWS::ElasticLoadBalancingV2::ListenerRule' },
    { Action: 'Add', LogicalResourceId: 'UnmatchedHostMaintenanceResponse', ResourceType: 'AWS::ElasticLoadBalancingV2::ListenerRule' },
  ]);
}

function command(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${binary} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

function aws(...args) {
  return JSON.parse(command('aws', [...args, '--profile', baseline.profile, '--region', baseline.region, '--output', 'json']));
}

function probe(host) {
  // TLS/SNI remains the valid public host; only HTTP Host changes for fallback coverage.
  const marker = `TRACEPOINT_STATUS_${Date.now()}`;
  const args = ['--silent', '--show-error', '--max-time', '20', '--header', `Host: ${host}`,
    '--header', 'Cache-Control: no-cache', '--write-out', `\n${marker}=%{http_code}\n`,
    `https://${baseline.publicHost}/api/health?maintenance_ingress=${Date.now()}`];
  const output = command('curl.exe', args);
  const match = output.match(new RegExp(`\\n${marker}=(\\d{3})\\s*$`));
  assert.ok(match, 'HTTP status missing');
  return { status: Number(match[1]), body: output.slice(0, match.index).trim() };
}

export function assertExternalIngress(www, unmatched, mode, pinned = baseline) {
  if (mode === 'active') {
    for (const response of [www, unmatched]) {
      assert.equal(response.status, 503);
      assert.equal(response.body, pinned.maintenanceMessage);
    }
  } else {
    for (const response of [www, unmatched]) {
      assert.notEqual(response.status, 503);
      assert.notEqual(response.body, pinned.maintenanceMessage);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertIngressTemplate();
  const mode = process.argv[2];
  if (!mode) {
    console.log('Maintenance ingress template contract PASS; no AWS change made');
  } else {
    assert.ok(['baseline', 'pending', 'active', 'restored'].includes(mode), 'Expected baseline|pending|active|restored');
    const caller = aws('sts', 'get-caller-identity');
    assert.equal(caller.Account, baseline.account);
    const listener = aws('elbv2', 'describe-listeners', '--listener-arns', baseline.runtimeListenerArn).Listeners[0];
    assert.equal(listener.ListenerArn, baseline.runtimeListenerArn);
    assert.equal(listener.Protocol, 'HTTPS');
    assert.equal(listener.Port, 443);
    assert.deepEqual(listener.DefaultActions, baseline.defaultActions);
    const rules = aws('elbv2', 'describe-rules', '--listener-arn', baseline.runtimeListenerArn).Rules;
    assertIngressRules(rules, mode === 'pending' ? 'baseline' : mode);
    if (mode === 'pending') {
      const stackName = 'tracepoint-production-maintenance-response-20260927';
      const changeSetArn = 'arn:aws:cloudformation:us-east-1:193644343389:changeSet/activate-complete-ingress-503-20260927/d1ae3fda-1505-4d28-b77c-16a55fb7c6ec';
      const stack = aws('cloudformation', 'describe-stacks', '--stack-name', stackName).Stacks[0];
      assert.equal(stack.StackStatus, 'REVIEW_IN_PROGRESS');
      assert.equal(stack.RoleARN, 'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1');
      assert.deepEqual(aws('cloudformation', 'list-stack-resources', '--stack-name', stackName).StackResourceSummaries, []);
      const changeSet = aws('cloudformation', 'describe-change-set', '--change-set-name', changeSetArn,
        '--stack-name', stackName);
      const body = aws('cloudformation', 'get-template', '--change-set-name', changeSetArn,
        '--stack-name', stackName).TemplateBody;
      assertChangeSet(changeSet, body);
    }
    const www = probe(baseline.publicHost);
    const unmatched = probe('unmatched.tracepointhq.com');
    assertExternalIngress(www, unmatched, mode === 'pending' ? 'baseline' : mode);
    console.log(JSON.stringify({ mode, listener: baseline.runtimeListenerArn,
      defaultForwardUnchanged: true, wwwStatus: www.status, unmatchedHostStatus: unmatched.status }));
  }
}
