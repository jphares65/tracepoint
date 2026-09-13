import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const boundary = JSON.parse(readFileSync('infra/policies/tracepoint-production-boundary.json', 'utf8'));
const guardrails = JSON.parse(readFileSync('infra/policies/tracepoint-production-guardrails.scp.json', 'utf8'));
const trust = JSON.parse(readFileSync('infra/policies/tracepoint-production-role-trust.json', 'utf8'));
const hasAction = (statement, action) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes(action);

test('production boundary reserves account, DNS, identity-provider and email mutations', () => {
  const reserved = boundary.Statement.find(statement => Array.isArray(statement.NotAction) && statement.NotAction.includes('organizations:*'));
  for (const action of ['organizations:*', 'account:*', 'route53:*', 'cognito-idp:*', 'ses:*', 'iam:PassRole', 'iam:CreateServiceLinkedRole', 'iam:CreateUser', 'iam:CreateAccessKey']) assert.ok(reserved.NotAction.includes(action));
  assert.ok(boundary.Statement.every(statement => !(statement.Effect === 'Allow' && statement.Action === '*' && statement.Resource === '*')));
  const passRole = boundary.Statement.find(statement => hasAction(statement, 'iam:PassRole'));
  assert.ok(passRole.Resource.every(resource => resource.startsWith('arn:aws:iam::193644343389:role/')));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('cloudformation.amazonaws.com'));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('cloudtrail.amazonaws.com'));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('config.amazonaws.com'));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('vpc-flow-logs.amazonaws.com'));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('lambda.amazonaws.com'));
  assert.ok(passRole.Condition.StringEquals['iam:PassedToService'].includes('backup.amazonaws.com'));
  const serviceLinkedRole = boundary.Statement.find(statement => hasAction(statement, 'iam:CreateServiceLinkedRole'));
  assert.ok(serviceLinkedRole.Condition.StringEquals['iam:AWSServiceName'].includes('ecs.amazonaws.com'));
  assert.ok(serviceLinkedRole.Condition.StringEquals['iam:AWSServiceName'].includes('ecs.application-autoscaling.amazonaws.com'));
  assert.ok(!serviceLinkedRole.Condition.StringEquals['iam:AWSServiceName'].includes('application-autoscaling.amazonaws.com'));
  assert.ok(serviceLinkedRole.Condition.StringEquals['iam:AWSServiceName'].includes('securityhubv2.amazonaws.com'));
  assert.ok(serviceLinkedRole.Condition.StringEquals['iam:AWSServiceName'].includes('rds.amazonaws.com'));
  assert.ok(serviceLinkedRole.Condition.StringEquals['iam:AWSServiceName'].includes('email.cognito-idp.amazonaws.com'));
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
  const configScope = guardrails.Statement.find(statement => statement.Sid === 'DenyUnauthorizedConfigScopeChanges');
  assert.deepEqual(configScope.Action, ['config:PutConfigurationRecorder', 'config:PutDeliveryChannel']);
  assert.deepEqual(configScope.Condition.ArnNotLike['aws:PrincipalArn'], [
    'arn:aws:iam::193644343389:role/TracePointMigrationProduction',
    'arn:aws:iam::193644343389:role/cdk-*-cfn-exec-role-193644343389-us-east-1',
  ]);
  const region = guardrails.Statement.find(statement => statement.Sid === 'DenyOutsideUsEast1');
  assert.equal(region.Condition.StringNotEquals['aws:RequestedRegion'], 'us-east-1');
  assert.ok(region.NotAction.includes('iam:*'));
  assert.ok(region.NotAction.includes('organizations:*'));
  const cognito = guardrails.Statement.find(statement => statement.Sid === 'KeepCognitoDisabledOutsideAuthorizedFoundationRole');
  assert.deepEqual(cognito.Condition.ArnNotEquals['aws:PrincipalArn'], 'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1');
});

test('production boundary grants only reviewed runtime Cognito lifecycle actions to one role and pool', () => {
  const lifecycle = boundary.Statement.find(statement => hasAction(statement, 'cognito-idp:AdminCreateUser'));
  assert.deepEqual(lifecycle.Action, [
    'cognito-idp:AdminCreateUser',
    'cognito-idp:AdminDeleteUser',
    'cognito-idp:AdminDisableUser',
    'cognito-idp:AdminEnableUser',
    'cognito-idp:AdminGetUser',
    'cognito-idp:AdminResetUserPassword',
    'cognito-idp:AdminSetUserPassword',
    'cognito-idp:AdminUpdateUserAttributes',
    'cognito-idp:AdminUserGlobalSignOut',
  ]);
  assert.equal(lifecycle.Resource, 'arn:aws:cognito-idp:us-east-1:193644343389:userpool/us-east-1_diFmWDMe9');
  assert.equal(lifecycle.Condition.ArnEquals['aws:PrincipalArn'], 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-ecs-task');
  assert.ok(!lifecycle.Action.includes('cognito-idp:*'));
  assert.ok(!lifecycle.Action.some(action => /CreateUserPool|DeleteUserPool|AdminAddUserToGroup/.test(action)));
  assert.ok(!lifecycle.Action.some(action => !action.startsWith('cognito-idp:')));
});
