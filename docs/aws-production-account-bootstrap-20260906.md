# TracePoint production account bootstrap path

Status: **prepared, not executed**. Local AWS credentials are unavailable. OIDC
run `34071010058` proved the staging identity has neither Organizations metadata
nor account-inventory authority, so production-account existence remains
indeterminate rather than absent. The
AWS management account must never host the TracePoint runtime.

## Account decision and creation

The read-only OIDC operations job now runs
`scripts/collect-production-account-readiness.mjs`. It starts only from account
`559054714699`, reports `null` when inventory is unauthorized, reports `false`
only after an authorized account inventory contains no unique active account
named for TracePoint production, and reports the exact account ID only when one
unambiguous candidate exists. It does not assume another role or mutate AWS.

If no account exists, an Organizations owner must create `TracePoint Production`
with an owner-controlled unique email, wait for `CreateAccountStatus=SUCCEEDED`,
move it to the approved production-workloads OU, and record its 12-digit account
ID. This is the only account-creation step and requires owner approval. Do not
reuse account `265544358665` (management) or `559054714699` (staging).

## Required account guardrails

Before CDK bootstrap, the Organizations/security owner must verify effective
SCPs and centrally owned services: deny leaving the organization; restrict
workload regions to `us-east-1` with documented global-service exceptions;
protect CloudTrail, Config, GuardDuty and Security Hub; restrict root use; and
prevent disabling or deleting security/audit services. Central finding routing,
log archive ownership, alternate contacts and break-glass ownership require
named people and dated evidence. Guardrails must be evaluated as the complete
effective policy set, not merely counted.

Create the exact role `TracePointMigrationProduction` in the member account,
with short sessions, an approved permissions boundary and trust limited to the
named platform principal. The routine deployer may assume only reviewed CDK
bootstrap roles; image publication remains separate and ECR-scoped. Validate
positive and negative account/region/resource cases, `iam:PassRole` scope,
Access Analyzer results and a fresh session before removing any temporary
bootstrap authority.

Bootstrap `us-east-1` in the production member account only, then capture the
qualifier and exact deploy/file/image/lookup role ARNs in the reviewed IAM
policy. Create a separate protected GitHub `aws-production` environment with a
required external reviewer and exact production role variable. Do not copy
staging secrets, OIDC role trust, account IDs or environment approvals.

## Live validation sequence

1. Record `aws sts get-caller-identity` for the exact production role and prove
   management/staging/wrong-region identities fail the repository gate.
2. Verify `us-east-1a` and `us-east-1b` are available for that account.
3. Confirm effective SCPs, CloudTrail, Config, GuardDuty, Security Hub and
   central findings delivery with read-only APIs.
4. Run the strict preview against a reviewed target, then a credentials-backed
   `cdk diff`/change set. Reject replacement, deletion or IAM broadening.
5. Bootstrap/deploy only after the separate authorization reference required by
   `infra/bin/production-infra.ts` is present and unexpired.

GovCloud remains a separate target account, partition, certificate, bootstrap,
roles, images and evidence set. Nothing in this path treats commercial-region
credentials or ARNs as GovCloud deployment authority.
