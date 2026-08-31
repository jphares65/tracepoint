# TracePoint AWS migration status

**Last updated:** 2026-08-30
**Target:** `tracepoint-staging`, account `559054714699`, `us-east-1`
**Hard deny:** management account `265544358665`
**AWS activity in the storage-boundary run:** none; all work was local and source-only

## Current state

Local preparation is approximately **95%** complete. AWS staging deployment is
**0%** (no bootstrap or stacks). Provider conversion is approximately **10%** of
the overall Supabase/Brevo surface: both email callers and all five direct
Supabase Storage call sites have typed, provider-pinned boundaries, while Auth,
authorization, database, and RLS are untouched. Total migration is approximately
**33%**, reflecting that infrastructure deployment,
staging acceptance, data/identity work, and production cutover remain undone.

Supabase remains authoritative for database, RLS/RPC authorization, Auth, and
storage. Brevo remains the only/default email provider. No AWS provider is
implemented or activated.

The prior verified AWS evidence below is retained for continuity. This storage
run made no AWS API/MCP call and performed no live Supabase or Brevo operation.

## Verified AWS staging evidence

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

## Validation record

- Next.js 16.2.6 production build: passed; TypeScript and 77 static pages passed.
- Root TypeScript `tsc --noEmit --incremental false`: passed.
- Targeted ESLint: provider files passed; converted call sites passed with the
  pre-existing `no-explicit-any` rule disabled (no new lint findings).
- Focused provider tests: 5/5 passed using Node 24's built-in test runner,
  including exact digest configuration-whitespace parity.
- CDK TypeScript build: passed.
- Four-stack CDK synthesis: passed with `--lookups=false` for
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
- Docker build: skipped because Docker is unavailable; nothing was installed.

Storage-boundary validation on 2026-08-30:

- Next.js 16.2.6 production build: passed, including TypeScript and 77 static pages.
- Root TypeScript check and targeted ESLint: passed.
- Focused email plus storage tests: 9/9 passed; storage cases cover exact domain
  paths, bucket pinning, upsert values, 60-second signing, download filename,
  public URL/removal, and unsupported-provider rejection.
- Direct-call scan: every active `storage.from(...)` call is confined to
  `SupabaseObjectStore`; no route or browser component retains direct access.

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

The subsequent uncommitted storage-boundary review changes are:
`src/lib/storage/object-store-core.ts`, `src/lib/storage/object-store.ts`,
`src/lib/storage/object-store.test.ts`, the qualification/training/firearm upload
routes, the shared attachment-download route, the department-patch route,
`docs/aws-storage-contract-inventory.md`, this status, the provider conversion
status, and the module migration matrix. They are intentionally left unstaged and
uncommitted for human review.

## Blockers

- Account is not CDK-bootstrapped; bootstrap is explicitly unauthorized here.
- No staging ACM certificate, published immutable image, ECR repository, or
  deployed stack exists.
- Account S3 public-access-block baseline is absent.
- `TracePointMigrationStaging` administrative attachment cannot be changed from
  staging and must transition through a verified management-owned emergency path.
- Final bootstrap qualifier, permissions boundary, CI OIDC subject, execution
  policy, and exact bootstrap role ARNs require platform approval.
- DNS/certificate, secrets, image publishing, billing controls, and deployment
  require separate authorized actions.
- Storage remediation remains local work: align the patch route's 5 MB limit with
  the UI/bucket's 2 MB limit, define old-patch cleanup, validate attachment paths
  before service-role signing, prove/create the `tracepoint-attachments` bucket
  policy in a controlled migration, and add route-level negative tenant tests.

## Next live actions, in safe order

1. Management owner verifies an independent emergency administrator path and the
   current permission-set attachments without granting staging access to the
   management account.
2. Platform/security owners approve the S3 public-access baseline, CDK qualifier,
   permissions boundary, bootstrap execution policy, CI trust, and routine roles.
3. Under separate approval, create the least-privilege bootstrap/image/deployer
   prerequisites and remove `AdministratorAccess` only after replacement paths
   pass positive and negative tests.
4. Request/validate the staging certificate and configure DNS only through the
   owning platform workflow.
5. Build and scan an immutable image, populate secrets through concealed input,
   synthesize again, and review `cdk diff`/change set for additions only.
6. Obtain explicit deployment approval; deploy foundation before runtime, then
   run non-production staging acceptance. No provider or live-user cutover is
   implied.
