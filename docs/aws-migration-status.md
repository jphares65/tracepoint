# TracePoint AWS Migration Status

**Last updated:** 2026-08-30
**Target boundary:** future dedicated TracePoint staging AWS Organizations member account, `us-east-1` only
**Excluded account:** Organizations management account `265544358665`
**Operating constraints:** no production access, secret-value exposure, AWS account creation, bootstrap, certificate/DNS action, deployment, deletion, billing change, or live-agency cutover

**Current gate:** approved architecture and all safe local documentation are complete and validated. AWS work is stopped until the dedicated member account and platform prerequisites exist.

**Migration completion:** approximately 90% of safe pre-account work. Remaining work is account creation/platform setup, Docker image build/scan, real CDK bootstrap/diff, and separately approved deployment/cutover.

## Completed

- Verified and inventoried the former staging target read-only; findings remain in `docs/aws-migration-baseline.md` but that management account is no longer a deployment target.
- Reviewed repository runtime dependencies and retained Supabase database,
  authentication, storage, and Brevo email for the first hosting phase.
- Completed the pre-deployment cost/redundancy review in
  `docs/aws-staging-cost-and-deployment-review.md`.
- Adopted the lean estimate of approximately **$42.07/month** at modeled usage;
  actual member-account security-baseline and traffic charges remain variable.
- Revised the local CDK assembly from six stacks to four lowercase application
  stacks and documented the template delta in `docs/aws-cdk-diff-review.md`.
- Compiled the CDK project and synthesized the complete four-stack assembly with
  fictional local-only account/certificate inputs.
- Verified synthesis fails closed for management account `265544358665`.
- Built the Next.js 16 production application successfully using the protected
  local Server Action build-key path.
- Preserved Geist/Geist Mono typography with local variable-font assets and
  `next/font/local`; the production build requires no Google font download.
- Added the complete SIL Open Font License 1.1 and upstream copyright notice
  beside the unmodified font assets.
- Completed the migration-only file manifest and commit preparation plan.
- Completed repository-wide Supabase/schema, module matrix, database, Cognito,
  provider-boundary, storage/email, dormant OpenAPI, threat/security,
  operations, and production-gate documentation.

## Adopted decisions

- Deploy only to a dedicated AWS Organizations member account for TracePoint staging.
- Use one public-IP Fargate task with inbound TCP 3000 permitted only from the
  HTTPS ALB security group.
- Use ALB-only initially; CloudFront is deferred.
- Use `staging.tracepointhq.com` and an exact-name DNS-validated ACM certificate
  in `us-east-1`, owned by the platform/DNS function.
- Keep CloudTrail, GuardDuty, Security Hub, and Config outside the application
  assembly under a separate organization-aware platform/security baseline.
- Retain `tracepoint/staging/application`; provide the Server Action key to
  `next build` through a required BuildKit secret mount and inject the same
  secret version through ECS at runtime.
- Defer the unused attachment bucket and remove the unused application security group.
- Keep one task for staging and accept its limited availability.
- Standardize stack and named-resource identifiers on lowercase
  `tracepoint-staging-*` naming.
- Use separate least-privilege image-builder and deployer roles administered as
  member-account prerequisites, not self-created by the application assembly.

## Implemented locally

- Network: two public subnets across two AZs, no NAT, no paid interface
  endpoints, S3 gateway endpoint, VPC Flow Logs, and restricted default SG.
- Security: retained rotating KMS key only. The former shared log bucket and
  application SG are removed.
- Compute: immutable ECR, one ECS cluster with Container Insights disabled,
  retained 30-day encrypted logs, retained encrypted JSON secret, and named ECS
  execution/task roles.
- Runtime: HTTPS ALB with HTTP redirect, one public-IP task, ALB-only task
  ingress, health check, minimum healthy capacity, and circuit-breaker rollback.
- Application: standalone Next.js container, `/api/health`, deployment ID,
  self-hosted Geist fonts, and required protected build-secret mount.
- Assembly: attachment storage and account security services are excluded.
- Guardrails: explicit member account, lowercase environment, and `us-east-1`
  validation; hard refusal for the management account.

## Validation results

- `npm.cmd run build` in `infra`: passed.
- Management-account synthesis guard: passed by failing with the expected refusal.
- Full four-stack local synthesis: passed using fictional account `111122223333`,
  placeholder ACM ARN, and placeholder immutable tag; no AWS credential/API was used.
- Next.js production build: passed, including TypeScript and all 77 static pages.
- Synth inspection: passed—one task, public IP enabled, task ingress solely from
  the ALB SG, HTTPS listener/HTTP redirect, secret retention, no NAT/interface
  endpoints, and no CloudTrail/GuardDuty/Security Hub/Config/S3 bucket resources.
- Targeted ESLint for the migration-touched Next.js files: passed.
- Targeted ESLint emitted one expected warning that `src/app/globals.css` is not
  a configured ESLint file; there were zero errors.
- OpenAPI YAML parsed with the existing `js-yaml` dependency: three paths
  validated, one implemented-internal and two proposed-not-implemented.
- Migration-manifest scan found no AWS access-key or private-key signatures.
  Matches were documented secret names/placeholders/IaC field names only; no
  secret values were printed or retrieved.
- Manifest/status comparison found 49 allowlisted paths and exactly one
  excluded extra: `src/app/integration-demo/page.tsx`.
- `git diff --check`: passed; existing LF-to-CRLF notices are informational.
- Docker image build/scan: not run because Docker is not installed; no software
  was installed as part of this revision.

## Remaining account-creation requirements

The Organizations/platform owner must provide or approve:

1. A unique member-account name and email, target OU, management-account payer
   relationship, and the resulting 12-digit account ID. Codex must not create it.
2. SCPs and region controls that permit the approved staging services in
   `us-east-1` while denying production access, Organizations/account mutation,
   unsupported regions, and billing changes for application identities.
3. IAM Identity Center assignments for platform administrator, security auditor,
   application deployer, and read-only/operator ownership with MFA/session policy.
4. Organization security-baseline enrollment: centralized CloudTrail/log archive,
   GuardDuty and Security Hub delegated administration, Config recorder/aggregator,
   and finding/remediation ownership. None belongs to the app stack.
5. Route 53 ownership or delegated subdomain authority for
   `staging.tracepointhq.com`, plus approval to request/validate the exact-name ACM
   certificate later. No DNS or certificate action has occurred.
6. A dedicated CDK bootstrap qualifier, trusted CI/OIDC principal, permissions
   boundary ARN, asset encryption/retention choices, and customer-managed
   CloudFormation execution policy for only the synthesized service/resource scope.
7. Creation of `tracepoint-staging-image-builder` and
   `tracepoint-staging-deployer` with the trust/pass-role boundaries documented
   in `infra/README.md`; exact ARNs cannot be finalized before account creation.
8. Service quotas and tag/cost-allocation policy confirmation. Any budget or
   billing configuration requires separate owner action and is outside this task.

## Next steps after prerequisites exist

1. Create the dedicated Organizations member account and provide its ID, then
   replace fictional synthesis inputs with the real member account, AZ context,
   certificate ARN, and immutable scanned image tag.
2. Review the proposed bootstrap template, permissions boundary, deployment-role
   policies, and platform baseline under separate approval.
3. Bootstrap only after explicit authorization, then run a real `cdk diff` and
   confirm additions only—no deletion, replacement, IAM expansion, DNS, or
   account-security resources.
4. Stop again for explicit deployment approval. No deployment is authorized by
   the current decisions.
