# TracePoint staging IAM access transition

**Target:** account `559054714699`, region `us-east-1`, environment
`tracepoint-staging`. **Hard deny:** management account `265544358665`.

## Verified risk

The active session is the Identity Center role generated for permission set
`TracePointMigrationStaging` (permission-set ID `ps-f17d74409ce29842`).
User-supplied AWS CLI output on 2026-08-30 confirms its attached managed policies
include `arn:aws:iam::aws:policy/AdministratorAccess`. The same output confirms
an inline policy intended to scope TracePoint staging actions. An allow-only
inline policy cannot narrow permissions granted by `AdministratorAccess`.

AWS MCP's staging session could list the Identity Center instance but was denied
`sso:ListPermissionSets`. The attachment evidence therefore comes from the
user's successful read-only CLI call with profile `tracepoint-staging`, not from
management-account access. A management-account Identity Center administrator
must perform the eventual transition; this run did not access or alter that
account.

## Lockout-safe transition

1. A management-account owner verifies and exercises a separate break-glass or
   administrator path. Record owner, MFA, session duration, recovery procedure,
   and a successful test timestamp before changing this permission set.
2. Create a one-time bootstrap role in staging, trusted only by the named
   platform principal. Require MFA for interactive assumption, short sessions,
   account `559054714699`, and `aws:RequestedRegion=us-east-1` where supported.
   Apply an approved permissions boundary and expire/remove this role after the
   separately approved bootstrap.
3. Create a routine deployer role that can assume only the dedicated CDK
   bootstrap deploy/file/image/lookup roles for the approved qualifier.
   `iam:PassRole` is limited to the exact CloudFormation execution role and
   `iam:PassedToService=cloudformation.amazonaws.com`. It cannot administer IAM,
   Organizations, Identity Center, Route 53, ACM, billing, or other accounts.
4. Create an image-publisher role restricted to the exact
   `tracepoint-staging` ECR repository. Allow token acquisition plus layer upload,
   image put, and image metadata reads; deny repository administration and all
   CloudFormation/deployment actions. Trust only the named CI OIDC subject and
   branch/environment, with no wildcard repository owner.
5. Validate both routine roles using policy simulation, Access Analyzer,
   negative account/region/resource tests, synth/template review, and a
   non-mutating identity/preflight run. Bootstrap and deployment tests require
   separate approval and are not part of this transition design.
6. Remove `AdministratorAccess` from `TracePointMigrationStaging` only after the
   emergency path and replacement roles are proven. Re-provision assignments,
   start a fresh SSO session, verify the managed policy is absent, and confirm
   Organizations, Identity Center, IAM administration, management-account,
   non-`us-east-1`, and non-`tracepoint-staging-*` actions are denied.
7. Retain the emergency path under management-account ownership and monitor its
   use. Do not make it assumable by application, deployer, or image identities.

## Policy design boundaries

Final policies require the approved CDK qualifier, permissions-boundary ARN,
CI OIDC provider/subject, and bootstrap role ARNs. Templates must use exact ARNs
for the staging account, lowercase `tracepoint-staging-*` resource names, and
explicit denies for account `265544358665` and regions other than `us-east-1`.
Avoid `iam:PassRole` on `*`; include both a scoped role resource and
`iam:PassedToService`. CloudFormation execution permissions must be derived from
the reviewed synthesized templates, not from `AdministratorAccess` or service
`FullAccess` policies.
