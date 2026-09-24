import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { Phase3cRehearsalAppStack } from '../lib/phase3c-rehearsal-app-stack';

const digest = `sha256:${'a'.repeat(64)}`;
function template() {
  const app = new cdk.App();
  return Template.fromStack(new Phase3cRehearsalAppStack(app, 'Rehearsal', {
    env: { account: '193644343389', region: 'us-east-1' }, imageDigest: digest,
  })).toJSON();
}

test('rehearsal deployment owns a dedicated pool/client and retains the old shared client unchanged', () => {
  const resources = Object.values(template().Resources) as Array<{ Type: string; Properties: Record<string, unknown> }>;
  const ofType = (type: string) => resources.filter(resource => resource.Type === type);
  assert.equal(ofType('AWS::ECS::Service').length, 1);
  assert.equal(ofType('AWS::ECS::Service')[0].Properties.DesiredCount, 0);
  assert.equal(ofType('AWS::Cognito::UserPool').length, 1);
  assert.equal(ofType('AWS::Cognito::UserPoolClient').length, 2);
  assert.equal(ofType('AWS::Cognito::UserPoolDomain').length, 1);
  const pool = ofType('AWS::Cognito::UserPool')[0];
  assert.equal(pool.Properties.MfaConfiguration, 'ON');
  assert.deepEqual(pool.Properties.EnabledMfas, ['SOFTWARE_TOKEN_MFA']);
  assert.deepEqual(pool.Properties.AdminCreateUserConfig, { AllowAdminCreateUserOnly: true });
  const clients = ofType('AWS::Cognito::UserPoolClient');
  const dedicated = clients.find(resource => JSON.stringify(resource.Properties.UserPoolId).includes('DedicatedRehearsalUserPool'));
  const retained = clients.find(resource => resource.Properties.UserPoolId === 'us-east-1_diFmWDMe9');
  assert.ok(dedicated && retained);
  assert.deepEqual(dedicated.Properties.CallbackURLs, ['https://shadow-rehearsal.tracepointhq.com/api/auth/cognito/callback']);
  assert.deepEqual(dedicated.Properties.LogoutURLs, ['https://shadow-rehearsal.tracepointhq.com/login']);
  assert.deepEqual(dedicated.Properties.RefreshTokenRotation, { Feature: 'ENABLED', RetryGracePeriodSeconds: 0 });
  assert.equal(dedicated.Properties.EnableTokenRevocation, true);
  assert.equal(ofType('AWS::Route53::RecordSet').length, 1);
  assert.equal(ofType('AWS::SecretsManager::Secret').length, 2);
  assert.equal(ofType('AWS::ECS::TaskDefinition').length, 2);
  const serialized = JSON.stringify(resources);
  assert.match(serialized, /shadow-rehearsal\.tracepointhq\.com/);
  assert.match(serialized, /tracepoint-production-migration-rehearsal-4272874f-20260923/);
  assert.match(serialized, /TRACEPOINT_REHEARSAL_APP_MODE/);
  assert.match(serialized, /object-smoke/);
  assert.match(serialized, new RegExp(digest));
  assert.doesNotMatch(serialized, /tracepoint-production-migration-clean-4272874f-final/);
  assert.doesNotMatch(serialized, /NEXT_PUBLIC_SUPABASE|SUPABASE_URL|SUPABASE_ANON/);
  const tasks = ofType('AWS::ECS::TaskDefinition');
  const web = tasks.find(task => task.Properties.Family === 'tracepoint-production-phase3c-rehearsal-app');
  const fixture = tasks.find(task => task.Properties.Family === 'tracepoint-production-phase3c-rehearsal-fixture');
  assert.ok(web && fixture);
  assert.match(JSON.stringify(fixture), /phase3c-rehearsal-auth-fixture\.cjs/);
  assert.match(JSON.stringify(fixture), /DedicatedRehearsalUserPool/);
  assert.match(JSON.stringify(web), /DedicatedRehearsalUserPool/);
  assert.doesNotMatch(JSON.stringify(web), /phase3c-rehearsal-auth-fixture\.cjs|RehearsalFixtureDatabaseSecret/);
});

test('rehearsal ingress and task permissions are constrained', () => {
  const resources = Object.values(template().Resources) as Array<{ Type: string; Properties: Record<string, unknown> }>;
  const rules = resources.filter(resource => resource.Type === 'AWS::ElasticLoadBalancingV2::ListenerRule');
  assert.equal(rules.length, 2);
  const serialized = JSON.stringify(resources);
  assert.match(serialized, /76\.116\.100\.225\/32/);
  assert.match(serialized, /50\.174\.33\.3\/32/);
  const listenerRules = JSON.stringify(rules.map(rule => rule.Properties.Conditions));
  assert.doesNotMatch(listenerRules, /0\.0\.0\.0\/0/);
  const policies = resources.filter(resource => resource.Type === 'AWS::IAM::Policy');
  const actions = JSON.stringify(policies.map(policy => policy.Properties.PolicyDocument));
  assert.match(actions, /s3:GetObject/);
  assert.doesNotMatch(actions, /s3:PutObject|s3:DeleteObject|cognito-idp:Admin|ses:SendEmail/);
});
