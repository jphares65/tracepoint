# TracePoint full-AWS production cutover package — 2026-09-12

Status: prepared and validated offline; **not authorized for execution**. This
package does not authorize production provisioning, writes, identity creation,
email, DNS, traffic changes, or Supabase changes.

Corrected full-AWS readiness is **77% live-verified** on the unchanged 21-gate
ledger: 42% corrected baseline plus 35 net-new verified points. The old 79%
figure measured a hybrid launch and is not the full-AWS baseline. Separately,
the package is **95% implementation-prepared**; that indicator gives no deployed
credit. The exact gate accounting is in
`aws-full-migration-readiness-20260912.json`.

## Immutable scope and evidence

- Target account/role/region: `193644343389`,
  `TracePointMigrationProduction`, `us-east-1`.
- Target providers: ECS/Fargate, RDS PostgreSQL, Cognito, S3, SES, Secrets
  Manager, AWS Backup, CloudWatch, WAF, KMS, SNS, and SQS.
- Permanent runtime legacy providers: none. Supabase is retained only as a
  sealed rollback source; Vercel and Brevo have no target role.
- Authoritative target lineage: 76 source migrations followed by 20 immutable
  AWS overlays, 96 ledger entries total.
- Read-only source lineage: 60 source migrations. The exact 16 unapplied source
  deltas are in `aws-production-source-lineage-20260912.json`; there are no
  unexpected production migrations.
- Sanitized source inventory hash:
  `01fd0efb02c2dbd3ca9faadc2bf42a921bf1c714c061202931e4aa747cde5a3d`.
- Reconciliation contract:
  `aws-production-reconciliation-contract-20260912.json`.

Observed source scope is 90 exposed relations and 4,358 exposed rows. Three
views account for 253 derived rows, leaving 4,105 physical rows. The migration
copies approximately 4,007 physical rows: 92 target-seeded catalog rows and six
legacy activation-token rows are intentionally not copied. It creates 96
passwordless Auth anchors, then applies the missing 16 source migrations in
their authoritative order and all 20 AWS overlays against the copied data.

Identity scope is 96 Auth users, 95 memberships, 86 membership-role links, and
three departments. Ninety-four users have an active membership, one has only an
inactive membership, and one has no membership. The membership-less user is the
single active platform administrator. There are zero duplicate normalized-email
groups, zero multi-department users, and zero membership users absent from Auth.
No email address or user ID is present in committed evidence.

Storage scope is two objects totaling 522,978 bytes. Source object keys and
contents are absent from committed evidence.

## Rehearsal result and limits

The production-shaped synthetic rehearsal passed at the observed scale. It
combined a real clean PostgreSQL 76+20 bootstrap and logical dump/restore with
synthetic table, identity, object, interruption, and repeat-run contracts:

- clean bootstrap and complete 76+20 ledger: passed;
- dump/restore reconciliation: 2.951 seconds;
- bootstrap plus restore wall time: 12.364 seconds;
- table contracts: 87 physical relations / 4,105 modeled rows, passed;
- identity create-only retry: interrupted after 37, resumed to 96, second run
  resumed all 96 without duplicate creation;
- object create-only retry: interrupted after one, resumed to two, second run
  resumed both without overwrite;
- total local rehearsal: 12.475 seconds.

This is not a claim that production data was moved or that the production
60-to-96 runner was exercised against live RDS. The maintenance estimate below
therefore reserves much more time for managed-service startup, a final source
snapshot, network transfer, Cognito/SES throttles, operator checks, and rollback
decisions.

## Production cost gate

The implemented Tier 1 steady-state projection is **$131.72/month**. A rolling
ECS deployment raises the monthly-equivalent peak to **$144.38**; the rolling
case with RDS grown to its 100-GiB maximum is **$153.58**. The approved hard AWS
Budget target is **$175/month**, leaving $21.42 over that conservative peak. The
last read-only evidence showed a live $150 budget; changing it is still a
separately authorized production action.

The model includes Single-AZ `db.t4g.small` RDS with 20 GiB gp3 and a 100-GiB
maximum, one Fargate task/max two, one ALB, public IPv4 charges, one-AZ Secrets
Manager and SNS feedback endpoints, eight customer-managed KMS keys, the rate
rule and three managed WAF groups, alarms/logs, S3/ECR/Backup/CodeBuild,
Cognito, SES, DNS, data transfer, scoped CloudTrail object events, and security
service allowances. Exact component cents and assumptions are in
`aws-cost-optimization-model-20260912.json`. Deployment is no-go until the
budget exists at the approved $175 amount.

## SES early checkpoint

The exact domain, MAIL FROM, DNS, production-access request, monitoring, and
suppression requirements are in `aws-production-ses-readiness-20260912.md`; the
prepared API payload is `aws-production-ses-access-request-20260912.json`.

The immediately publishable records, after owner DNS authorization, are:

| Name | Type | TTL | Value |
|---|---|---:|---|
| `bounce.tracepointhq.com.` | MX | 300 | `10 feedback-smtp.us-east-1.amazonses.com` |
| `bounce.tracepointhq.com.` | TXT | 300 | `v=spf1 include:amazonses.com ~all` |
| `_dmarc.tracepointhq.com.` | TXT | 300 | `v=DMARC1; p=none;` |

The three DKIM CNAMEs cannot exist yet: SES has no production identity, so it
has not generated the tokens. Create the domain identity first, read the three
tokens and `SigningHostedZone`, and publish each exact
`<token>._domainkey.tracepointhq.com CNAME <token>.<SigningHostedZone>` record.
The Microsoft 365 root SPF record remains unchanged. The owner has identified
`contact@tracepointhq.com` as the monitored endpoint. After deployment, its SNS
subscription must be confirmed before cutover.

SES is no-go until production access, sending, DKIM, domain identity, and MAIL
FROM statuses all succeed; daily quota is at least 1,000 and send rate at least
5/s; suppression is exactly bounce plus complaint; source suppression is
reconciled; both configuration sets deliver events; the worker, DLQ and human
alert path are proven; and one approved non-customer smoke recipient succeeds.

## Required security-policy change set

The live organization SCP statement `KeepCognitoAndSesDisabled` denies every
Cognito create/update/delete and SES create/put/send/update/delete action. The
live `TracePointProductionBoundary` also excludes all Cognito and SES actions
from its broad allow and permits only reads. These controls intentionally make
the full-AWS deployment impossible today; inline task policies cannot override
them.

Owner authorization must cover one reviewed change set before deployment:

1. Remove only the `KeepCognitoAndSesDisabled` deny statement from
   `tracepoint-production-guardrails.scp.json`. Retain the DNS, account,
   region, and security-audit denies unchanged.
2. Extend `TracePointProductionBoundary` only for the migration/CDK roles to
   create and manage the TracePoint production Cognito pool/client/domain and
   SES domain identity/configuration sets/event destinations in `us-east-1`.
3. Extend the runtime-role boundary only for resource-scoped Cognito user
   lifecycle/session actions and `ses:SendEmail` from
   `notifications@tracepointhq.com`; effective access remains the intersection
   with the narrower inline policies.
4. Preserve the permissions boundary on every generated production role and
   the exact-account plus `aws:SourceArn` constraints on one-shot ECS runner
   trusts.
5. Do not grant Route 53 mutation; Wix DNS remains a separate owner action.

The final IAM simulator result must show the CDK deployment role can perform the
required resource lifecycle, the runtime task can perform only its documented
identity/send operations, and neither can change DNS, organizations, account,
CloudTrail, Config, GuardDuty, or Security Hub protections.

## Pre-cutover commands (read-only or offline)

Run from the exact clean reviewed commit. Every generated evidence file must be
private, sanitized, and hash-bound into the cutover manifest.

```powershell
git status --porcelain
git rev-parse HEAD
node scripts/assert-aws-native-provider-reachability.mjs
node scripts/calculate-full-aws-production-cost-model.mjs
node scripts/run-production-shaped-rehearsal.mjs --inventory .artifacts/production-source-inventory-20260912.json --output .artifacts/production-shaped-rehearsal-20260912.json
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

```powershell
Push-Location infra
npm.cmd run build
npm.cmd test
npx.cmd cdk synth --app "npx ts-node --prefer-ts-exts bin/full-aws-production-infra.ts" -c productionOperation=preview -c productionConfig=<ABSOLUTE_REVIEWED_CONFIG_PATH> --quiet
Pop-Location
```

The production archive can be built and validated without touching AWS:

```powershell
npx.cmd tsx scripts/publish-full-aws-production-image.mts --config <ABSOLUTE_REVIEWED_CONFIG_PATH> --validate-archive-only
```

Publishing or scanning the production ECR image is a production write and is
not included in these commands until separately authorized.

## Monday operator timeline

Planned write-unavailable window: **75 minutes**. Reserve a 120-minute staffed
change window; the extra 45 minutes is contingency, not planned downtime.

| Minute | Operator action and gate |
|---:|---|
| T-1440 to T-120 | Complete SES identity/DNS/access and production-policy approvals; set DNS TTL 300; update the budget to the approved $175 target; deploy approved AWS foundations; publish and scan all images; validate backups, alarms, human alert path and target health. Any incomplete prerequisite is no-go. |
| T-60 to T-15 | Confirm exact account/role/region, clean commit, image digests, 60-source hash, 76+20 local hash, latest source counts, zero provider violations, empty target, successful RDS snapshot, SES status, Cognito pool, S3 versioning/Backup, two healthy bridge tasks, and rollback manifest. |
| T-15 to T0 | Announce maintenance through an owner-approved channel, stop asynchronous dispatch/import jobs, drain queues, verify no in-flight mutation, record source LSN/time and final immutable manifests. |
| 0–3 | Owner authorizes write freeze; application enters maintenance/read-only mode. Confirm zero writes for two consecutive checks. |
| 3–8 | Take final Supabase snapshot/export under repeatable-read. Capture 60-version count/hash and source reconciliation manifests. |
| 8–20 | Create source-parity PostgreSQL schema, restore copied rows and Auth anchors in one transaction. Retry only from a provably empty/anchor-only target or an exact full-content match. |
| 20–30 | Apply the 16 missing source deltas in authoritative order, then AWS overlays 001–020. Validate 96-entry ledger and every foreign key. |
| 30–37 | Run table counts, PK sets, projected row hashes, tenant/timestamp/orphan checks. Any unexplained difference is no-go and rollback-before-write. |
| 37–42 | Copy the two manifest-bound objects create-only to S3; validate owner, tenant prefix, byte count and SHA-256. |
| 42–52 | Create the authorized Cognito cohorts with original TracePoint UUIDs, persist one-to-one subject links, and reconcile 96 users / 95 memberships / 86 role links. Activation email is sent only after the SES gate. |
| 52–60 | Deploy the exact digest-pinned AWS-native runtime, wait for two healthy targets, and verify secret/version, database TLS/pool, Cognito, S3, SES and alarm configuration. Do not switch traffic yet. |
| 60–63 | Owner performs the approved Wix DNS change to the reviewed ALB/CloudFront target. Confirm TLS and target resolution. |
| 63–73 | Execute the critical smoke matrix below with approved synthetic/owner test identities. Monitor 5xx, target health, DB connections/CPU/storage, auth failures, queues, worker errors and security alerts. |
| 73–75 | If all gates pass, mark `awsAcceptedWrites=true`, reopen writes, announce completion, and start the sealed-source observation period. Otherwise execute the applicable rollback path. |

## Go/no-go and rollback thresholds

Cutover fails closed on any unexplained database/object/identity discrepancy;
any cross-tenant access; migration task nonzero exit; unvalidated foreign key;
target ledger other than 76+20; undigested image; critical/high image finding;
any forbidden provider configuration or reachable unreviewed provider edge;
fewer than two healthy ECS targets; TLS/certificate failure; SES not production
ready; missing human alert; or a failed critical smoke test.

Automatic pre-write rollback is allowed only while `awsAcceptedWrites=false`
and before customer traffic can create AWS-side state. Restore the prior bridge
task definition/service, wait for stable healthy targets, restore the prior DNS
record if it was changed, and keep the AWS target isolated for diagnosis.

After `awsAcceptedWrites=true`, automatic bridge rollback is prohibited. Freeze
writes, capture the AWS commit boundary, reconcile the AWS delta back to the
sealed source using an owner-authorized procedure, and only then restore bridge
traffic. Security isolation failure, cross-tenant exposure, unrecoverable auth
failure, or any critical data discrepancy triggers immediate write freeze. A
sustained application 5xx rate above 1% for five minutes, fewer than two healthy
targets for five minutes, database connection saturation above 80%, or a
feedback/migration DLQ message triggers operator review and rollback unless the
cause is understood and remediated inside the window.

The RDS recovery objective is the latest automated snapshot/PITR point, followed
by immutable migrations and reconciliation. S3 recovery uses versioned objects
and AWS Backup restore into an isolated prefix/bucket before promotion. ECS
recovery uses the preceding digest-pinned task definition. Supabase remains
unchanged and access-controlled as the rollback source for **seven complete
days** after successful cutover; decommissioning requires a new owner approval,
two daily clean reconciliations, no rollback event, confirmed backup restore,
and export retention according to policy.

## Post-cutover smoke matrix

Each module must prove authorized success plus one tenant-negative or
permission-negative case where applicable: Cognito login, refresh rotation,
logout/global revocation, recovery and MFA readiness; platform administration
and Support Mode; department settings and onboarding; Fleet vehicles,
inspections, work orders, equipment and documents; equipment assets and
assignments; firearms, assignments, inspections, malfunctions and history;
off-duty requests/approvals; range days, roster, drills, courses and results;
training events, attendees, instructors, requirements and certifications;
notification enqueue/send/suppression/feedback; AI importer approval and audit;
S3 upload/read/delete authorization; and audit-event continuity. Any critical
module failure keeps writes closed.

## Identity cohort execution

The sanitized exact cohort is:

- three department-scoped active cohorts totaling 94 identities;
- one inactive-membership identity, retained disabled and sent no activation;
- one membership-less active platform administrator, handled by an explicit
  platform-administrator cohort and never assigned a fabricated department;
- zero duplicate-email and zero multi-department exceptions.

Current department-scoped tooling can safely prepare/execute the 94 active
members. It intentionally excludes the inactive and membership-less identities.
Before production execution, owner authorization and a focused implementation
must define the non-email disabled import for the inactive identity and the
platform-administrator import for the membership-less administrator. Production
cannot truthfully claim a complete 96-user transition until both are implemented
and tested; fabricating memberships is prohibited.

All Cognito identities preserve the existing TracePoint UUID as the application
identity, while Cognito `sub` is stored only in the one-to-one provider link.
Passwords are not copied. Authorized users complete activation/password setup
through SES; invitation failure leaves an explicit compensation-required state
and no false committed membership.

## Consolidated owner authorizations

One authorization package should explicitly approve or reject each independent
gate:

1. **Spend:** update the production AWS Budget from $150 to the approved $175/month target.
2. **Security controls:** apply the reviewed SCP and permissions-boundary change
   set needed for resource-scoped Cognito and SES management/sending.
3. **Infrastructure:** deploy the synthesized 13-stack full-AWS production
   target and publish/scan exact-commit runtime and migration images.
4. **Database:** create/write RDS, read the Supabase source snapshot, move the
   approximately 4,007 copied public rows plus 96 Auth anchors, and apply 16+20
   migrations.
5. **Objects:** read the two source objects and create the two manifest-bound S3
   targets; no source deletion or overwrite.
6. **Identity:** create the approved Cognito cohorts, send activation/recovery,
   revoke old sessions at the cutover boundary, and approve the inactive and
   membership-less administrator dispositions described above.
7. **Email:** create the SES identity/configuration sets, publish DNS, submit the
   prepared production-access request, confirm the monitored contact/on-call
   mailbox, import suppression, and send only approved transactional/smoke mail.
8. **Change window:** impose the 75-minute write freeze and execute the approved
   production runbook.
9. **DNS/traffic:** change Wix/public DNS only at minute 60 after all preceding
   gates pass.
10. **Rollback:** authorize pre-write rollback automatically; require explicit
    incident-owner approval for any post-write reverse data movement.
11. **Legacy isolation:** seal Supabase read-only for seven days, remove all
    runtime credentials immediately after cutover, and separately authorize
    decommissioning only after the observation criteria pass.

## Remaining external blockers

- SES identity creation, Wix DNS, production-access submission/approval, and a
  verified monitored mailbox are external owner actions. DNS/SES verification
  may take up to 72 hours and is the critical calendar-time risk.
- The last-observed $150 live production budget must be updated to $175 before deployment.
- The SCP/boundary changes above require owner authorization and an organization
  administrator.
- The inactive identity and membership-less platform-administrator transition
  need the explicit disposition and focused implementation described above.
- Production image publication/scanning, target deployment, live 60-to-96
  migration rehearsal, customer data movement, identity creation, email, and
  DNS remain intentionally unexecuted.
