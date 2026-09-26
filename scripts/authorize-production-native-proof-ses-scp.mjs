import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const POLICY_ID = 'p-rvx1u7q7';
const POLICY_NAME = 'TracePointProductionGuardrails';
const PROFILE = 'tracepoint-production-access-source';
const EXPECTED_SHA256 = '6a46b39803c5874227449b840ab1962c00d6b63ffde5d6b5f5f8da1a5f1592b3';
const PROOF_ROLE = 'arn:aws:iam::193644343389:role/tracepoint-production-aws-native-proof-task-v1';
const OPERATOR_ROLE = 'arn:aws:iam::193644343389:role/TracePointMigrationProduction';
const CFN_ROLE = 'arn:aws:iam::193644343389:role/cdk-hnb659fds-cfn-exec-role-193644343389-us-east-1';
// SES v1/v2 send actions other than SendEmail, per the AWS Service Authorization Reference.
// The proof role's identity policy and permissions boundary also allow only SendEmail.
const OTHER_SES_SEND_ACTIONS = [
  'ses:SendBounce',
  'ses:SendBulkEmail',
  'ses:SendBulkTemplatedEmail',
  'ses:SendCustomVerificationEmail',
  'ses:SendRawEmail',
  'ses:SendTemplatedEmail',
];
const sha = text => createHash('sha256').update(text).digest('hex');
const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

export function narrowProductionSesDeny(content, expectedSha256 = EXPECTED_SHA256) {
  if (sha(content) !== expectedSha256) throw new Error('Production SCP content drifted; no change allowed');
  const original = JSON.parse(content);
  if (original.Version !== '2012-10-17' || !Array.isArray(original.Statement) || original.Statement.length !== 9) {
    throw new Error('Unexpected production SCP structure');
  }
  const result = structuredClone(original);
  const foundation = result.Statement.find(statement => statement.Sid === 'KeepSesDisabledOutsideAuthorizedFoundationRoles');
  const send = result.Statement.find(statement => statement.Sid === 'DenySesSendingUntilSeparateAuthorization');
  if (!foundation || !send || !same(foundation.Action, ['ses:Create*', 'ses:Put*', 'ses:Send*', 'ses:Update*', 'ses:Delete*']) ||
      !same(foundation.Condition, { ArnNotEquals: { 'aws:PrincipalArn': [OPERATOR_ROLE, CFN_ROLE] } }) ||
      send.Effect !== 'Deny' || send.Action !== 'ses:Send*' || send.Resource !== '*' || send.Condition !== undefined) {
    throw new Error('SES deny contract differs; no change allowed');
  }
  // Preserve every non-send restriction exactly. All other principals retain the
  // wildcard send denial. For the exact proof role, every other documented SES
  // send operation remains explicitly denied by this SCP.
  foundation.Action = ['ses:Create*', 'ses:Put*', 'ses:Update*', 'ses:Delete*'];
  const sendOutsideProof = {
    Sid: 'KeepSesSendingDisabledOutsideFoundationOrExactProofRole', Effect: 'Deny',
    Action: 'ses:Send*', Resource: '*',
    Condition: { ArnNotEquals: { 'aws:PrincipalArn': [OPERATOR_ROLE, CFN_ROLE, PROOF_ROLE] } },
  };
  result.Statement.splice(result.Statement.indexOf(foundation) + 1, 0, sendOutsideProof);
  send.Condition = { ArnNotEquals: { 'aws:PrincipalArn': PROOF_ROLE } };
  result.Statement.splice(result.Statement.indexOf(send) + 1, 0, {
    Sid: 'DenyAllOtherSesSendActionsForExactProofRole', Effect: 'Deny',
    Action: OTHER_SES_SEND_ACTIONS, Resource: '*',
    Condition: { ArnEquals: { 'aws:PrincipalArn': PROOF_ROLE } },
  });
  if (!same(result.Statement.filter(statement => ![
    'KeepSesDisabledOutsideAuthorizedFoundationRoles',
    'KeepSesSendingDisabledOutsideFoundationOrExactProofRole',
    'DenySesSendingUntilSeparateAuthorization',
    'DenyAllOtherSesSendActionsForExactProofRole',
  ].includes(statement.Sid)), original.Statement.filter(statement => ![
    'KeepSesDisabledOutsideAuthorizedFoundationRoles',
    'DenySesSendingUntilSeparateAuthorization',
  ].includes(statement.Sid)))) throw new Error('Unrelated SCP statement changed');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv[2] === '--apply';
  if (process.argv.length > 3 || (process.argv[2] && !apply)) throw new Error('Use --apply or omit it for dry run');
  const base = ['--profile', PROFILE, '--region', 'us-east-1', '--output', 'json'];
  const described = JSON.parse(execFileSync('aws', ['organizations', 'describe-policy', '--policy-id', POLICY_ID, ...base], { encoding: 'utf8' }));
  if (described.Policy?.PolicySummary?.Name !== POLICY_NAME) throw new Error('Wrong SCP identity');
  const updated = narrowProductionSesDeny(described.Policy.Content);
  if (apply) {
    execFileSync('aws', ['organizations', 'update-policy', '--policy-id', POLICY_ID,
      '--content', JSON.stringify(updated), ...base], { encoding: 'utf8' });
  }
  console.log(JSON.stringify({ status: apply ? 'APPLIED' : 'DRY_RUN_PASS', policyId: POLICY_ID,
    previousSha256: EXPECTED_SHA256, proposedSha256: sha(JSON.stringify(updated)),
    proofRole: PROOF_ROLE, noOtherStatementChanged: true }));
}
