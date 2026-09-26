import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { narrowProductionSesDeny } from './authorize-production-native-proof-ses-scp.mjs';

const operator = 'arn:aws:iam::193644343389:role/TracePointMigrationProduction';
const cfn = 'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1';
const original = JSON.stringify({ Version: '2012-10-17', Statement: [
  ...Array.from({ length: 5 }, (_, i) => ({ Sid: `Preserved${i}`, Effect: 'Deny', Action: `service:Action${i}`, Resource: '*' })),
  { Sid: 'KeepSesDisabledOutsideAuthorizedFoundationRoles', Effect: 'Deny',
    Action: ['ses:Create*', 'ses:Put*', 'ses:Send*', 'ses:Update*', 'ses:Delete*'], Resource: '*',
    Condition: { ArnNotEquals: { 'aws:PrincipalArn': [operator, cfn] } } },
  { Sid: 'DenySesSendingUntilSeparateAuthorization', Effect: 'Deny', Action: 'ses:Send*', Resource: '*' },
  { Sid: 'Preserved5', Effect: 'Deny', Action: 'service:Action5', Resource: '*' },
  { Sid: 'Preserved6', Effect: 'Deny', Action: 'service:Action6', Resource: '*' },
] });
const hash = value => createHash('sha256').update(value).digest('hex');
const updated = narrowProductionSesDeny(original, hash(original));
assert.equal(updated.Statement.length, 11);
const old = JSON.parse(original);
const removed = updated.Statement.find(statement => statement.Sid === 'KeepSesDisabledOutsideAuthorizedFoundationRoles');
assert.deepEqual(removed.Action, ['ses:Create*', 'ses:Put*', 'ses:Update*', 'ses:Delete*']);
const sendOutside = updated.Statement.find(statement => statement.Sid === 'KeepSesSendingDisabledOutsideFoundationOrExactProofRole');
assert.equal(sendOutside.Action, 'ses:Send*');
assert.equal(sendOutside.Effect, 'Deny');
assert.equal(sendOutside.Condition.ArnNotEquals['aws:PrincipalArn'].length, 3);
const global = updated.Statement.find(statement => statement.Sid === 'DenySesSendingUntilSeparateAuthorization');
assert.equal(global.Action, 'ses:Send*');
assert.equal(global.Condition.ArnNotEquals['aws:PrincipalArn'], 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-task-v1');
const otherSends = updated.Statement.find(statement => statement.Sid === 'DenyAllOtherSesSendActionsForExactProofRole');
assert.deepEqual(otherSends.Action, [
  'ses:SendBounce', 'ses:SendBulkEmail', 'ses:SendBulkTemplatedEmail',
  'ses:SendCustomVerificationEmail', 'ses:SendRawEmail', 'ses:SendTemplatedEmail',
]);
assert.equal(otherSends.Condition.ArnEquals['aws:PrincipalArn'], global.Condition.ArnNotEquals['aws:PrincipalArn']);
assert.equal(otherSends.Effect, 'Deny');
assert.deepEqual(updated.Statement.filter(statement => ![
  'KeepSesDisabledOutsideAuthorizedFoundationRoles', 'KeepSesSendingDisabledOutsideFoundationOrExactProofRole',
  'DenySesSendingUntilSeparateAuthorization', 'DenyAllOtherSesSendActionsForExactProofRole',
].includes(statement.Sid)), old.Statement.filter(statement => ![
  'KeepSesDisabledOutsideAuthorizedFoundationRoles', 'DenySesSendingUntilSeparateAuthorization',
].includes(statement.Sid)));
assert.throws(() => narrowProductionSesDeny(original.replace('Preserved0', 'SomethingElse'), hash(original)), /drifted/);
console.log('exact-role SES SCP deny exception contract PASS');
