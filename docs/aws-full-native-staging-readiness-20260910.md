# AWS-native staging readiness — 2026-09-10

## Decision

**NOT READY to deploy or switch providers.** The proposed staging infrastructure synthesizes without a CloudFormation dependency cycle and does not replace the working S3/KMS storage provider, but full-native staging is blocked by a broken PostgreSQL migration ledger, an out-of-date lineage baseline, three absent runtime secret keys, bridge-only secret tooling/schema, unresolved direct Supabase application paths, failed SES domain verification plus SES sandbox status, no staging AWS Backup composition, and the absence of executable synthetic data/auth migration orchestration.

This review was read-only against AWS account `559054714699` in `us-east-1`. No stack, resource, secret value, DNS record, image, email, running task, provider selection, real Supabase record, customer department, customer data, or storage object was changed or accessed. The source baseline was evidence commit `7ff3d5db383a7a46c831f798335a4e31893a0180` on dedicated branch `codex/aws-full-native-staging-readiness-20260910`.

Evidence time: 2026-09-10 19:29 UTC for billing; final CloudFormation status refresh occurred later in the same review. Identity was gated to `arn:aws:sts::559054714699:assumed-role/AWSReservedSSO_TracePointMigrationStaging_52cda9da92884a87/jason.phares`.

## Current live inventory

### CloudFormation

All listed stacks have termination protection enabled.

| Stack | Status | Provider-readiness significance |
|---|---|---|
| `tracepoint-staging-network` | `UPDATE_COMPLETE` | VPC exists; database subnets/SG do not |
| `tracepoint-staging-security` | `UPDATE_COMPLETE` | Existing data KMS key is reusable |
| `tracepoint-staging-compute` | `UPDATE_COMPLETE` | ECS/ECR/secrets/log foundation exists |
| `tracepoint-staging-image-build` | `UPDATE_COMPLETE` | Deployed build project is bridge-oriented |
| `tracepoint-staging-storage` | `UPDATE_COMPLETE` | Working S3/KMS provider; preserve in place |
| `tracepoint-staging-runtime` | `UPDATE_COMPLETE` | Running bridge/Supabase/Supabase/Brevo + S3 |
| `tracepoint-staging-alert-delivery` | `UPDATE_COMPLETE` | Existing alerts; current full-native diff also changes service policies |
| `tracepoint-staging-request-controls` | `UPDATE_COMPLETE` | Existing WAF controls; not in this assembly |
| `tracepoint-staging-github` | `UPDATE_COMPLETE` | Existing OIDC/release foundation |
| `tracepoint-staging-ses-foundation` | `CREATE_COMPLETE` | Disabled SES identity/feedback transport exists |
| `tracepoint-staging-cognito` | `UPDATE_COMPLETE` | Healthy imported/upgraded Cognito pool, client, domain |
| `tracepoint-staging-cognito-foundation` | `ROLLBACK_COMPLETE` | Historical failed shell; see history below |

There is no live `tracepoint-staging-database` or `tracepoint-staging-ses-feedback-worker` stack. There is no staging AWS Backup stack.

### Network and database

- VPC `vpc-0ca78b26941a52795`, CIDR `10.40.0.0/16`.
- Two public subnets only: `10.40.0.0/24` in `us-east-1a` and `10.40.1.0/24` in `us-east-1b`; public IPv4 assignment is enabled.
- No NAT gateway. One S3 gateway endpoint (`vpce-02b...`) exists.
- Live security groups are the ALB SG, ECS task SG, and default SG. No database SG exists. The ECS task SG currently has internet HTTPS and VPC DNS egress, but no PostgreSQL rule.
- No RDS DB instances, clusters, DB subnet groups, or manual RDS snapshots exist.
- No AWS Backup vault or plan exists.

### Runtime and storage

- ECS service is healthy at desired/running/pending `1/1/0`, task-definition revision 26.
- Running immutable image: `43cc2be7cf4760420aac66721b637d7859e05125`, digest `sha256:8944fec62347ed309474fda31145640083c94df96c67b5999e7c79010413b3db`.
- Live providers are `bridge + supabase + supabase + brevo + s3` (runtime, data, auth, email, storage).
- Application bucket is `tracepoint-staging-private-559054714699`, encrypted by the existing staging KMS key, Bucket Keys enabled, Block Public Access enabled, versioned, and already proven by the preceding release. The full-native storage stack diff is empty.
- Application and image-build log groups are KMS encrypted with 30-day retention and minimal current stored bytes.
- There is no TracePoint feedback Lambda. The only observed Lambda outside the proposed assembly is a CDK custom-resource function.

### Cognito

- One user pool: `us-east-1_Y9GiDA5Zy`, name `tracepoint-staging`, deletion protection active, `ESSENTIALS`, MFA `ON`, zero estimated users, Cognito default email, no Lambda triggers.
- App client: `4apeul5qohqgnf7d10ta2lk5qe`; no client secret; authorization-code grant with PKCE-compatible public client; scopes `openid email`; SRP auth; access/ID tokens 5 minutes; refresh 1,440 minutes; refresh rotation enabled with 10-second grace; revocation enabled.
- Exact callback: `https://staging.tracepointhq.com/api/auth/cognito/callback`; logout: `https://staging.tracepointhq.com/login`.
- Active prefix domain: `tracepoint-staging-559054714699.auth.us-east-1.amazoncognito.com`; no custom domain.

#### `ROLLBACK_COMPLETE` history

The 2026-09-05 `tracepoint-staging-cognito-foundation` create attempted a `LITE` pool with refresh-token rotation. Cognito rejected app-client creation because refresh-token rotation is not available with that Lite feature composition. Domain creation was cancelled, and rollback retained the empty, deletion-protected user pool (`DELETE_SKIPPED`) while removing/cancelling the other resources.

The replacement stack `tracepoint-staging-cognito` then imported that same retained pool (`IMPORT_COMPLETE`), upgraded it in place to `ESSENTIALS`, and successfully created the client and prefix domain. It is the healthy owning stack. There is not a second live pool. The failed stack can remain as historical metadata; deleting it is a separately reviewed destructive operation because termination protection and retained-resource ownership must first be proven safe.

### SES and feedback transport

- SES account is healthy but still sandboxed: production access `false`, maximum 200 messages/day and 1 message/second, zero sent in the preceding 24 hours. Account suppression covers bounces and complaints.
- Identity `staging.tracepointhq.com` exists but sending is disabled. Identity verification, DKIM, and custom MAIL FROM are all `FAILED`; last failure was `HOST_NOT_FOUND` on 2026-09-08.
- Existing resources: configuration set `tracepoint-staging`, event destination, KMS-encrypted SNS feedback topic, KMS-encrypted feedback queue and DLQ, queue policies, and subscription. No worker consumes the queue.
- Full-native CDK adds a second configuration set, `tracepoint-staging-cognito`, for Cognito-generated mail.

### Secrets

- One application secret exists: `tracepoint/staging/application`, encrypted with the existing staging KMS key.
- A key-name-only read found: `BREVO_API_KEY`, `CONFIGURATION_ENVIRONMENT`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, `NOTIFICATION_DISPATCH_SECRET`, and `SUPABASE_SECRET_KEY`.
- Required native keys are absent: `TRACEPOINT_IMPORT_APPROVAL_SECRET`, `TRACEPOINT_AUTH_STATE_KEYS`, and `TRACEPOINT_AUTH_REFRESH_KEYS`.
- Database migrator/runtime secrets do not exist because the database stack does not exist.
- No secret values were displayed or retained. The committed `tracepoint-staging-secret.schema.json` and replacement script accept only the eight bridge-era keys and reject additions, so both must be revised before safe secret population.

## Exact full-native provider configuration

The only accepted runtime tuple is:

```text
TRACEPOINT_RUNTIME_PROVIDER_MODE=aws-native
TRACEPOINT_DATA_PROVIDER=postgres
TRACEPOINT_AUTH_PROVIDER=cognito
TRACEPOINT_EMAIL_PROVIDER=ses
TRACEPOINT_STORAGE_PROVIDER=s3
```

Non-secret environment must be:

```text
CONFIGURATION_ENVIRONMENT=staging                         # secret-injected common value
NEXT_PUBLIC_SITE_URL=https://staging.tracepointhq.com     # secret-injected common value
AWS_REGION=us-east-1
TRACEPOINT_AWS_ACCOUNT_ID=559054714699
TRACEPOINT_S3_BUCKET=tracepoint-staging-private-559054714699
TRACEPOINT_S3_EXPECTED_OWNER=559054714699
TRACEPOINT_DATABASE_CA_PATH=/app/rds-ca.pem
TRACEPOINT_COGNITO_USER_POOL_ID=us-east-1_Y9GiDA5Zy
TRACEPOINT_COGNITO_CLIENT_ID=4apeul5qohqgnf7d10ta2lk5qe
TRACEPOINT_SES_CONFIGURATION_SET=tracepoint-staging
TRACEPOINT_FROM_EMAIL=notifications@staging.tracepointhq.com
```

Secret-injected runtime values must be:

```text
TRACEPOINT_DATABASE_SECRET_JSON=<entire tracepoint/staging/database/runtime JSON>
TRACEPOINT_IMPORT_APPROVAL_SECRET=<application-secret JSON key>
TRACEPOINT_AUTH_STATE_KEYS=<application-secret JSON keyring>
TRACEPOINT_AUTH_REFRESH_KEYS=<application-secret JSON keyring>
NOTIFICATION_DISPATCH_SECRET=<application-secret JSON key>
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=<application-secret JSON key>
```

The runtime database JSON must contain exactly the expected RDS host/port, `username=tracepoint_runtime`, its generated password, and `dbname=tracepoint`. State and refresh values must be valid active-key JSON keyrings. Supabase URL/public/server/service-role keys and `BREVO_API_KEY` must not be injected into an `aws-native` task; runtime validation fails closed if they are present. They may remain in the underlying application-secret JSON solely to support a separately approved bridge rollback revision.

The feedback worker separately requires `TRACEPOINT_AWS_ACCOUNT=559054714699`, `TRACEPOINT_DATABASE_SECRET_ARN`, `TRACEPOINT_RDS_CA_PATH=/opt/us-east-1-bundle.pem`, `TRACEPOINT_SES_FEEDBACK_TOPIC_ARN`, and `AWS_REGION=us-east-1`.

## CDK changes by stack

The synthesized assembly contains 11 stacks and is acyclic. Existing live exports required by the new composition are absent until their producer stacks update, so deployment order is mandatory. Synthesis resolved every reference; no missing export exists in the generated assembly.

| Stack | Operation | Exact material change |
|---|---|---|
| `tracepoint-staging-network` | Update in place | Add two isolated `/27` DB subnets across two AZs, route tables/associations, DB SG, associate private route tables to existing S3 gateway endpoint, and export subnet/SG IDs. CDK emits its no-default-egress dummy deny-style SG rule. |
| `tracepoint-staging-security` | None | No diff. Existing KMS data key remains. |
| `tracepoint-staging-database` | **Create** | PostgreSQL 18.4, `db.t4g.micro`, Single-AZ, private only, 20 GiB gp3 fixed maximum, existing KMS key, forced SSL parameter group, PostgreSQL logs (7 days), deletion protection, 1-day automated backup, final-snapshot removal policy; create DB subnet group, generated migrator secret/attachment, retained runtime secret, log-retention custom resource, and exports. |
| `tracepoint-staging-compute` | Update in place | Execution-role policy gains read-only access to the new runtime DB secret. This establishes `compute -> database`; it does not form a cycle. |
| `tracepoint-staging-image-build` | Update in place | Use build KMS key instead of `alias/aws/s3`; extend build-role KMS actions for encrypted output; add `CONFIGURATION_ENVIRONMENT=staging` and `TRACEPOINT_BUILD_PROVIDER_MODE=aws-native`; remove build-time Supabase public URL/key. No image is built by the stack diff itself. |
| `tracepoint-staging-storage` | None | No diff; bucket, policies, role access, and KMS remain unchanged. |
| `tracepoint-staging-ses-foundation` | Update in place | Add `tracepoint-staging-cognito` configuration set, runtime SES-send IAM policy scoped to the staging identity/from address, and outputs/exports for both configuration sets, topic, queue and DLQ. Existing identity/topic/queues remain. |
| `tracepoint-staging-cognito` | Update in place | Change pool email configuration from Cognito default to SES developer mode with the exact identity/from address and Cognito configuration set; add task-role Cognito lifecycle IAM policy; add pool/client exports. Pool/client/domain are not replaced. |
| `tracepoint-staging-ses-feedback-worker` | **Create** | Node.js 22 Lambda (256 MiB, 30 seconds, reserved concurrency 2), SQS event source (batch 10, partial failures, max concurrency 2), RDS CA layer, retained 30-day logs, worker/endpoint SGs, Secrets Manager and SNS interface endpoints in both isolated subnets, DB ingress, IAM, and four alarms. The SNS endpoint is needed for private retrieval of the allowlisted SNS signing-certificate URL; the worker has no NAT. |
| `tracepoint-staging-runtime` | Update + expected replacement | Add task-to-DB SG rules. Replace the immutable ECS task-definition resource with a new revision containing the native tuple, DB CA/secret, Cognito IDs, SES configuration, and new app-secret keys; remove injected Supabase/Brevo values. ECS service, ALB, listener and target group update in place. |
| `tracepoint-staging-alert-delivery` | Update in place | Add AWS Budgets publish permission to topic policy and Budgets KMS permissions constrained by source account. This is not a provider requirement but is present in the current full diff. |

There are no resource deletions in the current diff. The only replacement is the normal immutable ECS task-definition revision. New retained resources increase teardown complexity: database deletion produces a final snapshot, automated backups are retained, the runtime secret is retained, and worker logs are retained. Do not delete the failed Cognito shell, database, snapshots, secrets, queues, bucket, or KMS resources as part of activation.

## Dependency and implementation findings

### Proven good

- Dependency graph is acyclic: network → security/database; database → compute runtime-secret policy; compute → image build/SES; SES → Cognito/worker; database/network/SES → worker; storage/database/Cognito/SES/network/compute → runtime; runtime → alert delivery.
- Generated cross-stack references and exports resolve in the assembly.
- The database bootstrap sets the generated runtime-secret password on `tracepoint_runtime`; it is not merely an unused secret. It also runs permission and provider-retirement assertions after schema work.
- The server email selector constructs `ManagedSesProvider` when `departmentId` is supplied. Activation and queued dispatch supply a department. SES feedback persistence is PostgreSQL-backed.
- S3 selection fails closed for `aws-native + supabase`; the retained S3/KMS provider has no synthesized changes.

### Blocking gaps

1. **Migration ledger checksum failure.** `database/aws/001_provider_neutral_authorization_context.sql` hashes to `39411fb46db2c4d09e48d0e3a1862c885430714e2e520f63d437220ff94e5b8c`; the committed ledger expects `e0c2a264ce64bd18469578b5186c9765490b108e47b5e903df2422a828949515`. Clean bootstrap applies all 75 base migrations and then stops before AWS overlays/grant assertions.
2. **Lineage baseline stale.** The lineage validator expects 73 migrations and observes 75. Clean/current/upgrade structural parity is therefore unproven.
3. **Database grants are not currently releasable evidence.** Although the bootstrap contains role-password and privilege checks, the ledger failure prevents those checks from executing against the current 75-migration head.
4. **Runtime secret gap.** All three native auth/import keys are absent. The staging schema/population tooling is bridge-only and must be versioned to support native keys without exposing values.
5. **Direct Supabase paths remain.** Nineteen application files containing direct Supabase client/admin use have no local provider guard, including platform pages/routes, settings browser panels, several onboarding routes, session refresh/signout, and the client login form. Some may be excluded by a parent native flow, but that exclusion is not proven by full-native route acceptance. Any reachable one fails because the native task intentionally omits Supabase credentials.
6. **No synthetic database/auth migration executable.** The repository has schema bootstrap and an infrastructure rehearsal, but no bounded manifest-driven table-data importer, identity importer, or combined native cutover orchestrator. Existing `run-disposable-staging-acceptance.mjs` is explicitly Supabase/bridge-oriented.
7. **SES unusable.** DNS verification/DKIM/MAIL FROM failed and account remains sandboxed. Neither Cognito mail nor application SES delivery can be an acceptance gate yet.
8. **Backup gap.** No live vault/plan exists. `BackupRecoveryStack` is included only in the production full-AWS assembly; the staging assembly neither creates it nor tags the staging RDS instance `Backup=daily`. Only the RDS 1-day automated backup and final snapshot behavior are synthesized.
9. **New native image required.** The running `43cc...` image was built with `TRACEPOINT_BUILD_PROVIDER_MODE=bridge`. A new immutable image must be built and published only after the source blockers are fixed; reusing it for the native task is invalid.
10. **Expiry guard is already too narrow.** Staging database synthesis accepts only timestamps dated 2026-09-10 through 2026-09-13. This must be deliberately renewed or replaced with an enforceable lifecycle design before a later deploy; the tag alone does not delete the instance.

### Non-blocking review items

- CDK CLI reports `--all` as unknown/ignored with the installed version, but the app still synthesized all 11 stacks. Use explicit stack names in release automation.
- CDK emits repeated W3010 hard-coded-AZ warnings and reports 80 unconfigured feature flags. The assembly and tests pass, but flags should be pinned before a long-lived baseline.
- The feedback endpoint SG includes a CDK-generated VPC-CIDR HTTPS ingress in addition to the explicit worker-SG ingress. Review and narrow this redundant path if CDK permits.

## Validation evidence

| Validation | Result |
|---|---|
| Root `npx tsc --noEmit` | PASS |
| Infrastructure `npx tsc --noEmit` | PASS |
| Full application harness | PASS — 389 tests, 0 failures, about 204 seconds |
| Focused provider/runtime/bootstrap tests | **20 PASS, 1 FAIL** — only the AWS migration-ledger checksum test failed |
| Infrastructure CDK tests | PASS — all 10 test files; warnings above only |
| Full-native CDK synthesis | PASS — 11 stacks, no dependency cycle |
| Read-only CDK diff (`--change-set=false`) | PASS as analysis — 9 changed stacks, security/storage unchanged; no AWS change set created |
| Clean PostgreSQL bootstrap `--aws-native-final` | **FAIL** — 75 base migrations applied, then AWS overlay ledger checksum mismatch |
| Migration-ledger validation | **FAIL** — exact overlay checksum mismatch above |
| Lineage upgrade validation | **FAIL** — expected 73 migrations, found 75 |
| Runtime configuration validation | PASS for synthetic exact native tuple; live native validation cannot pass until secrets/database exist |
| Offline release orchestration | PASS — 6 cases, no network; expected negative child error observed |
| Cost collector | PASS — account/role/budget gates; 2026-09 month-to-date unblended estimate `$10.8071537495` |

An initial direct Node test invocation inside the restricted process failed before test discovery at `os.userInfo()` with `uv_os_get_passwd ENOMEM`. The same tests ran through the approved application harness; that environment-only failure is not counted as a product failure.

## Monthly staging cost

The live checked-in model is `$68.67/month`, leaving `$6.33` below the `$75` planning ceiling. Month-to-date budget and Cost Explorer both reported approximately `$10.807` on 2026-09-10; billing data can lag.

Fresh AWS Price List results for `us-east-1` returned `$0.016/hour` for Single-AZ PostgreSQL `db.t4g.micro` and `$0.115/GiB-month` for Single-AZ RDS gp3. The model uses 730 hours. PrivateLink uses two services in two AZs, four endpoint ENIs at `$0.01/hour`; 1 GB processing is conservatively included at `$0.01`.

| Category | Monthly USD | Assumption |
|---|---:|---|
| Existing ECS/ALB/public IPv4/LCU | 36.97 | Existing model |
| KMS, Secrets Manager, ECR | 3.70 | Existing 2.90 + two DB secrets at 0.40 each |
| Logs and S3 | 3.10 | Existing 3.00 + worker/DB log allowance 0.10 |
| Governance, build, WAF, alerts, transfer, storage | 23.90 | Existing fixed/allowance components except alarms |
| CloudWatch alarms | 0.80 | Existing 0.40 + four worker alarms 0.40 |
| SES foundation/SNS/SQS/KMS/low-volume send | 1.25 | Existing conservative allowance; SES is `$0.10/1,000` recipients |
| Cognito | 0.25 | Conservative allowance; direct Essentials users remain within 10,000-MAU free tier at staging volume |
| RDS compute | 11.68 | `0.016 × 730` |
| RDS gp3 storage | 2.30 | `20 × 0.115` |
| RDS backup | 0.00 steady state | One-day backup assumed within free backup allocation up to provisioned DB storage; excess/manual retained snapshots are extra |
| PrivateLink network | 29.21 | 2 endpoints × 2 AZs × 730 × 0.01 + 1 GB processing |
| Feedback Lambda/SQS requests | 0.05 | Low synthetic volume/free-tier conservative allowance |
| **Expected total** | **113.21** | Planning estimate, not a bill |

Expected overage is **$38.21/month (50.9%) above the $75 ceiling**. A retained 20 GiB snapshot after DB deletion can add roughly `$1.90/month` at a `$0.095/GiB-month` snapshot assumption and is not included in steady state. Unexpected logs, transfer, NAT (none proposed), higher SES volume, excess backups, or non-free Cognito MAUs add cost.

Both interface endpoints are functionally justified by the isolated worker: Secrets Manager retrieves the DB secret, while private DNS for SNS permits the signing-certificate HTTPS fetch used to authenticate queue envelopes. Removing the SNS endpoint without another controlled egress path breaks feedback validation. The ceiling should therefore be raised to at least `$120/month` (recommended `$125` to preserve modest headroom) before authorization.

## Exact migration, acceptance, and rollback sequence

### 0. Correct and re-prove source before AWS mutation

1. Reconcile the AWS overlay checksum: either restore the reviewed SQL bytes or deliberately version a new overlay; never silently rewrite an applied checksum.
2. Update the lineage baselines from 73 to the reviewed 75-migration history and prove clean/current/staging-upgrade parity.
3. Port or prove unreachable every unguarded Supabase path. Add native end-to-end route coverage for platform, settings/onboarding, login/refresh/signout, notification dispatch, and tenant isolation.
4. Add native application-secret schema/population support for the three missing keys. Generate independent state/refresh keyrings and import approval secret; never reuse Supabase/Brevo values.
5. Add reviewed synthetic table-data and identity migration commands with fixed account/region, generated synthetic department allowlists, manifests, create-only/idempotent behavior, and zero delete capability.
6. Decide staging backup policy: compose/tag an AWS Backup stack or explicitly accept RDS 1-day automated backup plus final snapshot for disposable synthetic staging. Add a timed restore acceptance either way.
7. Renew the database expiry control and add an owner/alarm/enforced teardown procedure.
8. Rerun TypeScript, all tests, clean bootstrap, overlay/ledger/lineage validation, CDK tests, explicit-stack synthesis/diff, runtime validation, and offline orchestration. All must be green.

### 1. External prerequisites

1. Raise the staging budget/ceiling authorization to at least `$120` (recommended `$125`).
2. Publish the exact SES DKIM, verification, custom MAIL FROM MX/SPF, and DMARC records through the authorized DNS owner. Wait until identity, DKIM, and MAIL FROM are successful.
3. Request/obtain SES production access or constrain acceptance to verified synthetic recipients while sandboxed. Do not point Cognito at SES until sending is proven.

### 2. Infrastructure pre-cutover, in dependency order

1. `tracepoint-staging-network`.
2. `tracepoint-staging-database`.
3. Wait for RDS availability; retrieve secret metadata without logging values.
4. Run `bootstrap-aws-postgres-target.mjs` from an approved private execution boundary. It must apply 75 reviewed base migrations plus ordered AWS overlays, set the `tracepoint_runtime` password from the generated runtime secret, enforce grants/RLS, reject Supabase-only policies/functions, and record the exact ledger.
5. `tracepoint-staging-compute` so the execution role can read the DB runtime secret.
6. `tracepoint-staging-image-build`; then separately build, scan, and publish one immutable **aws-native** image from the reviewed commit.
7. `tracepoint-staging-ses-foundation`.
8. Prove a synthetic SES application send and bounce/complaint queue event using only an authorized verified synthetic recipient.
9. `tracepoint-staging-cognito`.
10. `tracepoint-staging-ses-feedback-worker`; prove queue consumption, signature verification, idempotent PostgreSQL persistence, retry, DLQ, and alarms.
11. Populate the three native application-secret keys atomically while retaining bridge keys for rollback. Validate names/shape only.

### 3. Synthetic data migration

1. Generate a unique synthetic department and users only; record the allowlist and source manifest before copy.
2. Quiesce writes for that synthetic cohort. Export in foreign-key order with stable application UUIDs, timestamps, nulls, enum values, and attachment object keys; never enumerate another department.
3. Import create-only in a transaction or resumable table checkpoints. Load parent/reference tables, department/user/profile/identity rows, operational rows, notification/outbox rows, then dependent history/audit rows. Reset owned sequences above imported maxima.
4. Record a destination manifest: row counts per table, deterministic ordered hashes for non-secret fields, FK/orphan checks, schema/ledger checksum, and object-key references. Compare exactly with source.
5. Exercise `tracepoint_runtime` transaction-local subject/department context. Prove same-tenant allow, cross-tenant deny, no-context deny, owner/admin separation, RPC parity, and forbidden direct grants.
6. Take/verify the approved recovery point and perform a timed isolated restore using synthetic data before provider switch.

### 4. Authentication migration

1. Admin-create only the allowlisted synthetic Cognito users with delivery suppressed; do not attempt password-hash transfer.
2. Preserve each immutable TracePoint application user UUID. Record a pending mapping from exact Cognito issuer+`sub` to that UUID; never match or merge solely by email.
3. Set a synthetic temporary/permanent password through the reviewed lifecycle, complete MFA/TOTP enrollment, and prove PKCE state single-use, nonce/state checks, JWT issuer/audience/signature/expiry, encrypted refresh persistence/rotation, logout, global revocation, invite/activation, reset, disable/enable, and last-administrator safeguards.
4. Activate the identity link only after the Cognito subject and tenant permissions are verified. Keep the Supabase identity link/session usable only as the rollback authority until cutover acceptance ends.
5. At cutover, revoke/expire the synthetic Supabase sessions and require Cognito reauthentication. There is no seamless password/session migration claim.

### 5. Pre-switch acceptance and cutover

1. Launch a disposable native task/service or equivalent isolated acceptance target using the new image and exact native tuple; do not modify the live service yet.
2. Validate startup configuration, DB TLS/CA and pool bounds, health, public/protected routing, Cognito login/callback/refresh/logout/revocation, active department, all tenant-scoped read/write workflows, S3 upload/download/delete and cross-tenant denial, SES application send, Cognito mail, feedback persistence, alarms, and sanitized logs.
3. Require exact source/destination manifest parity, zero unauthorized rows/objects, zero DLQ messages, healthy targets, no unknown errors, and measured latency within the staging acceptance thresholds.
4. Deploy `tracepoint-staging-runtime` last with the reviewed native image tag. This creates a new task-definition revision and rolling ECS replacement; retain revision 26.
5. Repeat the complete synthetic acceptance against the live staging URL. Then deploy/converge `tracepoint-staging-alert-delivery` because the synthesized graph places it after runtime.
6. Observe for at least 60 minutes plus one complete SES feedback retry window before declaring staging native.

### 6. Rollback

1. Trigger rollback for tenant leakage, auth bypass, migration/hash mismatch, unverified email identity, persistent delivery/feedback failure, DLQ growth, unhealthy deployment, unknown logs, or inability to revoke sessions.
2. Stop new native writes and place only the synthetic cohort in maintenance. Preserve RDS, snapshots, Cognito users/mappings, S3 versions, SES queues, task logs, manifests, and correlation IDs.
3. Before any native write, rollback is a service update to verified task revision 26 (`43cc...`) with its bridge secret mappings; S3/KMS remains unchanged.
4. After native writes, reconcile the native delta first. Revert to bridge only if the synthetic Supabase source remains authoritative and mappings are reversible; do not dual-write or blindly copy backward.
5. Revoke Cognito sessions/identity links for the synthetic cohort as appropriate, restore bridge session authority, redeploy the prior task revision, wait for target health, and rerun bridge acceptance plus S3/KMS checks.
6. Do not delete the DB, secrets, snapshots, Cognito pool, failed stack, worker, queues, or logs during rollback. Cleanup is a separate, exact-target, recovery-aware authorization after evidence retention.

## Required authorizations

No following item is authorized by this readiness review:

1. Code changes that repair ledger/lineage, provider routes, migration tooling, backup composition, secret schema, or expiry controls.
2. DNS changes and control of `staging.tracepointhq.com` verification/Mail-From records.
3. SES production-access request, sending any email, or Cognito mail activation.
4. Raising the `$75` ceiling and creating paid RDS, PrivateLink, Lambda/alarm, log, backup, or snapshot resources.
5. Updating application secrets or reading secret values for deployment/bootstrap.
6. Database bootstrap, grants, synthetic data import, snapshot/restore, or Cognito admin user/identity operations.
7. Building/publishing another ECR image.
8. Deploying any of the nine changed stacks or switching the running provider tuple.
9. Deleting the failed Cognito stack or any retained resource.
10. Any later real migration, which separately requires data-owner approval for explicitly scoped source records/users and is outside this synthetic-only plan.

## Duration estimate

- Source/ledger/lineage/secret tooling repairs and green proof: **1–2 engineering days**.
- Port/prove remaining direct Supabase routes and add native acceptance: **2–4 engineering days**.
- Synthetic data/auth tooling and dry runs: **1–2 engineering days**, partly parallel with route work.
- DNS propagation and SES review: **1–5 business days elapsed**, externally controlled.
- Authorized infrastructure creation, bootstrap, image publication, migrations, acceptance, cutover observation, and rollback proof: **1–2 days**.

Expected end-to-end elapsed time is **5–10 business days** after all named authorizations and DNS ownership are available. Hands-on engineering is approximately **4–7 working days**. The provider switch itself should be scheduled as a **4–6 hour staging window** followed by at least **60 minutes observation**; this is not an estimate for customer-data or production migration.
