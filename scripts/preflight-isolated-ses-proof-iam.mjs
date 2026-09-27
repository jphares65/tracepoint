import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const account = '193644343389';
const region = 'us-east-1';
const role = `arn:aws:iam::${account}:role/tracepoint-production-ses-feedback-proof-v1`;
const set = `arn:aws:ses:${region}:${account}:configuration-set/tracepoint-production-isolated-ses-proof-20260926`;
const identity = `arn:aws:ses:${region}:${account}:identity/tracepointhq.com`;
const topic = `arn:aws:sns:${region}:${account}:tracepoint-production-isolated-ses-proof-feedback`;
const queue = `arn:aws:sqs:${region}:${account}:tracepoint-production-isolated-ses-proof-feedback`;
const secret = `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/rehearsal/database-runtime-4272874f-uDq389`;
const key = `arn:aws:kms:${region}:${account}:key/4dc71990-3cfa-49d7-88c6-383bc1067f55`;
const expectedScpHash = 'f713a39c1a82fb85971941b1cc46c07c8a11686a6b061cddc1b9d16201b782ca';
const management = [
  'ses:CreateConfigurationSet', 'ses:CreateConfigurationSetEventDestination',
  'ses:DeleteConfigurationSet', 'ses:DeleteConfigurationSetEventDestination',
  'ses:GetConfigurationSet', 'ses:GetConfigurationSetEventDestinations',
];
const allowedProofSetActions = [...management, 'ses:TagResource', 'ses:SendEmail'];
const permittedRecipients = [
  'success@simulator.amazonses.com',
  'bounce@simulator.amazonses.com',
  'complaint@simulator.amazonses.com',
];

function aws(profile, service, operation, args = []) {
  const output = execFileSync('aws', [service, operation, ...args, '--profile', profile,
    '--region', region, '--output', 'json'], { encoding: 'utf8', maxBuffer: 2_000_000 });
  return output.trim() ? JSON.parse(output) : {};
}

function bySid(policy, sid) {
  const matches = policy.Statement.filter(statement => statement.Sid === sid);
  assert.equal(matches.length, 1, `Expected one ${sid}`);
  return matches[0];
}

function appendExactRole(statement, operator) {
  const values = statement.Condition[operator]['aws:PrincipalArn'];
  assert(![].concat(values).includes(role), 'Proof role already excepted');
  statement.Condition[operator]['aws:PrincipalArn'] = [...[].concat(values), role];
}

export function buildScp(original) {
  const next = structuredClone(original);
  appendExactRole(bySid(next, 'KeepSesDisabledOutsideAuthorizedFoundationRoles'), 'ArnNotEquals');
  appendExactRole(bySid(next, 'KeepSesSendingDisabledOutsideFoundationOrExactProofRole'), 'ArnNotEquals');
  appendExactRole(bySid(next, 'DenySesSendingUntilSeparateAuthorization'), 'ArnNotEquals');
  appendExactRole(bySid(next, 'DenyAllOtherSesSendActionsForExactProofRole'), 'ArnEquals');
  // The existing broad SES-management deny still applies to every other principal.
  // For this one role, explicitly deny management on every other resource and
  // all unlisted actions on the sole proof configuration-set resource.
  next.Statement.push({ Effect: 'Deny', Action: ['ses:Create*', 'ses:Put*', 'ses:Update*', 'ses:Delete*'],
    NotResource: set, Condition: { ArnEquals: { 'aws:PrincipalArn': role } } });
  next.Statement.push({ Effect: 'Deny', NotAction: allowedProofSetActions,
    Resource: set, Condition: { ArnEquals: { 'aws:PrincipalArn': role } } });
  return next;
}

export const boundary = {
  Version: '2012-10-17', Statement: [
    { Sid: 'ManageOnlyProofSet', Effect: 'Allow', Action: [...management, 'ses:TagResource'], Resource: set },
    { Sid: 'SendOnlySimulatorViaProofSet', Effect: 'Allow', Action: 'ses:SendEmail',
      Resource: [set, identity], Condition: {
        StringEquals: { 'ses:FromAddress': 'notifications@tracepointhq.com' },
        'ForAllValues:StringEquals': { 'ses:Recipients': permittedRecipients },
        Null: { 'ses:Recipients': 'false' },
      } },
    { Sid: 'ReadOnlyRehearsalDatabaseSecret', Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: secret },
    { Sid: 'DecryptOnlyRehearsalSecret', Effect: 'Allow', Action: 'kms:Decrypt', Resource: key,
      Condition: { StringEquals: { 'kms:ViaService': `secretsmanager.${region}.amazonaws.com` } } },
    { Sid: 'ConsumeOnlyProofFeedback', Effect: 'Allow',
      Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], Resource: queue },
    { Sid: 'InspectOnlyProofTopic', Effect: 'Allow', Action: 'sns:GetTopicAttributes', Resource: topic },
  ],
};

function context(keyName, values, type = 'string') {
  return { ContextKeyName: keyName, ContextKeyValues: [].concat(values), ContextKeyType: type };
}

const common = [context('aws:PrincipalArn', role, 'string'), context('aws:RequestedRegion', region)];
const mail = [context('ses:FromAddress', 'notifications@tracepointhq.com'),
  context('ses:Recipients', 'success@simulator.amazonses.com', 'stringList')];
const cases = [
  ...management.map(action => ({ action, resource: set, expected: 'allowed',
    simulatorUnsupported: action === 'ses:CreateConfigurationSet' })),
  { action: 'ses:TagResource', resource: set, expected: 'allowed' },
  { action: 'ses:SendEmail', resource: set, context: mail, expected: 'allowed', simulatorUnsupported: true },
  { action: 'ses:SendEmail', resource: identity, context: mail, expected: 'allowed' },
  { action: 'secretsmanager:GetSecretValue', resource: secret, expected: 'allowed' },
  { action: 'kms:Decrypt', resource: key,
    context: [context('kms:ViaService', `secretsmanager.${region}.amazonaws.com`)], expected: 'allowed' },
  { action: 'sqs:ReceiveMessage', resource: queue, expected: 'allowed' },
  { action: 'sqs:DeleteMessage', resource: queue, expected: 'allowed' },
  { action: 'sqs:GetQueueAttributes', resource: queue, expected: 'allowed' },
  { action: 'sns:GetTopicAttributes', resource: topic, expected: 'allowed' },
  { action: 'ses:CreateConfigurationSet', resource: `arn:aws:ses:${region}:${account}:configuration-set/tracepoint-production`, expected: 'explicitDeny', simulatorUnsupported: true },
  { action: 'ses:DeleteConfigurationSet', resource: `arn:aws:ses:${region}:${account}:configuration-set/tracepoint-production`, expected: 'explicitDeny' },
  { action: 'ses:PutConfigurationSetSendingOptions', resource: set, expected: 'explicitDeny' },
  { action: 'ses:SendRawEmail', resource: identity, context: mail, expected: 'explicitDeny' },
  { action: 'ses:SendEmail', resource: identity,
    context: [context('ses:FromAddress', 'other@example.com'), mail[1]], expected: 'implicitDeny' },
  { action: 'ses:SendEmail', resource: identity,
    context: [mail[0], context('ses:Recipients', 'customer@example.com', 'stringList')], expected: 'implicitDeny' },
  { action: 'secretsmanager:GetSecretValue', resource: `arn:aws:secretsmanager:${region}:${account}:secret:tracepoint/production/database/runtime-K4C4HY`, expected: 'implicitDeny' },
  { action: 'sqs:ReceiveMessage', resource: `arn:aws:sqs:${region}:${account}:tracepoint-production-ses-feedback`, expected: 'implicitDeny' },
  { action: 'sns:Publish', resource: topic, expected: 'implicitDeny' },
  { action: 'iam:CreateRole', resource: role, expected: 'implicitDeny' },
  { action: 'iam:PassRole', resource: role, expected: 'implicitDeny' },
];

function simulate(scp, entry) {
  const result = aws('tracepoint-production', 'iam', 'simulate-custom-policy', [
    '--policy-input-list', JSON.stringify(boundary),
    '--permissions-boundary-policy-input-list', JSON.stringify(boundary),
    '--ordered-organization-policy-input-list', JSON.stringify([{ ServiceControlPolicyInputList: [
      JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] }),
      JSON.stringify(scp),
    ] }]),
    '--action-names', entry.action, '--resource-arns', entry.resource,
    '--context-entries', JSON.stringify([...common, ...(entry.context ?? [])]),
  ]);
  assert.equal(result.EvaluationResults.length, 1);
  return result.EvaluationResults[0];
}

function verifySimulatorUnsupportedCase(scp, entry) {
  assert.equal(entry.action === 'ses:CreateConfigurationSet' || entry.action === 'ses:SendEmail', true);
  assert(boundary.Statement.some(statement => [].concat(statement.Action).includes(entry.action)
    && [].concat(statement.Resource).includes(set)), 'Proof boundary lacks exact action/resource');
  assert.equal(bySid(scp, 'KeepSesDisabledOutsideAuthorizedFoundationRoles')
    .Condition.ArnNotEquals['aws:PrincipalArn'].includes(role), true);
  assert.equal(bySid(scp, 'DenySesSendingUntilSeparateAuthorization')
    .Condition.ArnNotEquals['aws:PrincipalArn'].includes(role), true);
  const elsewhere = scp.Statement.find(statement => statement.NotResource === set
    && statement.Condition?.ArnEquals?.['aws:PrincipalArn'] === role);
  const unlisted = scp.Statement.find(statement => statement.Resource === set && statement.NotAction
    && statement.Condition?.ArnEquals?.['aws:PrincipalArn'] === role);
  assert(elsewhere && unlisted);
  assert(unlisted.NotAction.includes(entry.action));
  return entry.resource === set ? 'allowed' : 'explicitDeny';
}

function main() {
  const caller = aws('tracepoint-production', 'sts', 'get-caller-identity');
  assert.equal(caller.Account, account);
  const sesAccount = aws('tracepoint-production', 'sesv2', 'get-account');
  assert.equal(sesAccount.ProductionAccessEnabled, true);
  assert.equal(sesAccount.SendingEnabled, true);
  const sender = aws('tracepoint-production', 'sesv2', 'get-email-identity',
    ['--email-identity', 'tracepointhq.com']);
  assert.equal(sender.VerificationStatus, 'SUCCESS');
  const sets = aws('tracepoint-production', 'sesv2', 'list-configuration-sets').ConfigurationSets;
  assert(sets.includes('tracepoint-production'));
  assert(!sets.includes('tracepoint-production-isolated-ses-proof-20260926'));
  const snsPolicy = JSON.parse(aws('tracepoint-production', 'sns', 'get-topic-attributes',
    ['--topic-arn', topic]).Attributes.Policy);
  assert(snsPolicy.Statement.some(statement => statement.Principal?.Service === 'ses.amazonaws.com'
    && statement.Action === 'sns:Publish' && statement.Resource === topic
    && statement.Condition?.StringEquals?.['aws:SourceArn'] === set
    && statement.Condition?.StringEquals?.['aws:SourceAccount'] === account));
  const queueUrl = `https://sqs.${region}.amazonaws.com/${account}/tracepoint-production-isolated-ses-proof-feedback`;
  const sqsPolicy = JSON.parse(aws('tracepoint-production', 'sqs', 'get-queue-attributes',
    ['--queue-url', queueUrl, '--attribute-names', 'Policy']).Attributes.Policy);
  assert(sqsPolicy.Statement.some(statement => statement.Principal?.Service === 'sns.amazonaws.com'
    && statement.Action === 'sqs:SendMessage' && statement.Resource === queue
    && statement.Condition?.ArnEquals?.['aws:SourceArn'] === topic));
  const secretMetadata = aws('tracepoint-production', 'secretsmanager', 'describe-secret',
    ['--secret-id', secret]);
  assert.equal(secretMetadata.ARN, secret);
  assert.equal(secretMetadata.KmsKeyId, key);
  assert(!secretMetadata.DeletedDate);
  const worker = aws('tracepoint-production', 'lambda', 'get-function-configuration',
    ['--function-name', 'tracepoint-production-isolated-ses--Worker11F36D0F-NpSP0A9Gws4J']);
  assert.equal(worker.State, 'Active');
  assert.equal(worker.LastUpdateStatus, 'Successful');
  assert.equal(worker.Environment.Variables.TRACEPOINT_DATABASE_SECRET_ARN, secret);
  assert.equal(worker.Environment.Variables.TRACEPOINT_FEEDBACK_DATABASE_AUTHORITY, 'rehearsal');
  assert.equal(worker.Environment.Variables.TRACEPOINT_SES_FEEDBACK_TOPIC_ARN, topic);
  const policy = aws('tracepoint-production-access-source', 'organizations', 'describe-policy',
    ['--policy-id', 'p-rvx1u7q7']).Policy;
  const hash = createHash('sha256').update(policy.Content).digest('hex');
  assert.equal(hash, expectedScpHash, 'SCP drift; do not mutate');
  const original = JSON.parse(policy.Content);
  const scp = buildScp(original);
  const content = JSON.stringify(scp);
  assert(Buffer.byteLength(content) <= 5120, 'SCP exceeds 5120-byte quota');
  const results = [];
  for (const entry of cases.filter(item => !process.env.PREFLIGHT_ACTION || item.action === process.env.PREFLIGHT_ACTION)) {
    const result = simulate(scp, entry);
    const effective = entry.simulatorUnsupported && result.EvalDecision === 'implicitDeny'
      ? verifySimulatorUnsupportedCase(scp, entry) : result.EvalDecision;
    results.push({ action: entry.action, resource: entry.resource,
      expected: entry.expected, actual: result.EvalDecision, effective,
      simulatorUnsupported: entry.simulatorUnsupported ?? false,
      boundary: result.PermissionsBoundaryDecisionDetail?.AllowedByPermissionsBoundary,
      organizations: result.OrganizationsDecisionDetail?.AllowedByOrganizations,
      missingContext: result.MissingContextValues,
      matchedPolicies: result.MatchedStatements?.map(item => ({ source: item.SourcePolicyId,
        start: item.StartPosition?.Line, end: item.EndPosition?.Line })) });
  }
  console.log(JSON.stringify({ event: 'ISOLATED_SES_PROOF_FULL_IAM_PREFLIGHT',
    role, proofConfigurationSet: set, scpPolicyId: policy.PolicySummary.Id,
    senderVerified: true, sesAccountSending: true, resourcePoliciesExact: true,
    rehearsalSecretPinned: true, isolatedWorkerPinned: true,
    currentScpHash: hash, proposedScpBytes: Buffer.byteLength(content),
    tested: results.length, passed: results.filter(result => result.effective === result.expected).length,
    mismatches: results.filter(result => result.effective !== result.expected),
    simulatorLimitations: results.filter(result => result.simulatorUnsupported),
    decisions: results.map(result => `${result.action}:${result.effective}`) }, null, 2));
  assert(results.every(result => result.effective === result.expected), 'IAM/SCP preflight mismatch; no mutation');
}

if (process.argv[1]?.endsWith('preflight-isolated-ses-proof-iam.mjs')) main();
