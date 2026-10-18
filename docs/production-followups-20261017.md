# Production follow-ups found during store-review preparation (2026-10-17)

Read-only findings. No production change has been made. Each item needs separate approval.

## 1. AWS Backup does not protect the live database

Verified (read-only, 2026-10-17):
- Live database `tracepoint-production-final-cutover-20260926`: RDS automated backups with 35-day
  point-in-time recovery; two manual pre-migration snapshots
  (`tracepoint-final-pre-035-040-20261016`, `tracepoint-final-post-035-037-pre-039-040-20261016`)
  that never expire on their own; one on-demand AWS Backup recovery point (2026-10-15, vault
  `tracepoint-production`, deleted 2026-11-19).
- AWS Backup plan `tracepoint-production`: daily rule (06:15 UTC, kept 35 days) and monthly rule
  (1st of month, kept 365 days), selecting resources tagged `Backup=daily`
  (`infra/lib/backup-recovery-stack.ts`).
- The live database has no `Backup` tag (tags: `Application`, `Authority=non-authoritative`,
  `Purpose=final-cutover-quarantined`). It was created by the cutover scripts outside CDK.
- The plan instead backs up the retired pre-cutover instance `tracepoint-production`
  (30 daily points kept 35 days and 1 monthly point kept 365 days). That instance is still running
  and holds agency data up to the cutover.

Minimum correction (one reversible tag; no plan or IAM change):
```
aws rds add-tags-to-resource --resource-name arn:aws:rds:us-east-1:193644343389:db:tracepoint-production-final-cutover-20260926 --tags Key=Backup,Value=daily --profile tracepoint-production --region us-east-1
```
Verify the next day: a recovery point for the live database created by the plan's daily rule
(`list-recovery-points-by-backup-vault --by-resource-arn …`, `CreatedBy.BackupPlanId` set).
Rollback: `aws rds remove-tags-from-resource … --tag-keys Backup`.

Related decisions (not part of the minimum correction): retire the pre-cutover instance and its
backups; correct the stale `Authority`/`Purpose` tags; confirm whether the private S3 bucket (also
tagged `Backup=daily` in CDK) has recovery points — none appeared in the vault listing.

## 2. Scheduled notification emails have never been delivered

Verified (read-only):
- `/tracepoint/production/notification-dispatch` log: every run since the first on 2026-10-07
  ended with HTTP 403 (about 432 runs per day, schedule `rate(5 minutes)`). The logs hold only
  status codes, no personal data.
- The dispatcher Lambda (`infra/lib/notification-dispatch-stack.ts`, added 2026-10-05/06) posts to
  `https://tracepointhq.com/api/notifications/email-dispatch` with `node:https`, sending only
  `authorization` and `content-length` headers — no `User-Agent`.
- The production web ACL `tracepoint-production-requests` runs `AWSManagedRulesCommonRuleSet`,
  whose `NoUserAgent_HEADER` rule blocks requests without a User-Agent with HTTP 403.
- Behind the firewall there is a second block: the AWS-native request guard does not list
  `/api/notifications/email-dispatch` as a public path (`isAwsNativePublicPath` returns false), so a
  request without a session cookie receives 401 before the route checks the dispatch secret.
  The route itself only returns 401 for a bad secret, never 403.

To confirm before changing anything (read-only, needs a fresh AWS sign-in): in
`aws-waf-logs-tracepoint-production-requests`, a BLOCK at a dispatch time with terminating rule
`AwsCommonProtection` and rule `NoUserAgent_HEADER`.

Affected: only queued notification emails. When a user opens notifications, alerts are reconciled
and an email is queued if their preferences allow (code defaults: email on, critical only) —
for example critical and qualification alerts. These rows stay `Pending`.
Not affected: account activation and invitation emails (sent directly through SES at the time of
the action, `src/lib/tracepoint/activation.ts`) and password resets (sent by Cognito via
`AdminResetUserPassword`).

Minimum correction (both needed; deploy only with approval):
1. Dispatcher: send a `User-Agent` header (for example `TracePoint-Notification-Dispatcher/1`)
   in the inline Lambda code — infrastructure deploy of the dispatcher stack only.
2. Application: add `/api/notifications/email-dispatch` as an exact public path in the AWS-native
   guard; the route keeps its bearer-secret check — application deploy.
Before enabling, review the `Pending` backlog: once fixed, every queued email since 2026-10-07
would be sent at once. Consider expiring stale rows or sending only recent ones.

## 3. Agency offboarding procedure (needed before the first agency termination)

The privacy policy commits to a 90-day transition period after an agency agreement ends, followed
by deletion. Export is supported today (Settings → Import/Export, department administrators: CSV
and PDF exports of personnel, firearms, ammunition, qualifications, training, range days,
certifications, equipment, off-duty firearms, complete audit history, and a complete PDF report;
uploaded files download individually). Deletion has no documented procedure: the database
cascades a department delete (`supabase/migrations/202609060005_allow_guarded_department_teardown.sql`),
but S3 objects under `attachments/<departmentId>/` and `department-assets/`, and Cognito
accounts of users with no other membership, also need handling.

Smallest process: a written offboarding runbook (confirm termination date; offer export; record
the 90-day deletion date; at day 90 deactivate memberships, delete the department, delete its S3
prefixes, disable or delete Cognito users without other memberships; record completion), rehearsed
once against a fictional staging agency. No infrastructure or application change is required.
