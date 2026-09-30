import * as assert from 'node:assert/strict';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ProductionNativeProofStack } from '../lib/production-native-proof-stack';

const app = new cdk.App();
const stack = new ProductionNativeProofStack(app, 'native-proof-test', {
  env: { account: '193644343389', region: 'us-east-1' },
});
const resources = Template.fromStack(stack).toJSON().Resources as Record<string, { Type: string; Properties: Record<string, unknown> }>;
const ofType = (type: string) => Object.values(resources).filter(resource => resource.Type === type);
const boundary = ofType('AWS::IAM::ManagedPolicy');
assert.equal(boundary.length, 1);
const boundaryDocument = boundary[0].Properties.PolicyDocument as { Statement: Array<Record<string, unknown>> };
const statements = boundaryDocument.Statement;
const actionSet = (statement: Record<string, unknown>) => new Set(Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
const withAction = (action: string) => statements.filter(statement => actionSet(statement).has(action));
const bucket = 'arn:aws:s3:::tracepoint-production-private-193644343389';
const key = 'arn:aws:kms:us-east-1:193644343389:key/4dc71990-3cfa-49d7-88c6-383bc1067f55';
for (const action of ['s3:GetObject', 's3:PutObject', 's3:DeleteObject']) {
  const matching = withAction(action);
  assert.equal(matching.length, 1);
  assert.deepEqual(matching[0].Resource, [`${bucket}/attachments/*`, `${bucket}/department-assets/*`]);
  assert.deepEqual(matching[0].Condition, { StringEquals: { 's3:ResourceAccount': '193644343389' } });
}
for (const action of ['kms:Decrypt', 'kms:GenerateDataKey']) {
  assert.ok(withAction(action).some(statement => statement.Resource === key &&
    (statement.Condition as { StringEquals?: Record<string, string> }).StringEquals?.['kms:ViaService'] === 's3.us-east-1.amazonaws.com'));
}
assert.equal(withAction('ses:SendEmail').length, 2);
assert.ok(withAction('ses:SendEmail').some(statement => statement.Resource ===
  'arn:aws:ses:us-east-1:193644343389:identity/tracepointhq.com' &&
  (statement.Condition as { StringEquals?: Record<string, string> }).StringEquals?.['ses:FromAddress'] === 'notifications@tracepointhq.com'));
assert.ok(withAction('ses:SendEmail').some(statement => statement.Resource ===
  'arn:aws:ses:us-east-1:193644343389:configuration-set/tracepoint-production'));
assert.equal(withAction('ses:SendRawEmail').length, 0);
assert.equal(withAction('iam:*').length, 0);
assert.equal(withAction('s3:*').length, 0);
assert.equal(withAction('ses:*').length, 0);
assert.equal(withAction('ecr:GetAuthorizationToken')[0].Resource, '*');
assert.equal(statements.filter(statement => statement.Resource === '*').length, 1);
const sentryRuntimeSecret = 'arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/sentry-runtime-yGnfPL';
const sentryRuntimeStatements = withAction('secretsmanager:GetSecretValue').filter(statement =>
  JSON.stringify(statement.Resource).includes('tracepoint/production/sentry-runtime-yGnfPL'));
assert.equal(sentryRuntimeStatements.length, 1);
assert.deepEqual(sentryRuntimeStatements[0].Resource, sentryRuntimeSecret);
assert.equal(actionSet(sentryRuntimeStatements[0]).size, 1);
for (const statement of statements.filter(statement => actionSet(statement).has('cognito-idp:AdminCreateUser'))) {
  assert.equal(statement.Resource, 'arn:aws:cognito-idp:us-east-1:193644343389:userpool/us-east-1_diFmWDMe9');
}
assert.equal(ofType('AWS::IAM::Role').length, 2);
assert.equal(ofType('AWS::ECS::TaskDefinition').length, 1);
for (const forbidden of ['AWS::ECS::Service', 'AWS::ElasticLoadBalancingV2::Listener', 'AWS::Route53::RecordSet']) {
  assert.equal(ofType(forbidden).length, 0);
}
const task = ofType('AWS::ECS::TaskDefinition')[0].Properties;
const container = (task.ContainerDefinitions as Array<Record<string, unknown>>)[0];
assert.match(JSON.stringify(container.Image), /cf19c9887eee2c79eac2abf2e0337f5a2bb95beefc5e20d0f1ffc0453a2f7b46/);
assert.doesNotMatch(JSON.stringify(container), /SUPABASE|BREVO|tracepoint\/production\/application-mkGidl/);
const secrets = container.Secrets as Array<{ Name: string; ValueFrom: string }>;
assert.deepEqual(secrets.map(secret => secret.Name).sort(), [
  'CONFIGURATION_ENVIRONMENT', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', 'NOTIFICATION_DISPATCH_SECRET',
  'TRACEPOINT_AUTH_REFRESH_KEYS', 'TRACEPOINT_AUTH_STATE_KEYS', 'TRACEPOINT_DATABASE_SECRET_JSON',
].sort());
assert.ok(secrets.every(secret => secret.ValueFrom.includes('aws-native-rIikku') ||
  secret.ValueFrom.includes('final/database-runtime-20260926-yg23sb')));
console.log('production native no-traffic IAM/task contract PASS');
