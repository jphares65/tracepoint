import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const boundary = JSON.parse(readFileSync('infra/policies/tracepoint-production-boundary.json', 'utf8'));
const guardrails = JSON.parse(readFileSync('infra/policies/tracepoint-production-guardrails.scp.json', 'utf8'));
const trust = JSON.parse(readFileSync('infra/policies/tracepoint-production-role-trust.json', 'utf8'));

test('production boundary reserves account, DNS, identity-provider and email mutations', () => {
  const reserved = boundary.Statement.find(statement => statement.Sid === 'AllowProductionAdministrationExceptReservedChanges');
  for (const action of ['organizations:*', 'account:*', 'route53:*', 'cognito-idp:*', 'ses:*', 'iam:PassRole', 'iam:CreateServiceLinkedRole', 'iam:CreateUser', 'iam:CreateAccessKey']) assert.ok(reserved.NotAction.includes(action));
  assert.ok(boundary.Statement.every(statement => !(statement.Effect === 'Allow' && statement.Action === '*' && statement.Resource === '*')));
  const passRole = boundary.Statement.find(statement => statement.Sid === 'AllowPassOnlyTracePointAndCdkRoles');
  assert.ok(passRole.Resource.every(resource => resource.startsWith('arn:aws:iam::193644343389:role/')));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('cloudformation.amazonaws.com'));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('cloudtrail.amazonaws.com'));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('config.amazonaws.com'));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('vpc-flow-logs.amazonaws.com'));
  const serviceLinkedRole = boundary.Statement.find(statement => statement.Sid === 'AllowRequiredServiceLinkedRoles');
  assert.ok(serviceLinkedRole.Condition.StringEquals['iam:AWSServiceName'].includes('ecs.amazonaws.com'));
  assert.ok(serviceLinkedRole.Condition.StringEquals['iam:AWSServiceName'].includes('securityhubv2.amazonaws.com'));
});

test('production migration role trusts only the exact management SSO role', () => {
  assert.deepEqual(trust.Statement, [{
    Sid: 'AllowExactManagementSsoMigrationRole',
    Effect: 'Allow',
    Principal: {
      AWS: 'arn:aws:iam::265544358665:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_TracePointMigrationStaging_15025ed1776203c8',
    },
    Action: 'sts:AssumeRole',
  }]);
});

test('production SCP confines regions and protects explicit owner-controlled gates', () => {
  const text = JSON.stringify(guardrails);
  for (const action of ['organizations:LeaveOrganization', 'account:CloseAccount', 'route53:ChangeResourceRecordSets', 'cloudtrail:StopLogging', 'guardduty:DeleteDetector', 'securityhub:DisableSecurityHub', 'securityhub:DisableSecurityHubV2']) assert.ok(text.includes(action));
  const region = guardrails.Statement.find(statement => statement.Sid === 'DenyOutsideUsEast1');
  assert.equal(region.Condition.StringNotEquals['aws:RequestedRegion'], 'us-east-1');
  assert.ok(region.NotAction.includes('iam:*'));
  assert.ok(region.NotAction.includes('organizations:*'));
});
