import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { boundary, buildScp } from './preflight-isolated-ses-proof-iam.mjs';

const account = '193644343389';
const region = 'us-east-1';
const roleName = 'tracepoint-production-ses-feedback-proof-v1';
const roleArn = `arn:aws:iam::${account}:role/${roleName}`;
const boundaryName = 'TracePointProductionSesFeedbackProofBoundary-v1';
const boundaryArn = `arn:aws:iam::${account}:policy/${boundaryName}`;
const expectedScpHash = 'f713a39c1a82fb85971941b1cc46c07c8a11686a6b061cddc1b9d16201b782ca';

if (process.argv[2] !== 'apply' || process.env.TRACEPOINT_ISOLATED_SES_PROOF_IAM_APPLY !== '20260926') {
  throw new Error('Exact proof-only IAM deployment acknowledgement required');
}

function aws(profile, service, operation, args = []) {
  const output = execFileSync('aws', [service, operation, ...args, '--profile', profile,
    '--region', region, '--output', 'json'], { encoding: 'utf8', maxBuffer: 2_000_000 });
  return output.trim() ? JSON.parse(output) : {};
}

function absent(service, operation, args) {
  try { aws('tracepoint-production', service, operation, args); return false; }
  catch (error) {
    const stderr = String(error.stderr ?? '');
    if (stderr.includes('NoSuchEntity')) return true;
    throw error;
  }
}

const caller = aws('tracepoint-production', 'sts', 'get-caller-identity');
assert.equal(caller.Account, account);
assert(absent('iam', 'get-role', ['--role-name', roleName]), 'Exact proof role already exists');
assert(absent('iam', 'get-policy', ['--policy-arn', boundaryArn]), 'Exact proof boundary already exists');
const scp = aws('tracepoint-production-access-source', 'organizations', 'describe-policy',
  ['--policy-id', 'p-rvx1u7q7']).Policy;
assert.equal(createHash('sha256').update(scp.Content).digest('hex'), expectedScpHash,
  'Production OU SCP drift; no mutation');
const next = JSON.stringify(buildScp(JSON.parse(scp.Content)));
assert(Buffer.byteLength(next) <= 5120);

const trust = { Version: '2012-10-17', Statement: [
  { Sid: 'OnlyProductionEcsTasks', Effect: 'Allow', Principal: { Service: 'ecs-tasks.amazonaws.com' },
    Action: 'sts:AssumeRole', Condition: {
      StringEquals: { 'aws:SourceAccount': account },
      ArnLike: { 'aws:SourceArn': `arn:aws:ecs:${region}:${account}:*` },
    } },
  { Sid: 'OnlyExactMigrationOperatorForProofManagement', Effect: 'Allow',
    Principal: { AWS: `arn:aws:iam::${account}:role/TracePointMigrationProduction` },
    Action: 'sts:AssumeRole' },
] };

const created = aws('tracepoint-production', 'iam', 'create-policy',
  ['--policy-name', boundaryName, '--policy-document', JSON.stringify(boundary),
    '--description', 'Exact-resource, simulator-only isolated SES feedback proof boundary']);
assert.equal(created.Policy.Arn, boundaryArn);
const role = aws('tracepoint-production', 'iam', 'create-role',
  ['--role-name', roleName, '--assume-role-policy-document', JSON.stringify(trust),
    '--permissions-boundary', boundaryArn,
    '--description', 'Isolated SES proof only; no production ECS service attachment']);
assert.equal(role.Role.Arn, roleArn);
assert.equal(role.Role.PermissionsBoundary.PermissionsBoundaryArn, boundaryArn);
aws('tracepoint-production', 'iam', 'put-role-policy',
  ['--role-name', roleName, '--policy-name', 'ExactSesFeedbackProofOnly',
    '--policy-document', JSON.stringify(boundary)]);

// One consolidated SCP update after the new role is inert and boundary-bound.
const updated = aws('tracepoint-production-access-source', 'organizations', 'update-policy',
  ['--policy-id', 'p-rvx1u7q7', '--content', next]);
assert.equal(updated.Policy.PolicySummary.Id, 'p-rvx1u7q7');
const reread = aws('tracepoint-production-access-source', 'organizations', 'describe-policy',
  ['--policy-id', 'p-rvx1u7q7']).Policy;
assert.deepEqual(JSON.parse(reread.Content), JSON.parse(next));
console.log(JSON.stringify({ event: 'ISOLATED_SES_PROOF_IAM_APPLIED', roleArn,
  boundaryArn, scpPolicyId: 'p-rvx1u7q7', scpHash: createHash('sha256').update(reread.Content).digest('hex'),
  productionRoleModified: false, sharedBoundaryModified: false }));
