# TracePoint AWS migration status

**Last updated:** 2026-09-03
**Target:** `tracepoint-staging`, account `559054714699`, `us-east-1`
**Hard deny:** management account `265544358665`
**AWS activity in this run:** renewed the existing Identity Center session,
verified the staging identity boundary, deployed the reviewed staging image-build
stack, and verified its storage, encryption, logging, IAM, and ECR controls.
Runtime stayed disabled and no DNS, certificate, production, or Supabase state
was changed.

## 2026-09-03 image-build deployment

- Corrected the CodeBuild role's missing application-key permission. The final
  deployed statement allows only `kms:Decrypt` on the exact staging data key and
  only through `secretsmanager.us-east-1.amazonaws.com`; it grants no direct KMS
  use and no access to another key. A no-source verification build retrieved the
  bootstrap-only secret while selecting only its ARN and redirecting the response,
  proving decrypt access without displaying the value.
- A post-deployment change-set-backed CDK diff reported zero differences across
  network, security, compute, and image-build. CloudFormation drift detection
  reported `IN_SYNC` for those four stacks and `CDKToolkit`; all five were in a
  healthy complete state. Runtime remained absent.
- Deployed `tracepoint-staging-image-build` after reviewing an additions-only
  live diff. The existing compute stack gained only three cross-stack export
  outputs; network and security had no changes.
- The new stack contains a rotating retained KMS key/alias, retained versioned
  source bucket with seven-day cleanup and full public-access blocking, retained
  KMS-encrypted 30-day build logs, a source/repository/secret-scoped CodeBuild
  role, and a `BUILD_GENERAL1_SMALL` privileged CodeBuild project.
- The first create attempt rolled back because the KMS policy omitted the
  regional CloudWatch Logs principal. The empty failed stack was deleted after
  verifying no retained alias or bucket, and the corrected log-group-scoped
  encryption-context policy deployed successfully.
- Commit `2420992782cf617d603e0358fb187b021df3b72e` passed the local archive gate:
  323 entries, all tracked by that commit, with environment, secret/credential,
  SQL/dump, backup, generated, `.github`, and protected untracked paths excluded.
- Image publication stopped before upload/build because the staging secret still
  has only `initialized` and `bootstrapNonce`. Local configuration was not reused
  because its site URL is not the approved staging hostname. ECR therefore remains
  empty and there is no image tag, digest, or scan result to report yet.
- The added recurring baseline is approximately $1/month for the customer-managed
  KMS key, plus negligible S3/log storage and request charges. CodeBuild is
  usage-based; the small compute free tier includes 100 build minutes/month when
  applicable.

## 2026-09-03 foundation hardening deployment

- STS verified account `559054714699`, role `TracePointMigrationStaging`, and
  `us-east-1`; the management-account deny remained active.
- Live inventory confirmed `CDKToolkit`, network, security, and compute healthy,
  no NAT gateway, an empty immutable KMS-encrypted ECR repository, zero ECS
  services/tasks, no load balancer, no issued staging certificate, and the `$75`
  budget.
- The reviewed diff had no network or security changes and no replacements. The
  compute update removed `AmazonECSTaskExecutionRolePolicy`, added resource-scoped
  ECR/log/secret permissions, and constrained both ECS role trust policies.
- The dependency and compute deployments completed successfully. Runtime remained
  disabled; no image, certificate, DNS, secret value, or production resource was
  changed.
- A post-deployment live diff reported zero differences across network, security,
  and compute.

## 2026-09-02 autonomous hardening checkpoint

- Created isolated local branch `codex/aws-staging-readiness-20260902`; nothing
  was pushed and the two protected untracked paths remain untouched.
- Reconciled stale pre-deployment blockers with the sanitized 2026-09-01
  deployment transcript: bootstrap plus network, security, and compute foundations
  are deployed; runtime, image publication, certificate/DNS, and staging
  configuration remain incomplete.
- Replaced the broad ECS task-execution managed policy with explicit ECR-pull,
  application-log, secret, and KMS permissions. `ecr:GetAuthorizationToken` is
  the only unavoidable wildcard resource action. Both ECS role trust policies
  now require the staging source account and an ECS source ARN.
- Added owner/cost tags, explicit Supabase/Brevo provider pins, fixed task sizing,
  two runtime alarms, container startup validation, CDK invariant tests, and a
  metadata-only AWS inventory helper.
- Added a manual staging-environment GitHub Actions foundation workflow. It uses
  OIDC, validates account and role before CDK, keeps runtime disabled, and cannot
  deploy production. Repository-owner configuration is still required.
- No image was built or pushed. Local Docker availability is irrelevant because
  the deployed clean-archive CodeBuild workflow owns publication. The non-root
  container now fails before server startup when required variable names or
  provider controls are invalid, without logging values.
- Deterministic recurring cost remains `$42.07/month`, leaving `$32.93` beneath
  the authorized ceiling.

## 2026-09-01 staging foundation checkpoint

The third and final controlled orchestration invocation completed successfully
after passing the STS gate for account `559054714699`, role
`TracePointMigrationStaging`, and `us-east-1`. The script verified:

- `CDKToolkit=CREATE_COMPLETE` (bootstrap version 32);
- `tracepoint-staging-network=CREATE_COMPLETE`;
- `tracepoint-staging-security=UPDATE_COMPLETE`;
- `tracepoint-staging-compute=CREATE_COMPLETE`;
- the `$75` monthly cost budget and a deterministic projected recurring cost of
  `$42.07`;
- two public subnets, no NAT gateway, no paid interface endpoint, and active VPC
  Flow Logs;
- an immutable, scan-on-push, KMS-encrypted ECR repository;
- an active ECS cluster with zero running tasks;
- a KMS-encrypted application log group with 30-day retention;
- a retained application-secret container and separate scoped ECS execution and
  task roles; and
- full public-access blocking on the CDK bootstrap asset bucket.

Runtime was not deployed. No image was built or published. Required human inputs
remain the eight staging secret fields (including the three public build values),
an immutable image published by CodeBuild, and an issued `us-east-1` certificate for
`staging.tracepointhq.com`. The deployment role could not verify KMS rotation, so
the script reports that check as unresolved rather than claiming success.

## Current state

Local preparation is approximately **96%** complete. AWS staging foundation
deployment is **100%** for bootstrap/network/security/compute, while runtime is
**0%**. Email conversion is **100%** of the two
inventoried callers; storage boundary conversion is **100%** of the five direct
call sites, with deferred lifecycle policy; database/data-access conversion is
approximately **22.7%** (125 of the original 551 static calls behind used repository boundaries);
Auth conversion is **0%**.
Total provider conversion is approximately **24%**, and total migration is
approximately **47%**, reflecting completed staging foundation infrastructure
but no runtime acceptance, data/identity migration, or production cutover.

Supabase remains authoritative for database, RLS/RPC authorization, Auth, and
storage. Brevo remains the only/default email provider. No AWS provider is
implemented or activated.

The prior verified AWS evidence below is retained for continuity. This storage
run made no AWS API/MCP call and performed no live Supabase or Brevo operation.

## Historical AWS baseline evidence

STS returned account `559054714699` through `us-east-1` at
`2026-08-30T18:53:41Z`. Inventory completed at
`2026-08-30T19:00:42Z` with ACM/Identity Center follow-up at
`2026-08-30T19:09:09Z`.

- No CloudFormation stacks and no `CDKToolkit`.
- Only the default VPC, six default public subnets, main route table, internet
  gateway, and default security group.
- No NAT gateways or VPC endpoints.
- No ECS clusters/services/tasks, ECR repositories/images, load balancers,
  target groups, S3 buckets, customer-created KMS keys, Secrets Manager secrets,
  CloudWatch log groups, Route 53 hosted zones, or ACM certificates.
- Account-level S3 public-access-block configuration is absent.
- Identity Center instance listing succeeded; AWS MCP permission-set listing was
  denied. User-supplied read-only CLI output independently confirmed
  `AdministratorAccess` on permission set `ps-f17d74409ce29842`. No
  management-account call was attempted.

Exact metadata and limitations are in `docs/aws-migration-baseline.md`.

## Work completed locally

- CDK synthesis now requires environment `tracepoint-staging`, account
  `559054714699`, and region `us-east-1`; it separately rejects management
  account `265544358665` and all other accounts/environments/regions.
- `infra/cdk.context.json` remains empty and contains no lookup or secret data.
- Added `scripts/aws-readonly-preflight.ps1` for tool, repository, protected-file,
  AWS identity, account, and region checks. It performs no mutation.
- Added the lockout-safe IAM transition in
  `docs/aws-iam-access-transition.md`; no live permission was changed.
- Added a typed server-only email boundary and converted both Brevo callers.
  Unsupported providers fail closed; no SES/AWS implementation exists.
- Preserved sender/recipient/body/error behavior and digest queue/retry state.
- Added focused provider tests using existing Node tooling only.
- Added a typed server-only object-store boundary and converted every direct
  route-level Supabase Storage call while retaining the same service-role client.
- Added a source-backed storage contract/risk inventory. Supabase is the sole
  storage implementation; unsupported provider values fail closed and no S3
  implementation exists.
- Checkpointed and pushed the validated storage boundary as commit
  `9067b521557e0598f8ad2cf2053bbf1f00cc15d4`.
- Added fail-closed department/domain/traversal validation before service-role
  attachment URL signing; valid links remain 60 seconds.
- Added a deterministic 543-call Supabase data-access inventory and the first
  narrow read repository for imported qualification history. Supabase remains
  sole/default; no AWS database provider exists.

## Validation record

- Next.js 16.2.6 production build: passed; TypeScript and 77 static pages passed.
- Root TypeScript `tsc --noEmit --incremental false`: passed.
- Targeted ESLint: provider files passed; converted call sites passed with the
  pre-existing `no-explicit-any` rule disabled (no new lint findings).
- Focused provider tests: 5/5 passed using Node 24's built-in test runner,
  including exact digest configuration-whitespace parity.
- CDK TypeScript build: passed.
- Historical four-stack CDK synthesis: passed with `--lookups=false` for
  `559054714699`/`us-east-1`/`tracepoint-staging`. Two verified AZs are
  fixed in source; the manifest has zero missing context. Management and non-staging
  environment syntheses failed with the expected guard messages.
- Template assertions: passed across 42 resources; no NAT, interface endpoint,
  bucket, CloudTrail, GuardDuty, Security Hub, or Config resource; one S3 gateway
  endpoint; one public-IP ECS service; task ingress only from the ALB SG.
- OpenAPI 3.1 YAML: parsed; 3 paths and 3 operations with unique IDs.
- Read-only preflight with `-SkipAws`: passed. Live identity was already verified
  through AWS MCP and was not duplicated through the CLI.
- Credential/private-key signature scan: passed across 43 migration-related
  files, including every new untracked candidate; no values were printed.
- Generated-artifact tracking check: passed; no CDK/Next/dist/tsbuildinfo output
  is tracked.
- `git diff --check`: passed after removing Markdown trailing whitespace; CRLF
  conversion notices are informational.
- `src/app/integration-demo/page.tsx`: remains untracked and was not modified.
- Image publication: skipped because staging configuration was incomplete; local
  Docker is not required and nothing was installed.

Storage-boundary validation on 2026-08-30:

- Next.js 16.2.6 production build: passed, including TypeScript and 77 static pages.
- Root TypeScript check and targeted ESLint: passed.
- Focused email plus storage tests: 9/9 passed; storage cases cover exact domain
  paths, bucket pinning, upsert values, 60-second signing, download filename,
  public URL/removal, and unsupported-provider rejection.
- Direct-call scan: every active `storage.from(...)` call is confined to
  `SupabaseObjectStore`; no route or browser component retains direct access.

Post-checkpoint validation on 2026-08-31 includes focused storage and repository
tests, TypeScript, lint, production build, deterministic inventory repeatability,
offline CDK/guard/template checks, OpenAPI parsing, diff/signature/artifact scans,
and the protected-file check. Exact results are recorded in the session handoff;
all post-checkpoint work remains uncommitted.

Completed results: 17/17 focused email/storage/repository tests; root TypeScript
and targeted ESLint passed; Next.js production build passed with 77 static pages;
CDK TypeScript build and four-stack offline synthesis passed with zero lookups;
management-account and non-staging guards rejected as expected; 42-resource
template assertions passed; OpenAPI 3.1 parsed with three paths/operations;
inventory output repeated byte-for-byte and the selected route has zero direct
Supabase calls.

## Files changed in this run

- Infrastructure/safety: `infra/bin/tracepoint-infra.ts`,
  `infra/lib/network-stack.ts`, `infra/README.md`,
  `scripts/aws-readonly-preflight.ps1`, and root `tsconfig.json`.
- Email boundary: `src/lib/email/provider.ts`,
  `src/lib/email/provider-core.ts`, `src/lib/email/provider.test.ts`,
  `src/lib/tracepoint/activation.ts`, and
  `src/app/api/notifications/email-dispatch/route.ts`.
- Migration evidence/runbooks: `docs/aws-migration-baseline.md`,
  `docs/aws-migration-status.md`, `docs/aws-cdk-diff-review.md`,
  `docs/aws-iam-access-transition.md`, `docs/aws-production-readiness-gates.md`,
  `docs/aws-provider-abstraction-design.md`,
  `docs/aws-provider-conversion-status.md`,
  `docs/aws-module-migration-matrix.md`, and
  `docs/aws-migration-commit-plan.md`.

Post-checkpoint changes are intentionally unstaged and uncommitted: attachment
path validation/tests; the qualification-history repository, tests and selected
route; the deterministic inventory script/report; and directly related database,
storage, provider, validation, readiness and status documentation.

## Blockers

- No staging ACM certificate or published immutable image exists, and runtime
  remains undeployed. ECR, the independent foundation stacks, and the image-build
  stack exist. Image publication needs the five build-time secret fields; runtime
  additionally needs `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, and
  `NOTIFICATION_DISPATCH_SECRET`.
- Account-level S3 public-access-block remains unverified; the deployed bootstrap
  bucket itself blocks all public access and no application bucket is deployed.
- `TracePointMigrationStaging` administrative attachment cannot be changed from
  staging and must transition through a verified management-owned emergency path.
- GitHub OIDC trust, environment protection, and the exact staging deployment
  role variable require repository/platform-owner configuration.
- Runtime secrets, approved staging public build configuration, and the staging
  certificate/DNS path remain required. The clean-source AWS-native builder is
  deployed and no local Docker engine is required.
- Storage policy work remains: align the patch route's 5 MB limit with the
  UI/bucket's 2 MB limit, define old-patch cleanup, prove/create the
  `tracepoint-attachments` bucket policy in a controlled migration, and decide
  retention/archive/orphan handling.
- Data conversion has only one read pilot. The 24 browser calls, 65 RPC calls,
  service-role tenant review queue, security-definer/search-path review,
  transactional workflows, RLS claims and Auth coupling remain blockers.

## Next live actions, in safe order

1. Management owner verifies an independent emergency administrator path and the
   current permission-set attachments without granting staging access to the
   management account.
2. Platform/security owners approve the S3 public-access baseline, CDK qualifier,
   permissions boundary, bootstrap execution policy, CI trust, and routine roles.
3. Configure GitHub's protected `aws-staging` environment, OIDC trust, and
   `AWS_STAGING_DEPLOY_ROLE_ARN` repository variable.
4. Under separate approval, create the least-privilege bootstrap/image/deployer
   prerequisites and remove `AdministratorAccess` only after replacement paths
   pass positive and negative tests.
5. Request/validate the staging certificate and configure DNS only through the
   owning platform workflow.
6. Populate secrets through concealed input, then use the clean-archive CodeBuild
   workflow to build and scan an immutable image; synthesize again and review the
   runtime `cdk diff`/change set.
7. Deploy runtime only after all gates pass, then
   run non-production staging acceptance. No provider or live-user cutover is
   implied.
