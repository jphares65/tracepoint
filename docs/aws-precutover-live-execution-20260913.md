# TracePoint production pre-cutover live execution — 2026-09-13

The authorized non-traffic foundations are substantially live. Production customer data,
identities, email, DNS, traffic, Wix and Supabase were not changed. Live-verified readiness
remains **79%**: this checkpoint closes meaningful sub-work, but neither the database-rehearsal
gate nor the timed-restore gate is complete, so no fractional or evidence-only credit is claimed.

## Completed live work

- Published the AWS-native runtime image from clean pushed commit
  `63828c03a091a75a232d6a70297bd7d40c8d0b3c` through CodeBuild run
  `tracepoint-production-aws-native-image-build:391cfd0d-d305-4f92-88c3-9f756574f60e`.
  The immutable digest is
  `sha256:5f4b8fe59eaf8befd29bf7ca455ec1d4eb2b18836e66818bf2cc8cae55a90c0b`;
  the basic ECR scan completed with zero findings. The image is not deployed.
- Enabled CloudFormation termination protection on the storage, database, Cognito, SES
  feedback-worker, Backup and database-bootstrap stacks. Rollback is an explicit
  `update-termination-protection --no-enable-termination-protection` on the exact stack;
  it was not exercised.
- Applied the reviewed production WAF update. The live order is `RequestFlood` priority 0,
  AWS Common Rule Set priority 10, Known Bad Inputs priority 20 and Amazon IP Reputation
  priority 30. All managed groups use their vendor action, have no exclusions, remain attached
  to the existing ALB, and retain redacted logging.
- Deployed only the account-baseline stack, not the cost-controls stack. CloudTrail now records
  all management events plus read/write S3 object data events scoped exactly to
  `tracepoint-production-private-193644343389/`. The three reviewed security metric filters
  and alarms are live and `OK`.
- Expanded AWS Config to the exact reviewed 41-resource inclusion list. The recorder and
  delivery channel match, continuous recording is active, and the latest status is `SUCCESS`.
- Applied backup-failure alerting after first allowing a dependency-safe rollback when its
  three account-baseline alarms were not yet live. The final EventBridge rule is enabled for
  `FAILED`, `ABORTED` and `EXPIRED` Backup jobs and publishes through the encrypted SNS topic
  to the encrypted durable SQS receipt path. No human/email subscription was created.
- Created AWS Backup job `aea72c7a-bbf2-44a1-be9f-88f4a274f6f7` from the empty, non-customer
  RDS target. It completed at `2026-09-13T17:57:54.887Z` and produced retained recovery point
  `arn:aws:rds:us-east-1:193644343389:snapshot:awsbackup:job-aea72c7a-bbf2-44a1-be9f-88f4a274f6f7`.

## Actions still blocked or intentionally deferred

- The environment safety reviewer blocked the expressly authorized ECS schema-bootstrap task
  because it treated the production RDS write as outside trusted inline authority. No bypass was
  attempted. Consequently the 76 source migrations plus 21 AWS overlays remain offline-verified
  but not live-verified on production RDS.
- The reviewer also blocked creation of the private disposable RDS restore target. The recovery
  point is complete, but no timed restore or recovery-integrity proof is claimed.
- The live AWS-native runtime remains undeployed. The existing bridge service remains at two
  healthy tasks on task definition
  `arn:aws:ecs:us-east-1:193644343389:task-definition/tracepointproductionruntimeServiceTaskDefA64ABA6A:2`;
  its image remains `tracepoint-production:ae3d2a4ce87b2085e251b1995f51a7b07058ec4d` as the
  recorded rollback reference. No customer traffic was switched.
- SES production access remains disabled/denied under case `178924156800066`; custom MAIL FROM
  remains `PENDING` while Wix is authoritative. Domain identity and Easy DKIM remain verified and
  unchanged, and no email was sent or resubmitted.
- Google Public DNS, Cloudflare DNS and the authoritative `.com` server returned no DS record.
  DNSSEC removal has propagated at all checked sources. Route 53 Domains reports the domain is
  not in this AWS account, so the registrar transfer has not started. No registrar or DNS action
  was taken.

## Cost and safety

The live Budget remains healthy and exactly **$150/month**. Billing-lagged actual spend remains
**$13.964**. The deterministic Tier 1 model already includes the now-live WAF groups, security
alarms, scoped CloudTrail events, CodeBuild allowance and 20-GiB Backup allowance: **$131.72/month**
at one-task steady state and **$144.38/month** for the current/normal rolling shape. The
**$153.58** 100-GiB rolling scenario remains prohibited. No budget change was made.

## Governance and rollback

The live SCP remains `p-rvx1u7q7`, hash
`d6d4e47027b9d015d860a01320d1a1c004e43942311b838588dd710c5e3c28a3`; its exact prior document
is retained in `infra/policies/tracepoint-production-guardrails-pre-cognito-20260913.scp.json`
with hash `63ec8775d3b2b883bf64e7642660a30e04c3cfa7bdee6267b0e5a0ad048afba6`.
The permissions boundary remains default version v15, hash
`39acb70e0f81ae0f430de60eddf52ce37afea56b588451f552fdd313d005eacc`; retained rollback version
v11 has hash `7ce425791fa0900396457d7570fbd2b2d433eae4021ede5d31a2dd101ec194d3`.
No governance rollback was executed.

## Validation

- Next.js production build, root TypeScript and the provider-isolation prebuild passed.
- All 61 infrastructure tests and all 172 migration/tooling tests passed.
- A clean disposable PostgreSQL bootstrap applied exactly 76 source migrations plus 21 immutable
  AWS overlays; permission matrices, retirement matrices, tenant negatives and armory checks passed.
  Lineage upgrade tests passed for clean, production-upgrade, staging-upgrade and structural parity.
- The optional local logical dump/restore could not run because no official `pg_dump.exe` is
  installed on this host; the script failed closed after bootstrap and removed its disposable DB.
- Full production synthesis completed for all 13 stacks with cdk-nag and no blocking finding.
  Live diff shows 11 description-only changes, one intentionally undeployed runtime provider/image
  change, and no remaining alert-delivery difference.
- Provider reachability covered 154 entry points and 322 reachable modules with zero static legacy
  edges, zero unapproved dynamic legacy edges and zero unapproved endpoint literals.
- PowerShell parsing passed for 31/31 scripts; `git diff --check` passed.
- Access Analyzer and GuardDuty report zero active findings; Security Hub V2 is present; CloudTrail
  is logging to both S3 and CloudWatch. The runtime image scan is `COMPLETE` with zero findings.
- RDS is `available`, private, encrypted, deletion-protected, TLS-enforced through its parameter
  group, 20 GiB with 100-GiB maximum, and retains 35 days of automated backups/PITR.

The structured, sanitized evidence and exact remaining blockers are in
`docs/aws-precutover-live-execution-20260913.json`.
