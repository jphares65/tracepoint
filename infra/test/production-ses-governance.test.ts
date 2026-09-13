import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

type Statement = {
  Sid?: string;
  Effect: string;
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  NotResource?: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
};

function policy(name: string): { Statement: Statement[] } {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'policies', name), 'utf8'));
}

function bySid(statements: Statement[], sid: string): Statement {
  const result = statements.find((statement) => statement.Sid === sid);
  assert.ok(result, `missing ${sid}`);
  return result;
}

function actions(statement: Statement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action ?? ''];
}

function byAction(statements: Statement[], action: string): Statement {
  const result = statements.find((statement) => actions(statement).includes(action));
  assert.ok(result, `missing action ${action}`);
  return result;
}

test('production SCP permits only reviewed foundation principals and still denies SES sending', () => {
  const statements = policy('tracepoint-production-guardrails.scp.json').Statement;
  const exception = bySid(statements, 'KeepSesDisabledOutsideAuthorizedFoundationRoles');
  assert.deepEqual(exception.Action, ['ses:Create*', 'ses:Put*', 'ses:Send*', 'ses:Update*', 'ses:Delete*']);
  assert.deepEqual(exception.Condition?.ArnNotEquals?.['aws:PrincipalArn'], [
    'arn:aws:iam::193644343389:role/TracePointMigrationProduction',
    'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1',
  ]);
  assert.deepEqual(actions(bySid(statements, 'DenySesSendingUntilSeparateAuthorization')), ['ses:Send*']);
  const cognito = bySid(statements, 'KeepCognitoDisabledOutsideAuthorizedFoundationRole');
  assert.ok(actions(cognito).every((action) => action.startsWith('cognito-idp:')));
  assert.equal(cognito.Condition?.ArnNotEquals?.['aws:PrincipalArn'], 'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1');
  assert.ok(actions(bySid(statements, 'DenyProductionRegistrarMutations')).includes('route53domains:UpdateDomainNameservers'));
  assert.equal(bySid(statements, 'DenyDnsRecordChangesOutsideReviewedZone').NotResource, 'arn:aws:route53:::hostedzone/Z06725946QWMQBKB1JT8');
});

test('production boundary grants only reviewed SES foundation and account-control writes', () => {
  const statements = policy('tracepoint-production-boundary.json').Statement;
  const creation = byAction(statements, 'ses:CreateEmailIdentity');
  assert.deepEqual(actions(creation), ['ses:CreateConfigurationSet', 'ses:CreateEmailIdentity']);
  assert.equal(creation.Resource, '*');
  assert.equal(
    creation.Condition?.ArnEquals?.['aws:PrincipalArn'],
    'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1',
  );

  const resources = byAction(statements, 'ses:DeleteEmailIdentity');
  assert.deepEqual(resources.Resource, [
    'arn:aws:ses:us-east-1:193644343389:identity/tracepointhq.com',
    'arn:aws:ses:us-east-1:193644343389:configuration-set/tracepoint-production',
    'arn:aws:ses:us-east-1:193644343389:configuration-set/tracepoint-production-cognito',
  ]);

  const account = byAction(statements, 'ses:PutAccountDetails');
  assert.deepEqual(actions(account), ['ses:PutAccountDetails', 'ses:PutAccountSuppressionAttributes']);
  assert.equal(account.Condition?.ArnEquals?.['aws:PrincipalArn'], 'arn:aws:iam::193644343389:role/TracePointMigrationProduction');

  const added = [creation, resources, account].flatMap(actions);
  assert.ok(added.every((action) => action.startsWith('ses:')));
  assert.ok(!added.some((action) => action === 'ses:*' || action.startsWith('ses:Send')));
  assert.ok(!added.some((action) => /^(iam|ecs|rds|cognito|lambda|route53):/.test(action)));
});

test('production boundary confines Cognito foundation and runtime lifecycle authority', () => {
  const statements = policy('tracepoint-production-boundary.json').Statement;
  const cfn = 'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1';
  const creation = byAction(statements, 'cognito-idp:CreateUserPool');
  assert.deepEqual(actions(creation), ['cognito-idp:CreateUserPool', 'cognito-idp:CreateUserPoolClient', 'cognito-idp:CreateUserPoolDomain', 'cognito-idp:TagResource', 'cognito-idp:UntagResource']);
  assert.equal(creation.Resource, '*');
  assert.equal(creation.Condition?.ArnEquals?.['aws:PrincipalArn'], cfn);
  const resources = byAction(statements, 'cognito-idp:SetUserPoolMfaConfig');
  assert.equal(resources.Resource, 'arn:aws:cognito-idp:us-east-1:193644343389:userpool/us-east-1_*');
  assert.equal(resources.Condition?.ArnEquals?.['aws:PrincipalArn'], cfn);
  const runtime = byAction(statements, 'cognito-idp:AdminCreateUser');
  assert.deepEqual(actions(runtime), [
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
  assert.equal(runtime.Resource, 'arn:aws:cognito-idp:us-east-1:193644343389:userpool/us-east-1_diFmWDMe9');
  assert.equal(runtime.Condition?.ArnEquals?.['aws:PrincipalArn'], 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-ecs-task');
  assert.ok(!actions(runtime).includes('cognito-idp:*'));
  assert.ok(!actions(runtime).some((action) => /CreateUserPool|DeleteUserPool|AdminAddUserToGroup/.test(action)));
});
