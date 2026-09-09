# Final reconciled AWS staging release - September 6, 2026

Status: **staging release complete and healthy; production cutover is not authorized or complete.** Weighted readiness remains **66.50%** because this release revalidated already-credited staging capabilities and did not move a production provider, production data, or production traffic.

## Source and migration lineage

- Production `origin/main` was fetched and fixed at `d31be2fc99160c4c4a55d6cb2fb307ec2d1ed04f`. It was merged into AWS checkpoint `0ff88d5a7b62f1a84a16f695131eaf8b6415b609` by merge commit `f72108877395cf629394aa19f462e053d1dd16ca`.
- Exact source bytes and production/staging ledger statement metadata were compared before changes. Production had 59 applied identifiers and staging had 73 after reconciliation. Historical same-number/different-content rows were retained as provenance; they were not declared equivalent.
- Production-applied `202609050001` and `202609050002` remain the canonical repository migrations. Historical staging SQL for those identifiers is preserved under `scripts/fixtures/migration-lineages/staging`. Reconciliation is forward-only in unique `202609060002` through `202609060006` migrations; no applied identifier was renamed, rewritten, or deleted.
- Clean bootstrap, production-lineage upgrade, and staging-lineage upgrade passed with 73 unique migrations. The staging ledger was advanced to the exact 73-version source. No production mutation occurred.

## Validation and release

- Local production build passed on the reconciled application (Next.js 16.3.4, 79 static pages). Focused range regression tests passed 6/6, TypeScript and focused lint passed, and the full script suite passed 67/67.
- Clean GitHub validation passed 67 script tests, 266 application tests, TypeScript, and all infrastructure suites (26 tests across seven suites). Exact Vercel branch Preview status was successful.
- OIDC release run `34059318704` published immutable image `840671929044a02c7845800c1f78150687fc3f28`. Its completed ECR scan has zero findings. Structural validation admitted only private staging storage and the immutable image; the live CDK diff contained only replacement of the ECS task definition.
- Final task revision is 21. Digest `sha256:8fca58202d71cccbf5c9e482b0dbd77a6b535af3c2f035881c6c3d87857d016a` matches both ECR and the running task.

## Live acceptance and recovery

- All 53 implemented public/authenticated checks passed with zero failures. The single reported block is the deliberately disabled replacement-provider/invitation-MFA cutover, not a failed implemented check.
- Coverage included qualification readiness, certification/Training Alerts paths, granular permissions and cross-tenant denials, equipment types and custody assignments, armory, off-duty workflow, fleet, range-day history protection, agency training and exports, S3 patch/document upload-view-download-delete, audit creation, browser recovery, logout, and refresh-token revocation.
- Both fixture runs were removed. Equipment custody and document audits were verified before cleanup, and S3 cleanup verified zero fixture versions.
- Brevo accepted and delivered the authorized account-owner message from revision 21. SES remained disabled.
- The release rolled revision 21 back to prior revision 18 in 411.242 seconds, verified it, restored revision 21 in 431.129 seconds, and verified the corrected runtime again.

## Final operational state

Read-only OIDC run `34061763245` at `2026-09-06T21:40Z` found CloudFormation `UPDATE_COMPLETE`; ECS desired/running/pending `1/1/0` with completed rollout; one healthy ALB target; all six alarms `OK`; all 12 public/protected-route checks passing; and failed/stale notification queue counts `0/0`. Current revision-21 logs had zero matching errors and zero filesystem-permission errors. The prior revision-18 history still contains two unclassified fingerprints from the previously recorded burst. Bounded diagnostics exposed no raw messages or personal data, did not establish a cause, and the events did not recur on revision 21.

Budget actual was `$3.539 / $75`; the monthly model remains `$68.67` plus a `$2` disposable-rehearsal reserve. Cost Explorer was unavailable to the restricted role, so this is not a complete real-time bill.

## Production boundary

The read-only production Goldstein check found one record with active membership, computed every status as `Current`, found zero open missing/due qualification events and zero pending qualification-readiness emails, and made zero mutations. Goldstein therefore receives no false missing-qualification alert under the reconciled logic; genuine records were not modified.

Every production-readiness action available without production AWS authority was advanced: exact main/ledger reconciliation, production-upgrade rehearsal, production build, source/provider/preflight rejection tests, immutable publication gates, staging acceptance, monitoring evidence, and rollback proof. Remaining gates require a dedicated production account/role, production certificate and runtime deployment, production backup/PITR evidence, load/failure validation, named on-call escalation, agency approval, and separately authorized production DNS/traffic work. The management account, production Supabase records, and production DNS were untouched. Cognito and SES remain disabled; the first AWS hosting cutover may retain production Supabase and Brevo.

Machine-readable evidence: `aws-workflow-840671929044a02c7845800c1f78150687fc3f28.json`, `aws-operations-488e13fadedad11e35a05d7e59b314e8a135cfb4.json`, `aws-cost-evidence-20260906.json`, and `aws-readiness-20260906.json`.
