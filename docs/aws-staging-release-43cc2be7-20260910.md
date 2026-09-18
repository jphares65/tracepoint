# TracePoint staging release evidence — 43cc2be7 — 2026-09-10

## Authorization boundary

- Authorized source: `43cc2be7cf4760420aac66721b637d7859e05125`.
- Target: AWS account `559054714699`, Region `us-east-1`, staging only.
- Verified role: `TracePointMigrationStaging` through the configured IAM Identity Center staging profile and a short-lived exported child-process session.
- The later authorization permitted `--execute-copy` only inside the documented newly generated disposable synthetic reconciliation rehearsal. Production access or change, customer-data reads, real Supabase object copies, arbitrary department identifiers, deletion outside unique generated fixture prefixes, and production cutover remained prohibited and were not performed.
- Secret values were not printed or written to this record.

## Source and local state

- The worktree was clean and detached exactly at the authorized commit before live work.
- Commit subject: `Align staging storage gate with KMS`.
- Root and infrastructure dependencies were installed from their committed lockfiles with `npm ci`; both audits reported zero vulnerabilities.
- The worktree was clean after dependency installation. The final evidence branch contains this record plus a narrowly scoped staging release-validator repair described below; neither entered the application image, which was archived directly from the exact authorized commit.

## Initial inventory

The guarded metadata-only inventory verified the staging account, role, and Region before all AWS queries.

- CloudFormation: `tracepoint-staging-security` and `tracepoint-staging-runtime` were `UPDATE_COMPLETE`; `tracepoint-staging-storage` was `CREATE_COMPLETE`. Other listed staging stacks were stable except the known historical `tracepoint-staging-cognito-foundation` stack at `ROLLBACK_COMPLETE`.
- Network: VPC `10.40.0.0/16`, no NAT gateway, one available S3 gateway endpoint.
- ECR: repository `tracepoint-staging` was immutable, KMS-encrypted, and scan-on-push enabled.
- ECS: cluster active; desired/running/pending `1/1/0`; task revision 25; one healthy target.
- TLS: the exact staging certificate was issued; the ALB was active and internet-facing.
- Logging and alarms: 30-day KMS-encrypted application/build log groups; all five staging alarms `OK`; zero matching application error events in the prior 30 minutes.
- Budget: `tracepoint-staging-monthly-75`, limit `$75 USD`.

## Pre-deployment CDK review

Command scope was exclusively `tracepoint-staging-security` and `tracepoint-staging-storage`, with the exact staging account/Region, `privateStorageEnabled=true`, `storageProvider=s3`, `directDeployment=true`, lookups disabled, and no change set.

### Security stack

No differences.

### Private-storage stack

The diff contained no resource replacement, deletion, production reference, or broad allow grant. It contained:

- In-place application-bucket default encryption change from `AES256` to the existing staging customer-managed KMS key.
- S3 Bucket Keys enabled.
- `Backup=daily` bucket tag.
- Three explicit-deny `PutObject` statements rejecting an explicitly supplied non-KMS algorithm, wrong KMS key, or KMS request missing the approved key ID. The wildcard principal applies only to denies.
- One task-role KMS policy allowing only `kms:Decrypt` and `kms:GenerateDataKey`, constrained to S3 in `us-east-1` and the exact application-bucket encryption context.

The IAM addition was expected and least-privileged for the reviewed SSE-KMS storage design. No new KMS key or fixed-price service was created.

## Deployment results

- `tracepoint-staging-security`: deployed as a no-op; stack remained healthy.
- `tracepoint-staging-storage`: `UPDATE_COMPLETE` in 52.41 seconds.
- Application bucket: `tracepoint-staging-private-559054714699`.
- Storage changes applied in place: application bucket update, object bucket-policy update, existing object-access policy metadata update, and creation of the scoped runtime KMS policy.
- Termination protection remained enabled.
- Final CDK convergence check: no differences for either stack.

## Synthetic S3 canary

- Run ID: `ffb1e912-280d-41c6-a302-bd8880ed3662`.
- Verified: Block Public Access/private controls, five upload domains, signed download, anonymous-read denial, SHA-256 equality, delete-marker recovery, and provider delete behavior.
- Cleanup verified zero remaining versions and delete markers under both unique generated prefixes.
- Post-deployment bucket verification: default `aws:kms`, Bucket Keys enabled, and `Backup=daily` present.

## Disposable synthetic reconciliation rehearsal

Before the live rehearsal, 13 committed local tests passed:

- Ten migration tests verified deterministic department-scoped tamper-evident manifests, explicit environment/project/account approvals, dry-run behavior, idempotent copy, per-object checkpointing, interrupted-copy resumability, checkpoint round-trip, source-drift refusal, destination-mismatch refusal, duplicate detection, and cross-tenant finding separation.
- Three reconciliation tests verified read-only inventory, copy-once/readback behavior, rerun idempotency, conflict refusal, and no overwrite.

Live run `4e66d6e4-862f-4e08-88bb-5cd80be40448` generated two new disposable departments:

- Reconciled tenant: `2110da5a-887b-4833-8a22-1abfca2c0f87`.
- Foreign isolation tenant: `463cd37a-95d6-4118-81ae-2ea65882d9b7`.

The harness generated exactly two source objects under the reconciled tenant, observed the expected read-only missing-destination state, copied create-only, verified SHA-256 readback, repeated the copy without creating versions, removed only the exact created destination version IDs, verified source preservation, and copied/reconciled again. The stable reconciliation fingerprint proved manifest equality across reruns. The fixed account, project, bucket, department-prefix, and role assertions remained active throughout.

Cleanup verified removal of both generated source objects, all synthetic users and departments, and zero S3 versions/delete markers beneath both generated departments. Independent post-run `ListObjectVersions` checks returned no versions or delete markers for all four exact prefixes. Destination encryption was enforced by the previously verified `aws:kms` bucket default, S3 Bucket Keys, expected-owner calls, and deny-on-wrong-explicit-encryption bucket policy.

No arbitrary department was accepted or enumerated. No customer or production object was read, copied, or deleted.

## Immutable image publication

- Exact source commit: `43cc2be7cf4760420aac66721b637d7859e05125`.
- The source archive contained 484 files, all tracked by that exact commit and limited to the publisher allowlist. Environment, credential, secret, dump, generated, dependency, GitHub, and backup path classes were rejected.
- Source was uploaded to the retained versioned staging build-source bucket; no local evidence or release-gate file entered the archive.
- Initial CodeBuild run `10db72e6-98d5-4af5-837b-e0a749f726de` failed safely in `PRE_BUILD`: the deployed project predates the non-secret `TRACEPOINT_BUILD_PROVIDER_MODE` variable. No image was pushed.
- Corrected CodeBuild run `615f7282-9900-4de8-8cc6-3b474689a0a9` reused the identical versioned source and exact immutable tag variables, adding only `TRACEPOINT_BUILD_PROVIDER_MODE=bridge`. It succeeded.
- ECR tag: `43cc2be7cf4760420aac66721b637d7859e05125`.
- Digest: `sha256:8944fec62347ed309474fda31145640083c94df96c67b5999e7c79010413b3db`.
- Image size: 76,092,455 bytes.
- Basic scan: `COMPLETE`, zero findings at every reported severity.

## Runtime diff and staging-only release repairs

The deployment verification passed before runtime mutation. The exact runtime diff contained only the expected ECS task-definition replacement:

- Image tag changed from `9a124f90b1f329badcf166b559052931c5d5dc67` to the authorized commit.
- Storage provider remained `s3`.
- Explicit bridge runtime/auth declarations were added as `bridge` and `supabase`.
- The literal staging bucket name changed to the exact `tracepoint-staging-storage` CloudFormation export.
- Equivalent environment and secret entries were reordered.

There was no IAM, network, database, capacity, alarm, production, or cost-bearing runtime change.

The release structural validator initially stopped the deployment because it handled first-time S3 activation but not normalization of an already-S3 bridge runtime. A narrowly opt-in `IncludeReviewedBridgeComposition` rule was added. It accepts only the exact staging bridge/auth values and exact storage export, normalizes order-only differences, and continues to reject alternate auth providers, production/other exports, unrelated environment variables, secret changes, IAM changes, count changes, deletion, and wrong images. Seven focused tests, targeted ESLint, PowerShell parsing, template validation against the exact live artifacts, and `git diff --check` passed.

The first CloudFormation attempt then failed before task creation because the storage stack did not yet publish the new automatic bucket-name export. CloudFormation returned the runtime stack to `UPDATE_ROLLBACK_COMPLETE`; ECS stayed healthy at revision 25. A reviewed storage diff showed one output/export addition and no resource, policy, object, or cost change. That output-only repair deployed successfully.

The unchanged guarded runtime deployment was retried and completed successfully.

## Application release and acceptance

- Runtime stack: `UPDATE_COMPLETE`.
- ECS task definition: revision 26.
- Desired/running/pending: `1/1/0`; rollout completed.
- Running image tag: `43cc2be7cf4760420aac66721b637d7859e05125`.
- Running digest exactly matches ECR: `sha256:8944fec62347ed309474fda31145640083c94df96c67b5999e7c79010413b3db`.
- ALB: one healthy target after revision-25 target drain completed.
- Provider configuration: bridge data/auth, Brevo email, and `TRACEPOINT_STORAGE_PROVIDER=s3` with the exact staging bucket/account/Region.

Authenticated acceptance run `99acdf40-f95f-4780-aa0b-28e6726ff08d` generated departments `1fbb224d-9c64-4ec1-982c-c81b5e5634cd` and `97fd099b-16b8-43af-921d-5ed1f5fa2808`. All 53 implemented checks passed. Coverage included public/protected routing, login and tenant resolution, session persistence, tenant-isolated JSON APIs, equipment lifecycle/custody, S3 patch delivery and cross-tenant denial, range/drill history, S3 document upload/view/download/delete, off-duty approval and notifications, fleet, training/export isolation, armory, certifications, personnel export, logout, password recovery, refresh-token revocation, custody history, and audit creation.

The bounded authenticated read probe completed 20 requests at concurrency 4 with p95 470 ms and all tenant checks passing. This is not production capacity proof. The sole reported blocked scenario is the deliberately separate email-invitation/replacement-provider MFA cutover gate; it is not an implemented-test failure and no email delivery test was sent.

Acceptance cleanup verified all generated tenant/user records were removed and zero S3 versions remained. Independent checks returned no versions or delete markers under all four exact acceptance prefixes.

## Post-release health and monitoring

- Sanitized evidence check: `2026-09-10T18:19:49.816Z`, passed.
- CloudFormation runtime: `UPDATE_COMPLETE`.
- ECS: revision 26, desired/running/pending `1/1/0`, completed rollout.
- Image and digest: exact match between requested ECR tag, ECR scan result, and running task.
- Target health: one `healthy` target.
- Six staging alarms: all `OK`.
- Twelve public/protected-route checks: all passed with expected `200` or same-origin login redirects.
- Current-task log classification: zero matching errors, zero errors in the last 60 minutes, zero filesystem-permission errors, and no unknown fingerprints.
- Notification queue: failed `0`, stale processing `0`; read-only check.
- Final CDK convergence: no differences for `tracepoint-staging-storage` or `tracepoint-staging-runtime`.

## Cost impact

- Checked-in staging model: `$68.67/month`, beneath the `$75/month` ceiling by `$6.33`.
- This deployment uses the existing KMS key and the model's private-storage request/version/log allowance. It adds KMS request usage rather than a new fixed monthly key charge; S3 Bucket Keys reduce KMS request volume.
- This is a planning estimate, not a real-time invoice.

## Rollback position

- The first runtime attempt rolled back automatically before task creation because the storage export was absent; revision 25 remained healthy throughout.
- The final release is healthy at revision 26, so manual rollback was not triggered.
- Revision 25 remains the explicitly verified application rollback target if a later critical staging issue is found.
- The security stack was a no-op.
- The storage update completed successfully and converged. The retained/versioned bucket was not replaced or deleted.
- Do not blindly redeploy the prior AES256 template after new runtime writes: objects written under the new default may require the newly attached KMS permissions. Any storage rollback must preserve KMS decrypt access and be separately reviewed. The immediate safe position is to leave the converged SSE-KMS foundation in place.

## Evidence branch

Dedicated branch: `release-evidence/tracepoint-staging-43cc2be7-20260910`, created directly from the authorized commit without modifying `main`.

No remaining staging release blocker was found. Production migration, provider cutover, customer-data work, production DNS/traffic, invitation delivery, and replacement-provider MFA/session cutover remain separate and unauthorized.
