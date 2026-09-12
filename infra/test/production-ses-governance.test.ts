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

test('production SCP permits only the reviewed SES principals and still denies sending', () => {
  const statements = policy('tracepoint-production-guardrails.scp.json').Statement;
  const exception = bySid(statements, 'KeepSesDisabledOutsideAuthorizedFoundationRoles');
  assert.deepEqual(exception.Action, ['ses:Create*', 'ses:Put*', 'ses:Send*', 'ses:Update*', 'ses:Delete*']);
  assert.deepEqual(exception.Condition?.ArnNotEquals?.['aws:PrincipalArn'], [
    'arn:aws:iam::193644343389:role/TracePointMigrationProduction',
    'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1',
  ]);
  assert.deepEqual(actions(bySid(statements, 'DenySesSendingUntilSeparateAuthorization')), ['ses:Send*']);
  assert.ok(actions(bySid(statements, 'KeepCognitoDisabled')).every((action) => action.startsWith('cognito-idp:')));
  assert.ok(actions(bySid(statements, 'DenyProductionDnsChanges')).includes('route53:ChangeResourceRecordSets'));
});

test('production boundary grants only reviewed SES foundation and account-control writes', () => {
  const statements = policy('tracepoint-production-boundary.json').Statement;
  const creation = bySid(statements, 'AllowReviewedSesFoundationCreationViaCloudFormation');
  assert.deepEqual(actions(creation), ['ses:CreateConfigurationSet', 'ses:CreateEmailIdentity']);
  assert.equal(creation.Resource, '*');
  assert.equal(
    creation.Condition?.ArnEquals?.['aws:PrincipalArn'],
    'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1',
  );

  const resources = bySid(statements, 'AllowReviewedSesFoundationResources');
  assert.deepEqual(resources.Resource, [
    'arn:aws:ses:us-east-1:193644343389:identity/tracepointhq.com',
    'arn:aws:ses:us-east-1:193644343389:configuration-set/tracepoint-production',
    'arn:aws:ses:us-east-1:193644343389:configuration-set/tracepoint-production-cognito',
  ]);

  const account = bySid(statements, 'AllowReviewedSesAccountControls');
  assert.deepEqual(actions(account), ['ses:PutAccountDetails', 'ses:PutAccountSuppressionAttributes']);
  assert.equal(account.Condition?.ArnEquals?.['aws:PrincipalArn'], 'arn:aws:iam::193644343389:role/TracePointMigrationProduction');

  const added = [creation, resources, account].flatMap(actions);
  assert.ok(added.every((action) => action.startsWith('ses:')));
  assert.ok(!added.some((action) => action === 'ses:*' || action.startsWith('ses:Send')));
  assert.ok(!added.some((action) => /^(iam|ecs|rds|cognito|lambda|route53):/.test(action)));
});
