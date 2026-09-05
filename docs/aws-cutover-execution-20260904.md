# TracePoint cutover execution package — 2026-09-04

> Historical September 4 checkpoint. Superseded by `aws-migration-checkpoint-20260905.md` and the September 5 evidence files. Earlier claims about unavailable GitHub/AWS, missing S3 integration, and unexecuted staging acceptance/rollback are no longer current.

Status: staging operational; production cutover is NOT authorized or ready. Target Wednesday, September 9, 2026. This package intentionally retains production Supabase and Brevo for the first AWS hosting cutover. Database/Auth/Storage/email provider replacement remains a separate migration.

Final provider addendum: `src/lib/email/ses-provider.ts` now exposes a prepared server-only SES v2 adapter using the default credential chain and one SDK attempt. Five mocked tests cover content mapping, mandatory configuration sets, suppression/outage blocking, header rejection and ambiguous outcomes. The live selector still rejects SES. Supply persistent suppression state and validated bounce/complaint events before activation; an SES MessageId proves acceptance, not delivery. No email was sent. The later SES implementation checklist below still requires live integration and validation.

Private S3 integration must first replace the synchronous `getDepartmentPatchPublicUrl` contract with authorized delivery or asynchronous signing and update callers. Making a bucket public is not a substitute. GitHub push was unavailable in this run; recover the committed Git bundle and push before using release commands.

## Commands available now

Run from a clean checkout of `codex/aws-staging-readiness-20260902`. Use PowerShell 7 for CI; public smoke and safety tests also work with Windows PowerShell 5.

```powershell
npm ci
npm ci --prefix infra
npm test --prefix infra
node --test scripts/*.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-deployment-safety.ps1
node scripts/validate-clean-bootstrap.mjs
# Optional full synthetic restore rehearsal; use trusted PostgreSQL 18 client binaries:
$env:TRACEPOINT_PG_BIN = 'C:/path/to/postgresql/bin'
node scripts/validate-clean-bootstrap.mjs --rehearse-restore
node scripts/test-staging-http.mjs
npx playwright install chromium
node scripts/test-staging-acceptance.mjs
```

Acceptance obtains a session through the existing login form. Set `TRACEPOINT_ACCEPTANCE_EMAIL`, `TRACEPOINT_ACCEPTANCE_PASSWORD`, and `TRACEPOINT_ACCEPTANCE_DEPARTMENT_ID` privately to a disposable staging manager and its department. The harness permits browser requests only to the staging app and staging Supabase project. Set `TRACEPOINT_ACCEPTANCE_FOREIGN_DEPARTMENT_ID` for a second isolated test department. Set `TRACEPOINT_ACCEPTANCE_WRITES=disposable-staging` for type Add/Edit/Archive/Restore/Remove; cleanup runs in `finally`. No customer fixture is authorized. No session state, trace, screenshot, response body or credential is saved.

Exit 1 means a tested check failed; exit 2 means full acceptance has blocked coverage. `--smoke` permits exit 0 when implemented authenticated smoke checks pass, while still reporting incomplete workflow coverage. It is not full acceptance. Page loads do not establish that assignment/history/Officer UI, drill protections, actual reports, files or role-negative mutations work. Those scenarios require further fixtures and execution.

With a valid staging session, the single-command metadata/health report is:

```powershell
./scripts/get-tracepoint-staging-inventory.ps1
```

It checks identity and strict ECS/ALB health, and reports certificate, image, retention, budget metadata, alarm action counts and recent error-event count. It never prints log messages or secret contents. Missing metadata permission is reported, not counted as a pass.

## Staging publication and recovery

After source review and commit/push:

```powershell
./scripts/publish-tracepoint-staging-image.ps1 -ValidateArchiveOnly
./scripts/publish-tracepoint-staging-image.ps1 -Wait
./scripts/release-tracepoint-staging.ps1 -ImageTag (git rev-parse HEAD) -CertificateArn $env:STAGING_CERTIFICATE_ARN
```

Publication uploads tracked-only source, captures that upload's S3 VersionId, binds CodeBuild to it, and waits for the build and scan. ECR must be immutable; deploy and rollback reject incomplete scans or HIGH/CRITICAL findings. Strict synth and CDK diff must succeed. A structural template gate permits only replacement of the existing container image with the exact commit in the same repository and additional CloudWatch alarms; it rejects resource removal, IAM additions, secret changes, desired-count changes and unexpected parameters/outputs. Normal immutable ECS task-definition replacement is permitted. The printed CDK diff still requires review, and live drift is not proven offline. The release wrapper captures a healthy previous task definition, deploys, waits for stability, enforces desired/running 1/1 and healthy target, and runs authenticated smoke. Missing acceptance credentials stop it before deployment. An unsuccessful changed revision triggers a validated older revision recovery.

```powershell
# Dry-run verification, then the exact same target with -Execute for staging only:
./scripts/invoke-tracepoint-staging-rollback.ps1 -TaskDefinitionArn $previousTaskArn
./scripts/invoke-tracepoint-staging-rollback.ps1 -TaskDefinitionArn $previousTaskArn -Execute
```

Recovery uses ECS update-service and temporarily creates CloudFormation drift. Reconcile the runtime stack to the recovered commit before another release. The previous image must still exist and pass scanning. If the circuit breaker already restored the old task, the wrapper does not repeat recovery. Live build/deploy/recovery is not validated in this run because AWS credentials were inaccessible.

## GitHub OIDC final setup

The added workflow `.github/workflows/aws-staging-runtime.yml` is manually dispatched on the AWS branch and uses `aws-staging`, short-lived OIDC credentials, and a fixed allowed account. No access keys are stored. Before enabling it:

1. Configure a staging deploy role whose name contains `TracePointMigrationStaging`, in account `559054714699`; restrict GitHub OIDC trust to audience `sts.amazonaws.com` and subject `repo:jphares65/tracepoint:environment:aws-staging`. Configure the role's maximum session duration for the workflow's 7200 seconds. Reuse the reviewed staging deploy permissions; do not grant production/management access.
2. In GitHub environment `aws-staging`, restrict deployment branches to `codex/aws-staging-readiness-20260902`, require the designated reviewer, and prevent self-review. Protect the branch against force-push and require validation checks. Workflow dispatch cannot run until the workflow is discoverable by GitHub (normally present on the default branch); merge the reviewed workflow to main through normal review if necessary.
3. Set environment variables `AWS_STAGING_DEPLOY_ROLE_ARN`, `STAGING_CERTIFICATE_ARN`, `STAGING_ACCEPTANCE_DEPARTMENT_ID`; set environment secrets `STAGING_ACCEPTANCE_EMAIL`, `STAGING_ACCEPTANCE_PASSWORD`. No application service-role credential is used by browser acceptance.
4. Execute once and retain the build ID, source VersionId, image digest, task revision and acceptance output. OIDC trust/environment setup and the end-to-end workflow remain unverified.

## Production account and offline assembly

No accessible production profile was found; the local AWS directory was inaccessible. This does not establish whether a production account already exists. Jason must identify/provision a dedicated workload member account through the organization's authorized administrator, supply its exact account ID and `TracePointMigrationProduction` role, and make a short-lived profile accessible. Do not operate in management account `265544358665`; do not reuse staging account `559054714699`.

```powershell
cd infra
npx cdk synth --strict --lookups=false --output cdk.out.production-preview -c productionPreview=true -c account=111111111111 -c region=us-east-1 -c runtimeEnabled=true -c certificateArn=arn:aws:acm:us-east-1:111111111111:certificate/00000000-0000-4000-8000-000000000000 -c imageTag=6b0e3028f3e5e97d567de20c05637bb0cb64e7b7 --quiet
```

`111111111111` is a synthetic preview identity, NEVER an approved target. Production preview separates resource/secret names, certificate/account references, two desired tasks, scaling to four, one-year application logs, retained resources, stack termination protection, and ALB deletion protection. Other retained service log settings remain as synthesized. Production uses its own application secret, and the container guard rejects staging Supabase/site configuration. The production buildspec rejects staging, management and placeholder accounts. Its canonical hostname is provisionally `tracepointhq.com`; confirm apex/www behavior before enabling production. The real deployment assembly remains staging-only until the exact production allowlist and live role checks are reviewed. No live production diff is claimed.

Further required engineering/validation: production account gate and deploy wrapper, multi-task Next.js cache/session/load behavior, WAF/rate limits, actionable alarm destinations, backup ownership/restore evidence, production certificate, and agency-approved capacity/cost. There is no deployed AWS database or S3 application-storage stack in this assembly. Do not mistake retained build-source storage for application backups.

## Hosting cutover sequence and objective rollback

1. Resolve the account/role gate, stage the reviewed patch image, complete authenticated acceptance, and verify a clean source and container scan. Run `validate-production-cutover.mjs` against reviewed evidence JSON. The validator requires account/role/region, immutable forward/rollback digests, certificate, and every named gate. It validates the supplied evidence structure; it does not independently verify AWS or grant execution authority.
2. In the separate production account, install only production application secrets. Validate eight names privately; confirm production Supabase `izlkwggluhlhzlumtzes`, production Brevo account, canonical site, notification dispatch secret, and a common Server Actions encryption key. Publish a separate production image because NEXT_PUBLIC values are compiled into the client bundle. Never promote the staging image as-is.
3. Obtain an issued production ACM certificate, deploy the reviewed production stack after an exact STS gate, and test through a private review hostname/Host routing before DNS. Configure Supabase redirect/callback allowlists for the intended production hostname before authentication testing. Validate cookie/session behavior and email links on that hostname.
4. Preserve current DNS records, TTLs, Vercel rollback hostname and healthy previous image. Confirm rollback DNS access and escalation contacts. Proposed hosting recovery objective: RTO <=30 minutes; database RPO 0 for hosting-only rollback because both hosts use the SAME unchanged production database. These are targets, not measured guarantees.
5. No production database export/import or storage copy is needed for this hosting-only change. Do not introduce a schema migration during it. If changing providers, stop and use a separately authorized transfer with an enforced write freeze and rehearsed reconciliation; there is currently no validated maintenance/read-only switch.
6. After explicit traffic-cutover approval, the DNS owner changes only the approved production record to the production ALB. Validate TLS/SNI, public login/health, authenticated tenant resolution, writes, Officer assignments, reports, downloads and logout from the production hostname. Keep Vercel available for at least 48 hours and through the agency acceptance window.
7. Monitor continuously for 60 minutes, then every 15 minutes for four hours, then daily for 48 hours. Roll back immediately on ANY cross-tenant access, lost/corrupt write, wrong actor identity, secret exposure or failed login. Roll back on three consecutive 30-second health failures, no healthy target for two minutes, or >5% application 5xx for five minutes with >=20 requests. These production thresholds require instrumentation and an accountable operator before cutover.
8. DNS rollback restores the captured original records. Application rollback selects the known-good production digest in the production stack after its own exact account/role/region gate; staging rollback tooling must never be used for production. DNS caches can outlive TTL. Continue checking both origins until propagation settles.
9. DNS/application rollback never rewinds database writes. Preserve writes made on AWS, audit events, file keys and notifications. Compare transaction/audit continuity and suppress duplicate dispatch. If a later database migration admits new writes, restoring an old snapshot requires a separately approved loss/replay/reconciliation decision; do not simply reverse a connection string.

## Data, storage, auth and email exit

`validate-clean-bootstrap.mjs --rehearse-restore` is idempotent: it creates new disposable local databases, applies all migrations, runs real RLS negative checks, dumps/restores, compares all public table counts/checksums and policy definitions, then removes its temporary database. It never opens production connections. It supplies auth/storage compatibility scaffolding, so it does NOT prove a managed Auth/Storage replacement or production-size RTO.

`staging-data-manifest.mjs` uses an exact staging hostname, trusted TLS and a repeatable-read/read-only transaction. It paginates rows through a cursor, emits only counts/SHA-256 fingerprints and RLS/FK metadata, and rejects unvalidated foreign keys. It needs `TRACEPOINT_STAGING_DB_URL`; for a non-system CA, configure `NODE_EXTRA_CA_CERTS`. Direct DNS/credentials were unavailable in this run. `verify-staging-schema.mjs` now compares exact migration versions rather than count alone. It also requires trusted TLS.

`migration-manifest.mjs storage DIRECTORY` inventories local staged files by relative key, size and SHA-256; symlinks are rejected. `compare BEFORE.json AFTER.json` fails on added/missing/changed objects. Do not put its output inside the inventoried directory. Tested synthetic corruption/loss detection is not a live Supabase-to-S3 copy. Actual provider transfer, metadata mapping, quarantine, retention and tenant-signed download validation remain unfinished; follow `aws-storage-migration-runbook.md`.

Auth exit must preserve immutable application user UUIDs while explicitly mapping a replacement issuer subject; never match identity solely by email. The supported planned migration is a test cohort with activation/password reset, followed by session expiry/revocation at final switch. No password-hash portability, Cognito deployment, MFA migration or dual-issuer implementation has been validated. Use the existing auth runbooks; do not promise seamless session transfer.

Brevo remains the only working email implementation. SES needs a tested adapter, verified production sender/DKIM, production send access, bounce/complaint events, suppression import and opt-out enforcement, idempotent notification delivery, and end-to-end reset/invite tests. Do not move transactional mail before suppression and bounce handling work. No SES sending was attempted.

Secrets: replace a staging secret version through the existing secret installer, publish/redeploy when public build variables or Server Actions keys change, verify authenticated health, then revoke old provider credentials. A retained secret version is not proof that provider-side revocation/rotation was rehearsed. Never print values or commit local environment files.

GovCloud portability remains blocked on vendor exit and account/partition-specific implementation: Supabase Auth/PostgREST/Storage and Brevo remain external services, current ARNs/regions assume the commercial partition, and the standard PostgreSQL scaffold is not a compliant authorization service. No GovCloud compatibility or compliance claim is made.
