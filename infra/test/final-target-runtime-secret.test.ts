import assert from 'node:assert/strict';
import test from 'node:test';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { FinalTargetRuntimeSecretStack } from '../lib/final-target-runtime-secret-stack';

test('final-target runtime secret is separate, host-pinned, retained, and contains no plaintext password', () => {
  const app = new cdk.App();
  const stack = new FinalTargetRuntimeSecretStack(app, 'FinalTargetSecretTest', {
    env: { account: '193644343389', region: 'us-east-1' },
  });
  const template = Template.fromStack(stack).toJSON();
  const resources = Object.values(template.Resources) as Array<Record<string, unknown>>;
  assert.equal(resources.length, 1);
  const secret = resources[0];
  assert.equal(secret.Type, 'AWS::SecretsManager::Secret');
  assert.equal(secret.DeletionPolicy, 'Retain');
  const properties = secret.Properties as Record<string, string>;
  assert.equal(properties.Name, 'tracepoint/production/final/database-runtime-20260926');
  const contents = JSON.parse(properties.SecretString);
  assert.equal(contents.host, 'tracepoint-production-final-cutover-20260926.c8r4sgs089tu.us-east-1.rds.amazonaws.com');
  assert.equal(contents.dbname, 'tracepoint');
  assert.equal(contents.username, 'tracepoint_runtime');
  assert.equal(contents.password,
    '{{resolve:secretsmanager:arn:aws:secretsmanager:us-east-1:193644343389:secret:tracepoint/production/shadow/database-runtime-jNRvgT:SecretString:password}}');
  assert.ok(!JSON.stringify(template).includes('tracepoint/production/database/runtime'));
});

test('final-target secret rejects wrong account', () => {
  const app = new cdk.App();
  assert.throws(() => new FinalTargetRuntimeSecretStack(app, 'WrongAccount', {
    env: { account: '265544358665', region: 'us-east-1' },
  }));
});
