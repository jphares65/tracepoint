# Consolidated full-AWS owner authorization package

## Scope and safety boundary

This package requests decisions; it authorizes nothing by itself. No command in
this document was run. Production writes, customer data movement, public DNS,
paid-service creation, outbound email, and Supabase decommissioning remain
prohibited until the owner approves the applicable numbered action.

The target is an AWS production runtime with no Supabase or Brevo runtime,
credential, backup, or recovery dependency. Supabase remains available only as
the temporary source and rollback system until the observation window passes.

## One consolidated decision

Approve, reject, or amend the following seven actions together. Approval must
state a maximum incremental monthly spend, RPO, RTO, backup retention, cutover
window, rollback observation duration, and operational mailbox.

| Action | Requested authority | Expected change and impact | Downtime/data scope | Cost bound | Readiness unlocked |
|---|---|---|---|---|---:|
| 1. Paid AWS staging database | Create one private, encrypted, Single-AZ RDS PostgreSQL staging instance, 20 GiB gp3, automated backups, deletion protection and Secrets Manager credentials; increase the staging ceiling | Enables true AWS-native synthetic parity; no customer data | No production downtime; synthetic non-PII only | Planning reserve: up to **$30/month**, prorated; stop/delete after acceptance subject to retained-snapshot decision | 14 D points become executable, and 23 A points become end-to-end verifiable |
| 2. Production database topology | Select provisioned RDS PostgreSQL Multi-AZ as the fastest conservative default, or explicitly select Aurora PostgreSQL; approve creation and a database monthly cap | Adds the permanent PostgreSQL target, private networking, monitoring and PITR | No downtime at creation; initially empty | Final quote required from AWS Pricing Calculator after instance/storage choice; planning envelope **$80–$220/month** incremental | Gates 14 and 19, 4 points |
| 3. Production data/object rehearsal and cutover | Permit read-only source manifests, then controlled logical copy and S3 object copy; approve write freeze unless CDC is separately selected | Moves customer database rows and stored objects; checks row/object/checksum parity | Estimated write freeze **30–90 minutes** after measured rehearsal; reads may remain available if application supports maintenance mode | Usually transfer/request charges under **$10** at current unmeasured size; abort if manifest exceeds approved bound | Gates 13, 15 and 16, 8 points |
| 4. Cognito user transition | Approve user identity linking, activation/password-reset communication, session revocation, MFA policy and cohort order | Users establish new Cognito passwords; existing authorization remains database-derived | No planned application downtime; users must reauthenticate | Cognito usage-based; confirm MAU count before activation | Gate 8, 3 points |
| 5. SES and human operations | Approve SES production sending, sender/domain DNS records, SNS/SQS feedback processing, and name one operational mailbox not used as the transactional sender | Replaces Brevo and creates a human alarm endpoint | No application downtime; outbound mail changes provider | SES/message and mailbox-plan charges; low-volume planning reserve **under $5/month**, excluding mailbox subscription | Gate 18, 2 points |
| 6. Public traffic cutover | Approve Route 53/DNS changes to the AWS ALB and a rollback threshold/window | Makes AWS the public origin | DNS-dependent; expected no hard downtime, but schedule a **60-minute** guarded window | DNS/query cost is nominal and already modeled with hosting | Gate 21, 1 point |
| 7. Supabase retirement | Select a rollback observation period (recommended 7 days), then approve key revocation, egress removal, billing cancellation/project decommission and destruction only after signed reconciliation | Eliminates the temporary source and all recurring Supabase cost | No downtime if the AWS rollback package remains healthy; deletion is irreversible after retained exports expire | Saves the current unknown Supabase plan and any temporary PITR add-on | Gate 17, 5 points |

## Required owner values

The following values are genuinely architectural or business decisions and are
not safe engineering defaults:

1. Incremental staging cap and whether the staging RDS instance may be deleted
   after parity, including whether its final snapshot is retained.
2. Production engine/topology, maximum monthly database spend, RPO, RTO,
   automated-backup retention, and whether cross-account or cross-region copies
   are required.
3. Write freeze or CDC, approved cutover date/time, maximum measured downtime,
   rollback thresholds, and rollback observation duration.
4. Cognito MFA policy, activation message language/timing, cohort order, and the
   maximum acceptable forced-reauthentication window.
5. SES From address/domain and a distinct human operational mailbox. Repository
   and AWS evidence do not establish an existing unsuppressed operational
   mailbox; `contact@tracepointhq.com` is only evidenced as a sender.
6. GovCloud destination account/region and whether all CI/build artifacts must
   be mirrored into AWS/GovCloud or GitHub may remain a non-runtime control-plane
   dependency.

## Pre-cutover command sequence (prepared, not executed)

Commands use PowerShell and explicit placeholders. Replace every angle-bracket
value, review the generated CloudFormation change sets, and capture command
output in the cutover evidence directory before any execution.

```powershell
$Region = '<approved-region>'
$ProductionAccount = '<12-digit-production-account>'
$SourceRef = '<approved-immutable-git-sha>'
$DatabaseStack = 'tracepoint-production-database'
$RuntimeStack = 'tracepoint-production-runtime'

aws sts get-caller-identity
git rev-parse HEAD
git diff --exit-code $SourceRef

npx.cmd cdk synth $DatabaseStack --app '<approved-database-app-command>' --context architectureTarget=full-aws
npx.cmd cdk diff $DatabaseStack --app '<approved-database-app-command>' --context architectureTarget=full-aws --fail
npx.cmd cdk deploy $DatabaseStack --app '<approved-database-app-command>' --context architectureTarget=full-aws --method prepare-change-set --change-set-name tracepoint-full-aws-database

npx.cmd cdk synth $RuntimeStack --app 'npx ts-node --prefer-ts-exts bin/production-infra.ts' --context architectureTarget=full-aws
npx.cmd cdk diff $RuntimeStack --app 'npx ts-node --prefer-ts-exts bin/production-infra.ts' --context architectureTarget=full-aws --fail
npx.cmd cdk deploy $RuntimeStack --app 'npx ts-node --prefer-ts-exts bin/production-infra.ts' --context architectureTarget=full-aws --method prepare-change-set --change-set-name tracepoint-full-aws-runtime

aws cloudformation describe-change-set --stack-name $DatabaseStack --change-set-name tracepoint-full-aws-database --region $Region
aws cloudformation describe-change-set --stack-name $RuntimeStack --change-set-name tracepoint-full-aws-runtime --region $Region
```

The production database CDK app and full-AWS production composition are not yet
implemented, so the placeholder app command intentionally prevents accidental
execution. The final package must replace it with a committed command before
owner execution approval.

## Data movement sequence (prepared, not executed)

1. Record immutable source/target connection fingerprints without printing
   credentials.
2. Produce source row-count, primary-key range and schema fingerprints in a
   read-only transaction.
3. Run `pg_dump` using the official PostgreSQL client matching or newer than the
   source server, with no ownership or ACL statements, into an encrypted local
   or S3-staged artifact approved for customer data.
4. Restore into the isolated target; run schema, relationship, RLS, trigger,
   function, row-count and tenant-negative reconciliation.
5. Copy each object to its canonical S3 key and reconcile bucket, object count,
   byte count and SHA-256 where source APIs expose bytes.
6. Repeat as a timed rehearsal. If the measured window exceeds the approved
   downtime, stop and choose CDC rather than extending the outage implicitly.
7. At cutover, enable maintenance/write freeze, take the final delta/full dump,
   restore, reconcile, deploy the AWS-native task definition, run acceptance,
   and only then change public traffic.

No exact customer-data command can be safely emitted until the target endpoint,
approved encrypted artifact location and source data size are known. Those are
outputs of Actions 1–3, not values that should be guessed into a shell command.

## Validation and abort thresholds

- Zero ECR scan findings at every severity.
- ECS desired/running/pending equals approved desired count/desired count/zero;
  deployment circuit breaker and automatic rollback enabled.
- Every ALB target healthy; no new application errors during the acceptance
  interval.
- Exact schema/relationship/function/trigger/RLS fingerprint match after the
  AWS authorization overlay.
- Exact per-table row counts and declared per-module business invariants.
- Cross-tenant and unprivileged access denied before provider I/O.
- Cognito issuer, audience, nonce, state, mapping, session, revocation and MFA
  cases pass with synthetic users before any real-user cohort.
- S3 object count/bytes/checksums and version restore pass.
- SES delivery, bounce and complaint events reach durable suppression storage;
  no suppressed recipient is retried.
- Abort on any unexplained mismatch, authorization bypass, missing audit event,
  unhealthy target, unexpected 5xx increase, or rollback command failure.

## Rollback sequence

Before the production write switch, rollback is a configuration/image rollback
to Supabase and cannot lose AWS writes because no AWS writes have started. After
the write switch, a provider toggle alone is unsafe. The required rollback is:

1. Stop new writes and preserve both databases and all manifests.
2. If no accepted AWS writes exist, redeploy the immutable bridge task revision
   and restore DNS/traffic to the prior origin.
3. If accepted AWS writes exist, reconcile/export the AWS delta before returning
   authority to Supabase; never discard or overwrite it.
4. Verify prior task health, tenant isolation, authentication and object access.
5. Keep Supabase credentials and source recovery intact for the approved
   observation window; do not decommission during incident response.

## Supabase PITR decision

Supabase PITR is not part of the permanent design and closes none of the 58
full-AWS points. It is justified only if the owner selects a transition method
whose source-data loss exposure exceeds the approved RPO. The current logical
dump/restore rehearsal proves PostgreSQL portability and restore mechanics; it
does not provide continuous recovery or a production RPO.

The current Supabase tier is not exposed by available CLI/repository evidence.
Official pricing lists Pro from $25/month with daily backups and PITR at
$100/month per seven days of retention. A one-day PITR overlap is approximately
$3.29 plus the plan/compute charges. Do not buy it unless the approved cutover
risk assessment requires that temporary protection.

## Operating-cost view

- Existing AWS hosting model: **$99.23/month low-use**, approximately
  **$124.55/month burst**, excluding the permanent database and external
  providers.
- Existing staging model: **$68.67/month** against a $75 alert threshold; only
  $6.33 headroom remains, so a persistent RDS target is not silently authorized.
- Temporary overlap: current Supabase/Brevo/Vercel charges (exact tiers unknown)
  plus AWS hosting, approved staging database, and optionally prorated PITR.
- Permanent full AWS: existing AWS hosting plus approved RDS/Aurora, Cognito,
  SES, S3 and backup usage. The responsible planning envelope is
  **$180–$350/month** before material traffic/transfer, pending exact database
  topology, MAU, email, storage and RPO inputs. Supabase, Brevo and Vercel runtime
  costs should fall to zero after their rollback windows.

These are planning envelopes, not quotes. The final change-set review must attach
an AWS Pricing Calculator estimate for the chosen topology.
