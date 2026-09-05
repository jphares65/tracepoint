# TracePoint migration checkpoint ? September 5, 2026

Staging is operational. Production cutover remains gated; TracePoint is not fully migrated. Starting weighted score **45.55%**; current credited score **66.50%**. The same binary checklist is retained for comparability. Disabled code and documentation earn no credit. The storage category measures the staging foundation, not production object transfer. Production Supabase database/auth/storage and Brevo remain unchanged.

## Current release

Image 432ebf0d52122df41c0d7e793c09029fbc54b40f; digest sha256:b79e5bb37a1b58035c9b28a6a1120c51a7669f659913da3a3395e318b0b3515b; ECS revision 17. GitHub OIDC publication, completed zero-finding scan and Vercel Preview gate passed. The first structural release stopped before mutation because CDK telemetry encoded a different Node patch version. Commit 1491a41 permits only that telemetry field to differ; resource/policy changes remain rejected. The reviewed local live diff contained only the image replacement. CloudFormation UPDATE_COMPLETE, ECS 1/1/0 completed rollout and one healthy target passed. Revision 17 authenticated acceptance, supported browser recovery/logout/revocation, audit/custody and zero-fixture cleanup passed (run 9c584c1c-df8c-48d5-b31b-23b44b26dcbd). Twenty authenticated reads at concurrency four had p95 450 ms and correct tenant results. Six alarms OK, 12 public/protected checks passed, current logs clean, failed/stale queues zero. See aws-release17-evidence-20260905.json. GitHub OIDC run 33958406346 attempt 2 passed the guarded release and actual rollback 17 -> 16 -> 17 (404.116 seconds rollback; 436.607 seconds return). Staging was restored to the exact accepted digest. The image was not rebuilt.

Brevo delivery through the changed adapter was verified at 2026-09-05T09:31:19Z, run 08a60d72-6254-4f22-b346-53b3b8080bdf. Ambiguous acceptance now requires reconciliation instead of automatic resend; only explicit throttling automatically retries. Failed/stale queue entries are release-health gates.

## Implemented and validated foundations

- S3 is active for staging application storage: private, encrypted, versioned, tenant-prefixed and authorized. Synthetic upload/download/delete, checksums, copy/retry/rollback, version restoration and zero-fixture cleanup passed. No production object was copied.
- Supported Supabase browser login, recovery, session/logout/revocation, tenant-negative and manager/officer workflows passed on revision 16. Revision 17 acceptance is tracked separately. Supabase auth remains active.
- All 66 staging migrations match the ledger. Temporary private encrypted AWS RDS passed all migrations, 84-table/232-relationship reconciliation, nine schema/security fingerprint groups and tenant-negative SQL before/after restore. Latest synthetic restore: 2.615 seconds. The entire isolated stack was removed and deletion verified. This is not production RTO, data migration or PITR evidence.
- WAF rate controls are enforced with redacted logs and live 429/recovery proof. Six runtime/WAF/composite alarms were OK. SNS incident/recovery fanout reached encrypted SQS; no human recipient is yet confirmed.
- Exact GitHub OIDC trust/environment are deployed. Mandatory Linux application/script/PG/infrastructure validation and Windows safety checks pass. Existing-image resume requires ancestor provenance and identical archived runtime source.
- Disabled SES foundation deployed: TLS-required configuration set, RSA-2048 DKIM identity, encrypted feedback SNS/SQS/DLQ, retention, termination protection and six exact DNS outputs. No runtime send grant or DNS mutation. DKIM PENDING and SES sandbox active; application remains on Brevo. See aws-ses-foundation-evidence-20260905.json.
- Cognito JWT/claim mapping, PKCE/nonce/state, encrypted atomic transactions and durable access-session/global-revocation stores are implemented and tested. Schema 66 has browser grants denied. Cognito is not deployed or selected. Refresh-session persistence, lifecycle integration, MFA cohort and RLS compatibility still block activation.

## Weighted checklist

| Category | Weight | Complete | Evidence | Exact remaining work | Codex without Jason |
|---|---:|---:|---|---|---|
| AWS account/governance | 6 | 50.00% | Exact staging STS gate; aws-github-release-evidence-20260905.json | production account authorized; organization controls validated | No for remaining production/human gates |
| network and compute | 10 | 60.00% | aws-release17-evidence-20260905.json; aws-request-controls-20260905.md | production network deployed; production load/failure test | No for remaining production/human gates |
| runtime deployment | 8 | 75.00% | aws-release17-evidence-20260905.json | production runtime deployed | No for remaining production/human gates |
| database/schema/data migration | 16 | 62.50% | aws-postgres-rehearsal-evidence-20260905.json; exact 66-migration staging ledger | production data rehearsal; production database moved; production PITR restore timed | No for remaining production/human gates |
| authentication | 10 | 60.00% | Revision 17 browser recovery/login/logout; aws-auth-session-schema-20260905.json | replacement identity provider deployed; MFA and session cutover validated | Provider rehearsal available; application activation needs database/RLS compatibility |
| storage | 8 | 100.00% | Live S3 acceptance, version restore and synthetic copy/rollback evidence | Fixed staging capability checklist complete; production scope remains separately gated. | Staging complete; production transfer requires authority |
| email | 6 | 50.00% | aws-brevo17-delivery-20260905.json; SES foundation remains disabled | SES application provider deployed; bounce/suppression delivery verified | No live activation without DNS/sandbox and durable feedback worker |
| DNS/TLS | 8 | 50.00% | Issued staging ACM and 12 public/protected checks | production AWS certificate verified; production DNS cutover validated | No for remaining production/human gates |
| CI/CD | 8 | 100.00% | aws-github-release-evidence-20260905.json; actual OIDC publication/release/rollback | Fixed staging capability checklist complete; production scope remains separately gated. | Complete |
| security/monitoring/backups | 10 | 75.00% | Six alarms OK, WAF enforced, encrypted alert fanout; synthetic RDS/S3 restore proofs | notification escalation tested; production backup restore validated | No for remaining production/human gates |
| production account readiness | 6 | 50.00% | aws-production-target-evidence-20260905.json; no live production account | dedicated production account authorized; exact live production role gate | No for remaining production/human gates |
| cutover/rollback validation | 4 | 50.00% | aws-rollback17-evidence-20260905.json | DNS rollback rehearsed; agency cutover approved | No for remaining production/human gates |

Evidence: aws-overnight-checklist-20260905.json and dated release/rollback/storage/WAF/OIDC/RDS/SES/cost files. Codex can finish current staging release/CI/rollback autonomously. Production account, credentials, production data, DNS/traffic and human escalation require Jason or the authorized owner.

## Cost

Latest pre-release measured September month-to-date: estimated **$1.3814978907**; billing lags. Monthly low-usage model **$68.67**, including disabled SES, or **$70.67** with the $2 bounded rehearsal reserve, below $75. The budget is an alert, not a spending cap. No NAT or permanent AWS database was added. Current measured evidence is refreshed separately.

## Shortest path to Wednesday

The first AWS hosting cutover can retain production Supabase database/auth/storage and Brevo. Provider exit is a separate migration.

1. Jason supplies the exact dedicated production member-account ID, short-lived TracePointMigrationProduction profile and explicit deployment authority. Management, staging and placeholder accounts are forbidden targets.
2. Confirm canonical hostname (parameterized as tracepointhq.com), apex/www behavior and change window. Issue the production-account certificate; Jason performs separately reviewed DNS validation records. Live traffic remains on Vercel.
3. Install production secrets privately. Build a separate image with production public values; never promote the staging image unchanged. Validate production Supabase project izlkwggluhlhzlumtzes and production site/environment/provider credentials without printing them.
4. Review the actual production migration ledger and exact application-required schema delta. Do not blindly apply staging's 66 migrations, including guarded repairs and optional provider tables. Capture a current backup and timed restore proof; obtain separate authority for required production schema mutation. The cutover validator requires schemaCompatibilityVerified and productionClientBuildVerified.
5. Deploy only after exact production account/role/region gates. Validate TLS, secrets, multi-task capacity/session/cache behavior, monitoring and rollback with authorized synthetic acceptance. A placeholder synthesis is not a live production diff.
6. Jason confirms the human alarm recipient and backup/escalation owner; test delivery and acknowledgement. Encrypted SQS receipt is not human escalation.
7. Review captured DNS rollback values, objective rollback triggers, provider/data rollback boundaries and agency approval. Then separately authorize DNS/traffic cutover and monitoring. Hosting-only cutover requires no production data transfer.

For later provider exit, Jason may install the six staging-only SES DNS records from the evidence JSON and resolve sandbox prerequisites. Trusted database access for the persistent feedback worker is required before SES activation. Cognito compatibility and production data/storage rehearsals remain separate gates. No Wix changes or production file transfers are authorized in this run.

## Repeatable operations

scripts/with-staging-aws-session.mjs bridges a valid CLI session into child SDK/CDK processes without persisting credentials; both identities must match staging. The release wrapper validates providers, image scan, structural scope, live diff, ECS/ALB, disposable authenticated fixtures, queue/log/alarm evidence and automatic recovery. The rollback rehearsal restores the captured exact current ARN in finally; a no-op CDK deploy cannot repair temporary ECS drift.

The production validator checks supplied evidence and never authorizes execution. Required booleans must be backed by actual evidence.

The production assembly now accepts a reviewed account/configuration file behind exact role/region and expiring authority gates; production image publication has an offline archive-validation mode. See aws-production-target-20260905.md. These are implemented and locally validated, not production-deployed capabilities.
