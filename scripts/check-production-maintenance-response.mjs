#!/usr/bin/env node
// Read-only verification of cutover runbook section 2.1. Never changes AWS state.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'infra/changesets/production-maintenance-response-20260926');
const baseline = JSON.parse(readFileSync(resolve(directory, 'baseline.json'), 'utf8'));
const maintenance = JSON.parse(readFileSync(resolve(directory, 'maintenance.json'), 'utf8'));

export function assertTemplateContract(template = maintenance, pinned = baseline) {
  assert.deepEqual(Object.keys(template.Resources), ['PublicAppMaintenanceResponse']);
  const rule = template.Resources.PublicAppMaintenanceResponse;
  assert.equal(rule.Type, 'AWS::ElasticLoadBalancingV2::ListenerRule');
  assert.equal(rule.DeletionPolicy, 'Delete');
  assert.equal(rule.Properties.ListenerArn, pinned.runtimeListenerArn);
  assert.equal(String(rule.Properties.Priority), pinned.maintenancePriority);
  assert.deepEqual(rule.Properties.Conditions, [{
    Field: 'host-header', HostHeaderConfig: { Values: [pinned.publicHost] },
  }]);
  assert.deepEqual(rule.Properties.Actions, [{
    Type: 'fixed-response', FixedResponseConfig: {
      StatusCode: '503', ContentType: 'text/plain', MessageBody: pinned.maintenanceMessage,
    },
  }]);
  assert.equal(template.Resources.ServiceLBPublicListener46709EAA, undefined);
}

export function assertPendingChangeSet(changeSet, templateBody, stack, pinned = baseline) {
  assert.equal(stack.StackId,
    'arn:aws:cloudformation:us-east-1:193644343389:stack/tracepoint-production-maintenance-response-20260926/863d2100-ba27-11f1-aed4-0affffd37699');
  assert.equal(stack.StackStatus, 'REVIEW_IN_PROGRESS');
  assert.equal(changeSet.Status, 'CREATE_COMPLETE');
  assert.equal(changeSet.ExecutionStatus, 'AVAILABLE');
  assert.deepEqual(changeSet.Changes.map(change => change.ResourceChange), [{
    Action: 'Add', LogicalResourceId: 'PublicAppMaintenanceResponse',
    ResourceType: 'AWS::ElasticLoadBalancingV2::ListenerRule',
    Scope: [], Details: [],
  }]);
  const actual = typeof templateBody === 'string' ? JSON.parse(templateBody) : templateBody;
  assert.deepEqual(actual, maintenance);
  assert.equal(actual.Resources.PublicAppMaintenanceResponse.Properties.ListenerArn, pinned.runtimeListenerArn);
}

export function assertLiveContract({ caller, resource, listener, rules, dns, health, service }, mode, pinned = baseline) {
  assert.ok(['baseline', 'active', 'restored'].includes(mode));
  assert.equal(caller.Account, pinned.account);
  const managed = resource.StackResourceDetail;
  assert.equal(managed.PhysicalResourceId, pinned.runtimeListenerArn);
  assert.equal(managed.ResourceType, 'AWS::ElasticLoadBalancingV2::Listener');
  assert.equal(managed.DriftInformation.StackResourceDriftStatus, 'IN_SYNC');
  assert.equal(listener.ListenerArn, pinned.runtimeListenerArn);
  assert.equal(listener.Protocol, 'HTTPS');
  assert.equal(listener.Port, 443);
  assert.deepEqual(listener.DefaultActions, pinned.defaultActions);
  assert.equal(dns.Name, `${pinned.publicHost}.`);
  assert.equal(dns.Type, 'A');
  assert.equal(dns.AliasTarget.DNSName.toLowerCase(), pinned.publicAliasDnsName);
  assert.equal(dns.AliasTarget.EvaluateTargetHealth, false);
  assert.ok(health.length > 0);
  assert.ok(health.every(item => item.TargetHealth.State === 'healthy'));
  assert.equal(service.serviceName, 'tracepoint-production');
  assert.equal(service.desiredCount, 1);
  assert.equal(service.runningCount, 1);
  assert.equal(service.loadBalancers.length, 1);
  assert.equal(service.loadBalancers[0].targetGroupArn, pinned.publicTargetGroupArn);
  const occupied = rules.filter(rule => rule.Priority === pinned.maintenancePriority);
  if (mode === 'active') {
    assert.equal(occupied.length, 1);
    assert.deepEqual(occupied[0].Conditions[0].HostHeaderConfig.Values, [pinned.publicHost]);
    assert.deepEqual(occupied[0].Actions, maintenance.Resources.PublicAppMaintenanceResponse.Properties.Actions);
  } else {
    assert.equal(occupied.length, 0);
  }
  for (const priority of ['10', '11', '12', '13']) {
    assert.equal(rules.filter(rule => rule.Priority === priority).length, 1);
  }
}

function aws(...args) {
  const result = spawnSync('aws', [...args, '--profile', baseline.profile, '--region', baseline.region, '--output', 'json'], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`AWS read failed (${args[0]} ${args[1]}): ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

function externalProbe(mode) {
  const path = `/landing?tracepoint_maintenance_probe=${randomUUID()}`;
  const result = spawnSync('curl.exe', ['--silent', '--show-error', '--max-time', '20',
    '--header', 'Cache-Control: no-cache', '--write-out', '\nTRACEPOINT_HTTP_STATUS=%{http_code}\n',
    `https://${baseline.publicHost}${path}`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`External HTTPS probe failed: ${result.stderr.trim()}`);
  const match = result.stdout.match(/\nTRACEPOINT_HTTP_STATUS=(\d{3})\s*$/);
  assert.ok(match, 'External HTTPS probe status missing');
  const body = result.stdout.slice(0, match.index).trim();
  const status = Number(match[1]);
  if (mode === 'active') {
    assert.equal(status, 503);
    assert.equal(body, baseline.maintenanceMessage);
  } else {
    assert.notEqual(status, 503);
    assert.notEqual(body, baseline.maintenanceMessage);
    assert.ok(status >= 200 && status < 400, `Public baseline status ${status} is not healthy`);
  }
  return { path, status, maintenanceBodyMatched: body === baseline.maintenanceMessage };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!['baseline', 'active', 'restored'].includes(mode)) {
    throw new Error('Usage: node scripts/check-production-maintenance-response.mjs baseline|active|restored');
  }
  assertTemplateContract();
  const caller = aws('sts', 'get-caller-identity');
  const resource = aws('cloudformation', 'describe-stack-resource', '--stack-name', baseline.runtimeStack,
    '--logical-resource-id', baseline.runtimeListenerLogicalId);
  const listener = aws('elbv2', 'describe-listeners', '--listener-arns', baseline.runtimeListenerArn).Listeners[0];
  const rules = aws('elbv2', 'describe-rules', '--listener-arn', baseline.runtimeListenerArn).Rules;
  const dns = aws('route53', 'list-resource-record-sets', '--hosted-zone-id', baseline.publicHostedZoneId)
    .ResourceRecordSets.find(record => record.Name === `${baseline.publicHost}.` && record.Type === 'A');
  const health = aws('elbv2', 'describe-target-health', '--target-group-arn', baseline.publicTargetGroupArn)
    .TargetHealthDescriptions;
  const service = aws('ecs', 'describe-services', '--cluster', 'tracepoint-production',
    '--services', 'tracepoint-production').services[0];
  assertLiveContract({ caller, resource, listener, rules, dns, health, service }, mode);
  if (mode === 'baseline') {
    const changeSetArn = 'arn:aws:cloudformation:us-east-1:193644343389:changeSet/activate-www-503-20260926/1330c60b-9066-41fa-a923-0a533a2ea7a6';
    const changeSet = aws('cloudformation', 'describe-change-set', '--change-set-name', changeSetArn,
      '--stack-name', baseline.maintenanceStack);
    const pending = aws('cloudformation', 'get-template', '--change-set-name', changeSetArn,
      '--stack-name', baseline.maintenanceStack).TemplateBody;
    const stack = aws('cloudformation', 'describe-stacks', '--stack-name', baseline.maintenanceStack).Stacks[0];
    assertPendingChangeSet(changeSet, pending, stack);
  }
  const external = externalProbe(mode);
  console.log(JSON.stringify({ mode, account: caller.Account, listener: listener.ListenerArn,
    defaultForwardUnchanged: true, publicTargetHealthy: true, publicEcsRunning: true,
    maintenancePriority: baseline.maintenancePriority, external }, null, 2));
}
