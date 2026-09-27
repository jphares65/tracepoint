import assert from 'node:assert/strict';
import test from 'node:test';
import { buildScp, boundary } from './preflight-isolated-ses-proof-iam.mjs';

const existing = 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-task-v1';
const next = 'arn:aws:iam::193644343389:role/tracepoint-production-ses-feedback-proof-v1';
const proof = 'arn:aws:ses:us-east-1:193644343389:configuration-set/tracepoint-production-isolated-ses-proof-20260926';
const current = {
  Version: '2012-10-17', Statement: [
    { Sid: 'Unrelated', Effect: 'Deny', Action: 'iam:DeleteRole', Resource: '*' },
    { Sid: 'KeepSesDisabledOutsideAuthorizedFoundationRoles', Effect: 'Deny',
      Action: ['ses:Create*', 'ses:Put*', 'ses:Update*', 'ses:Delete*'], Resource: '*',
      Condition: { ArnNotEquals: { 'aws:PrincipalArn': ['arn:aws:iam::193644343389:role/TracePointMigrationProduction'] } } },
    { Sid: 'KeepSesSendingDisabledOutsideFoundationOrExactProofRole', Effect: 'Deny',
      Action: 'ses:Send*', Resource: '*',
      Condition: { ArnNotEquals: { 'aws:PrincipalArn': [existing] } } },
    { Sid: 'DenySesSendingUntilSeparateAuthorization', Effect: 'Deny',
      Action: 'ses:Send*', Resource: '*',
      Condition: { ArnNotEquals: { 'aws:PrincipalArn': existing } } },
    { Sid: 'DenyAllOtherSesSendActionsForExactProofRole', Effect: 'Deny',
      Action: ['ses:SendRawEmail', 'ses:SendBulkEmail'], Resource: '*',
      Condition: { ArnEquals: { 'aws:PrincipalArn': existing } } },
  ],
};

test('one exact role is excepted while existing SCP statements remain intact', () => {
  const candidate = buildScp(current);
  assert.deepEqual(current.Statement[0], candidate.Statement[0]);
  assert.deepEqual(current.Statement[1].Condition.ArnNotEquals['aws:PrincipalArn'],
    ['arn:aws:iam::193644343389:role/TracePointMigrationProduction']);
  for (const sid of ['KeepSesDisabledOutsideAuthorizedFoundationRoles',
    'KeepSesSendingDisabledOutsideFoundationOrExactProofRole',
    'DenySesSendingUntilSeparateAuthorization']) {
    assert([].concat(candidate.Statement.find(statement => statement.Sid === sid)
      .Condition.ArnNotEquals['aws:PrincipalArn']).includes(next));
  }
  const otherSend = candidate.Statement.find(statement => statement.Sid === 'DenyAllOtherSesSendActionsForExactProofRole');
  assert.deepEqual(otherSend.Condition.ArnEquals['aws:PrincipalArn'], [existing, next]);
  assert(otherSend.Action.includes('ses:SendRawEmail'));
  assert(!otherSend.Action.includes('ses:SendEmail'));
  const elsewhere = candidate.Statement.find(statement => statement.NotResource === proof);
  assert.equal(elsewhere.Condition.ArnEquals['aws:PrincipalArn'], next);
  const unlisted = candidate.Statement.find(statement => statement.Resource === proof && statement.NotAction);
  assert.equal(unlisted.Condition.ArnEquals['aws:PrincipalArn'], next);
  assert(unlisted.NotAction.includes('ses:SendEmail'));
  assert(!unlisted.NotAction.includes('ses:SendRawEmail'));
  assert(!unlisted.NotAction.includes('ses:PutConfigurationSetSendingOptions'));
});

test('proof boundary limits sender, recipients, set, secret, queue and KMS', () => {
  const send = boundary.Statement.find(statement => statement.Sid === 'SendOnlySimulatorViaProofSet');
  assert.deepEqual(send.Resource, [proof, 'arn:aws:ses:us-east-1:193644343389:identity/tracepointhq.com']);
  assert.deepEqual(send.Condition['ForAllValues:StringEquals']['ses:Recipients'], [
    'success@simulator.amazonses.com', 'bounce@simulator.amazonses.com',
    'complaint@simulator.amazonses.com',
  ]);
  assert.equal(send.Condition.Null['ses:Recipients'], 'false');
  assert(boundary.Statement.every(statement => ![].concat(statement.Action).some(action => action.includes('*'))));
  assert(boundary.Statement.every(statement => ![].concat(statement.Resource).includes('*')));
});
