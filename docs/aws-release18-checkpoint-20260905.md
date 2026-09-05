# Staging release 18

Continued from 62da52a85563906de2f0435a20d4abf57b435995. The working tree was clean: initial-session/refresh persistence and migration 67 were already committed, tested, staging-applied and idempotently verified. No completed implementation, migration or database rehearsal was duplicated.

A deliberate request commit af8304f40bad8ccd7336b35cacd026a89be5149a triggered GitHub OIDC run 33974564913, attempt 1. Both jobs succeeded. The repaired Vercel Preview was successful. The workflow published the tracked immutable source, required a completed zero-finding ECR scan, passed provider/structural/live-diff gates, deployed the runtime, completed authenticated acceptance and cleanup, then performed an actual rollback and exact-current return.

The actual CDK resource diff contained only AWS::ECS::TaskDefinition ServiceTaskDef1922A00F replacement. Account 559054714699, region us-east-1 and the TracePointMigrationStaging role boundary were verified. No production account, production DNS, production traffic or production data was used.

Final image: af8304f40bad8ccd7336b35cacd026a89be5149a.

Digest: sha256:6a4c9d5dfb5d89b9d2b9d1be2c3dab2a0abba8fa73aa70da401c00b6c1b8f503.

CloudFormation UPDATE_COMPLETE; ECS revision 18, desired/running/pending 1/1/0, completed rollout; one healthy ALB target. Six alarms OK. All twelve public/protected checks passed; current-task matching errors and failed/stale-processing notification counts were zero.

Authenticated acceptance verified document audit, custody history and audit creation; both disposable fixture runs reported cleanup and zero storage versions. Rollback 18 -> 17 took 411.9726504 seconds; restoration 17 -> 18 took 421.5280032 seconds. The final independent health check confirmed revision 18 and the exact digest after the rehearsal.

One Brevo transactional probe using the active provider adapter and the verified account-owner recipient was delivered at 2026-09-05T16:11:35Z. No recipient address or credential was recorded, and the submission was not retried.

Validation: 196 application tests, 50 script tests, 26 infrastructure tests, TypeScript, Windows deployment safety, structural gate, scan gate, authenticated acceptance and cleanup. The new read-only workflow collector passed changed-file lint and live execution; it saves sanitized test counts, resource diff, fixture cleanup and rollback timing evidence without persisting credentials or raw logs.

Readiness is **66.50% -> 66.50%** for this continuation. The original overnight baseline remains 45.55%. Cognito code is now packaged in the deployed image but remains disabled; this does not constitute application authentication migration. Production still uses Supabase database/auth/storage and Brevo. Staging uses Supabase database/auth, private S3 and Brevo.

Latest estimated September cost: $1.6921038523 at 2026-09-05T16:12:25.106Z. Monthly model $68.67 plus a $2 rehearsal reserve remains below $75; billing can lag. No additional infrastructure or permanent database was created.

The production critical path remains the dedicated production account/profile and authority, private production configuration and separately built image, verified schema/backup/restore evidence, human alarm acknowledgement, production synthetic acceptance/rollback, then separately approved DNS/traffic cutover. Cognito activation still requires application session transport, lifecycle handlers and provider-compatible database/RLS integration. Those capabilities are not claimed complete.

This continuation added the release request af8304f40bad8ccd7336b35cacd026a89be5149a and workflow collector checkpoint 6933e6e; the final evidence commit accompanies the completion report. Full execution evidence is in aws-release18-evidence-20260905.json and aws-workflow-af8304f40bad8ccd7336b35cacd026a89be5149a.json. State: staging operational, not production cutover-ready, not fully migrated.
