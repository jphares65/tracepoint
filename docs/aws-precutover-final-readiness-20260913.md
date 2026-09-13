# TracePoint final pre-cutover readiness checkpoint — 2026-09-13

The AWS-native production runtime is privately deployed and healthy behind the existing ALB, but it is not publicly authoritative. Task definition revision 3 uses the exact authorized digest and is steady at desired/running/pending `1/1/0`; retained bridge revision 2 remains the exact rollback target. Public DNS still points to Vercel, and no customer traffic, customer data, identity, email or DNS state changed. Private validation passed except for one precise blocker: `TracePointProductionBoundary` v15 denies the ECS task role's Cognito lifecycle calls even though Organizations and the role's scoped inline policy permit them.

## Current production posture

- Account `193644343389`, role `TracePointMigrationProduction`, region `us-east-1` were reconfirmed.
- The Budget remains exactly **$150/month**. Billing-lagged actual spend is **$13.964**; AWS provides no forecast. Tier 1 remains **$131.72 steady** and **$144.38 during a normal rolling deployment**. The **$153.58** rolling state at 100-GiB RDS allocation remains prohibited.
- Production PostgreSQL 17.9 is available on private, encrypted, deletion-protected `db.t4g.small` RDS with 20 GiB allocated, 35-day PITR and exact **97/97** lineage: 76 source migrations plus 21 AWS overlays.
- The immutable AWS-native runtime, database-migration and identity-migration images are published and have completed scans with zero critical or high findings. Runtime revision 3 is pinned to `sha256:5f4b8fe59eaf8befd29bf7ca455ec1d4eb2b18836e66818bf2cc8cae55a90c0b`; retained bridge revision 2 remains `ACTIVE` for rollback.
- The 13-stack AWS-native production assembly synthesizes cleanly. The exclusive runtime deployment added only the reviewed AWS-native secret/task roles, PostgreSQL security-group path, digest-pinned task definition and Tier 1 desired/max capacity; it contained no DNS or customer-data operation. CloudFormation ran from `20:55:42.893Z` through `21:05:34.489Z` and completed successfully.

## Production-shaped migration package

The read-only source inventory is hash-bound at **4,377 rows across 90 exposed relations**, 96 identities, 95 memberships, three departments and two objects totaling 522,978 bytes. The source has 60 applied source migrations; the target plan applies the documented 16 ordered source deltas and 21 AWS overlays. No unexpected lineage delta exists.

The prior fixed 4,358-row assertion was a real defect because production grew by 19 rows. Reconciliation now verifies the inventory SHA-256, exact nonnegative per-relation counts, unique relation names and computed totals. A production-shaped synthetic rehearsal used the current 4,377-row scale, preserved UUID and tenant contracts, completed logical restore in 3.076 seconds and the full modeled sequence in 12.223 seconds, and proved retries do not duplicate or overwrite records. The final migration runner passed a no-deploy synthesis gate against the immutable zero-finding migration image.

Three private department-scoped storage manifests cover both source objects. Both objects were read and hashed without modifying the source; a no-write destination comparison found exactly two missing target objects and proved the existing copy procedure is create-only and resumable. Identifiers and object keys remain in ignored private artifacts and were not committed.

The identity cohort remains 96 users: 93 confirmed, three unconfirmed, 95 memberships, 94 active memberships, one inactive-only user, one membership-less platform administrator and no duplicate-email groups. Mapping, case normalization, inactive-user, compensation, activation-failure and role-preservation tests pass. Exact executable Cognito batches must be generated from the reconciled target rows after the authorized customer database copy; creating users or sending activation/recovery mail remains prohibited.

## Application, operations and security validation

- Application tests: **409/409 passed**.
- Migration/tooling tests: **174/174 passed**, using a TypeScript-aware split only for the CDK assembly test.
- Infrastructure tests: **61/61 passed**.
- TypeScript, infrastructure build, production Next.js build, touched-file lint, provider isolation, 31-script PowerShell parsing and `git diff --check` passed.
- Provider reachability covers 154 entry points and 322 reachable modules with zero static legacy edges, zero unapproved dynamic legacy edges and zero unapproved legacy endpoint literals. The 29 dynamic legacy imports are reviewed rollback-only bridge edges.
- Live WAF has the bounded request-flood rule and three reviewed AWS managed groups attached to the production ALB. Config records the reviewed 41 resource types; CloudTrail is multi-region, logging, validated and includes the private S3 object-data event selector. GuardDuty and Access Analyzer report zero active findings.
- All 17 metric alarms and the encrypted-SNS composite runtime alarm are `OK`. The durable alert topic still has no human email subscription because confirmation/sending is separately gated.
- The private S3 target is blocked-public, KMS encrypted, versioned and bucket-owner enforced. The AWS-native secret validates with no Supabase, Vercel or Brevo fields. Reviewed KMS keys have rotation enabled. RDS permits PostgreSQL only from reviewed task groups.
- The Backup vault is locked in governance mode, contains the retained recovery point, and the prior disposable restore passed in 512.051 seconds.

The deployed service is steady at `1/1/0` with one healthy ALB target. Direct ALB validation with the production Host header returned HTTP 200 from `/api/health`, HTTP 200 from `/login`, and HTTP 401 from unauthenticated `/api/access`; Wix/Vercel DNS was not changed. Startup produced only the five expected Next.js ready messages and no error.

A short-lived revision-3 task proved verified PostgreSQL TLS, the bounded `tracepoint_runtime` login, connection limit 20, no superuser or RLS bypass, 96 RLS-protected tables, zero remaining `auth.uid()` policies, fail-closed synthetic tenant visibility and denied service-role escalation. It performed no database writes and read no customer data. A separate revision-3 task proved S3 put/get/KMS encryption/delete using a 41-byte synthetic object; its exact object version and delete marker were then removed and a follow-up listing returned none.

Cognito foundation configuration is otherwise ready: deletion protection is active, MFA is on, the pool contains zero users, auth-code/OIDC configuration is present, token revocation and refresh rotation are enabled, and activation/recovery email uses the reviewed SES configuration set. The runtime's no-create `AdminGetUser` probe failed with `AccessDeniedException`. IAM simulation identified the exact cause: Organizations allows the action, but permissions boundary `TracePointProductionBoundary` v15 does not. No permission was broadened and no identity was created.

## SES, registrar and DNS

The SES domain identity and Easy DKIM remain `SUCCESS`; no identity or DKIM record was recreated or rotated. Custom MAIL FROM remains `PENDING` with `REJECT_MESSAGE`. Production access remains disabled/denied. Both TLS-required configuration sets, bounce/complaint suppression, and the encrypted SNS/SQS/DLQ feedback worker are live and healthy. No email was sent and no access request was resubmitted.

Verisign RDAP reports `pending transfer`; Wix nameservers `ns10.wixdns.net` and `ns11.wixdns.net` remain authoritative. The authoritative `.com` server, Cloudflare `1.1.1.1` and Google `8.8.8.8` all return no DS. The prepared Route 53 zone remains at 31 record sets. The apex returns HTTP 200 from Vercel, `www` returns the expected 307 redirect, and the Microsoft 365 MX remains authoritative. No DNS, registrar or Route 53 mutation occurred.

## Defects corrected

1. Replaced the stale fixed production row-count gate with a hash-bound, exact dynamic reconciliation contract.
2. Made production-shaped scale derive physical and copied rows from the authoritative relation set while retaining exact schema and identity/object scope.
3. Corrected effective-SCP validation to traverse the account, OU and root hierarchy.
4. Corrected migration, identity and rollback tooling for enhanced ECR scanning by querying scan findings with the immutable digest and safely handling absent zero-count severity fields.
5. Removed the already-propagated historical DS record from the current DNS blocker list.

## Readiness and remaining blockers

Implementation-prepared readiness remains **100%**. Live-verified full-AWS readiness remains **81%** with **zero net-new live points** in this checkpoint. Gates 8, 13, 15, 16, 17, 18 and 21 remain open for 19 points. No credit is claimed for read-only refreshes, stronger evidence, source inventory growth, local tests, dry runs, published-but-undeployed images or the rejected deployment.

Only these blockers remain:

1. A separately authorized narrow update to `TracePointProductionBoundary` must permit only the reviewed Cognito lifecycle actions from `tracepoint-production-aws-native-ecs-task` to user pool `us-east-1_diFmWDMe9`; the role policy already scopes those actions to that pool.
2. Registrar transfer completion, followed by separate nameserver-delegation authorization.
3. Route 53 authority so custom MAIL FROM can validate, then separate SES access-request resubmission and smoke-email authorization.
4. Owner authorization for the final source secret, write freeze, database copy/reconciliation, two-object copy, 96-user Cognito execution/activation and public traffic switch.
5. Successful observation, followed by separately authorized legacy credential revocation, Supabase retirement and Route 53 DNSSEC/new DS publication.

## Exact final sequence

1. Authorize and apply the narrow Cognito runtime permissions-boundary correction, then repeat only the failed no-create Cognito probe and authenticated synthetic RBAC path.
2. Preserve the deployed digest-pinned revision 3 privately and retained bridge revision 2 as the rollback target until customer cutover authorization.
3. Complete the registrar transfer while retaining Wix nameservers.
4. Recheck DS absence and the exact 31-record Route 53 manifest.
5. With separate authorization, delegate the registrar to the four retained Route 53 nameservers; verify web and Microsoft 365 before proceeding.
6. Wait for custom MAIL FROM `SUCCESS`; preserve the already-verified DKIM identity.
7. With separate authorization, resubmit SES production access, obtain approval, confirm the monitored alert path and authorize one non-customer smoke email.
8. Reconfirm account, role, budget, immutable digests, image scans, recovery point, alarms and rollback task definition.
9. Enter the approved maintenance window; pause asynchronous dispatch and freeze source writes.
10. Require two consecutive zero-write checks and capture final source snapshot/LSN, row, identity and object manifests.
11. Execute the resumable database copy, then apply the 16 ordered source deltas and 21 AWS overlays; fail closed on any reconciliation discrepancy.
12. Execute the create-only two-object copy and reconcile byte counts, SHA-256, metadata and tenant prefixes.
13. Generate and execute the exact standard and exceptional Cognito batches; reconcile all 96 identities and 95 memberships before changing authentication.
14. Promote the already-validated AWS-native task and run health, session, tenant-negative and module smoke checks.
15. With separate traffic authority, apply the reviewed Route 53 application aliases and verify customer traffic.
16. Reopen writes only after database, object, identity, email-feedback, alarms and backups are green; otherwise execute the phase-appropriate rollback.
17. Observe for at least 168 hours with Supabase sealed and unchanged as the rollback source.
18. Under later destructive authority, revoke legacy credentials and retire Supabase/Vercel/Brevo dependencies; then separately enable Route 53 DNSSEC and publish the new parent DS.

Machine-readable sanitized evidence is in `docs/aws-precutover-final-readiness-20260913.json`. Private identifiers, source object keys, credentials and customer data are excluded.
