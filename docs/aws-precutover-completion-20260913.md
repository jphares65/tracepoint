# TracePoint pre-cutover completion checkpoint — 2026-09-13

This checkpoint exhausts the safe offline and read-only work available while the
registrar transfer and production-change authorizations remain pending. It does
not authorize or perform customer-data movement, identity creation, email,
nameserver changes, runtime replacement, or traffic cutover.

## Verified current state

- The production identity is account `193644343389`, role
  `TracePointMigrationProduction`, region `us-east-1`.
- The live monthly Budget is unchanged at **$150**; billing-lagged actual spend
  is **$12.297** and AWS supplied no forecast. No AWS resource was created or
  changed in this run.
- Tier 1 remains **$131.72 steady** and **$144.38 during a normal rolling
  deployment**. A rolling deployment after RDS reaches its approved 100-GiB
  ceiling models at **$153.58** and is therefore a hard no-go under the current
  budget.
- Twelve protected TracePoint CloudFormation stacks are complete. The private
  application-storage, RDS, Cognito, SES-worker, and Backup stacks are not live.
- The existing ECS service has two healthy tasks, but it is the pre-migration
  runtime image and its secret schema still names Supabase and Brevo. Public DNS
  remains on Vercel, not this ALB. Replacing or scaling this service is a
  production change and was not performed.
- The SES foundation exists. DKIM and custom MAIL FROM remain `PENDING`, SES
  production access remains disabled, and request/case `178924156800066` is
  `DENIED`. No email was sent.

## Desired-versus-live infrastructure disposition

| Area | Live state | Desired Tier 1 state | Safe action completed now | Remaining authority/dependency | Rollback and incremental cost |
|---|---|---|---|---|---|
| Network | VPC, two public subnets, two private subnets, flow logs and S3 gateway endpoint live | Add least-privilege application/database groups and one-AZ Secrets Manager/SNS endpoints | Read-only inventory and 13-stack synth | Authorize reviewed stack updates | CloudFormation rollback; endpoints are included in the $131.72 model |
| KMS/secrets | Core keys and legacy-shaped application secret live | Eight retained CMKs and exact AWS-native secret schema | Policy/schema tests passed | Authorize stack deployment and secret finalization | Retain old secret version; new steady cost already modeled |
| Storage | Audit/build/ALB buckets live; no private application bucket | Versioned, blocked-public, KMS-encrypted private bucket with create-only migration | Policy, checksum, retry and restore tests passed | Authorize bucket deployment, then separate two-object copy | Retain source objects and S3 versions; modeled cost $0.87 |
| Database | No RDS instance | Private TLS-only PostgreSQL 17.9, `db.t4g.small`, 20–100 GiB, 35-day PITR | 76+20 bootstrap and production-shaped dump/restore passed | Authorize deployment/bootstrap; do not permit a max-storage rolling state above budget | Snapshot/retained backups; modeled compute/storage $25.66 initial |
| Cognito | No production pool | Cognito pool/client/domain and AWS-native sessions | Lifecycle and synthetic cohort tests passed | Owner disposition for one inactive-only and one membership-less platform-admin identity, then deployment/execution authorization | Preserve Supabase auth sealed until observation ends; Cognito low-volume model $0 |
| SES | Foundation, two configuration sets, encrypted SNS/SQS/DLQ live | Verified identity/MAIL FROM, worker, production access and monitored alert path | Status and suppression verified read-only | Registrar/delegation, SES approval, worker deployment and one smoke-email authorization | Disable sending/configuration use; fixed foundation KMS cost about $1 |
| Backup | No production vault/plan | KMS vault, plan/selection, RDS PITR and S3 recovery | Offline recovery assembly and staging/local restore proof passed | Authorize production deployment and timed non-customer restore exercise | Retained snapshot/version recovery; modeled $1.90 |
| Compute | ECR/cluster/public ALB/two legacy-configured tasks live | Digest-pinned AWS-native task, desired one/max two | Production application build passed | Authorize CodeBuild/ECR publication and scan; then authorize runtime replacement | Retain prior task definition and immutable bridge export; rolling peak $144.38 |
| WAF/alerts | Rate rule, seven healthy metric alarms, composite SNS/SQS path live | Add three AWS managed groups and production data-plane alarms | Read-only verification and cdk-nag passed | Authorize reviewed updates; email subscription would send confirmation and needs separate authority | CloudFormation rollback; $4.30 control delta included in model |
| Audit/security | Multi-region validated CloudTrail, management events, Config 26-type recorder, GuardDuty, Security Hub V2 live | S3 object data events and 41-type Config scope | Zero active GuardDuty findings verified | Authorize Config/CloudTrail update. Inspector and account Access Analyzer remain separate unapproved/cost decisions | Restore prior selectors/recorder scope; costs included only where modeled |

## Completed validation and rehearsal

- 405 application tests passed.
- 168 migration/tooling tests passed. The TypeScript assembly test was run in
  its required `tsx` process; the Windows embedded-PostgreSQL harness now exits
  cleanly and removes its disposable process tree.
- 61 infrastructure tests passed.
- TypeScript, the Next.js production build, infrastructure build, PowerShell
  parsing, provider-isolation scan, touched-file lint and `git diff --check`
  passed.
- Strict offline CDK synthesis produced the full 13-stack assembly with cdk-nag
  enabled. The remaining warnings are the reviewed `us-east-1a` validation
  warnings; no cdk-nag failure occurred.
- The authoritative lineage remains **76 source migrations + 20 AWS overlays**.
  Clean bootstrap, RLS/RBAC and tenant-negative checks passed. PostgreSQL 18.6
  `pg_dump`/`pg_restore` completed a clean logical restore and exact metadata/data
  reconciliation.
- The production-shaped run modeled 4,358 exposed rows, 4,105 physical rows,
  96 identities, 95 memberships and two objects. Interruption/retry checks were
  create-only and produced no duplicate or overwrite.
- The native provider scan covered 154 entry points and 322 reachable modules:
  zero static legacy edges, zero unapproved dynamic legacy edges and zero
  unapproved legacy endpoint literals. Twenty-nine dynamic legacy imports remain
  explicitly reviewed rollback-only bridge edges; they are not reachable as
  static AWS-native dependencies.

Repository-wide lint remains an honest pre-existing debt item. The broad run
reported 498 findings before generated `infra/dist` was excluded and 270
findings afterward (226 errors and 44 warnings); migration-touched files pass
lint. Disabling lint rules or rewriting unrelated product features was not used
to manufacture a green result.

## DNS and registrar checkpoint

The Route 53 zone `Z06725946QWMQBKB1JT8` still has 31 record sets. Wix remains
authoritative through `ns10.wixdns.net` and `ns11.wixdns.net`; the website returns
HTTP 200 and Microsoft 365 MX, SPF and Autodiscover records resolve correctly.
The authoritative `.com` server and Cloudflare resolver return no DS. Google
Public DNS still cached the former DS
`35882 8 2 BE5370254126A888C374E7133B0AE38CEE0582679AA6E2969773F05A84B0F0DC`
with a remaining TTL during this check, so DNSSEC removal is not yet fully
resolver-propagated. Route 53 Domains does not yet find the domain in the
production account, which is consistent with a pending transfer. No DNS or
registrar mutation was performed.

## Exact cutover order and gates

1. Confirm the registrar transfer is complete; otherwise stop.
2. Query `.com` authoritative servers and at least two independent public
   resolvers; require the old DS to be absent everywhere used for the gate.
3. Re-hash the Route 53 target manifest and require 31 exact record sets with no
   unexplained drift.
4. With explicit delegation authority, change only the registrar nameservers to
   the four retained Route 53 nameservers.
5. Verify authoritative propagation from the parent and multiple resolvers;
   retain Wix records and the inverse nameserver plan until this passes.
6. Verify apex/www HTTP, Microsoft 365 MX/SPF/Autodiscover/SRV and all SES DNS
   records. Any mail or web regression triggers nameserver rollback.
7. Wait for SES DKIM and MAIL FROM to become `SUCCESS` and domain sending status
   to verify; do not send.
8. With separate authorization, resubmit the SES production-access request and
   wait for approval.
9. Reconfirm account, role, region, branch, immutable source SHA, $150 Budget,
   $131.72 steady and $144.38 rolling projections. A modeled state above $150
   is no-go.
10. Apply the exact reviewed SCP/boundary version for the full-AWS deployment;
    simulate allowed and denied actions and retain the inverse versions.
11. Deploy storage, database, Cognito, SES worker and Backup foundations with
    termination/deletion protection; do not expose traffic.
12. Bootstrap exactly 76 source migrations and 20 overlays. Require ledger,
    schema, RLS, grants, functions, triggers and extensions to reconcile.
13. Publish runtime and migration images from one clean commit, require immutable
    digests and a completed vulnerability scan with no accepted unknowns.
14. Validate alarms, queues/DLQs, Config, CloudTrail data events, GuardDuty,
    target health, RDS automated backups and an isolated restore.
15. Resolve the inactive-only and membership-less administrator decisions and
    create the immutable 96-user identity manifest without emitting identities.
16. Create the immutable two-object manifest and verify source hashes read-only.
17. At the owner-approved window, announce maintenance and stop asynchronous
    import/notification dispatch.
18. Freeze source writes and require two consecutive zero-write checks.
19. Capture the final Supabase snapshot/LSN, migration ledger, row manifests,
    identity manifest and object manifest; seal the rollback export.
20. Restore PostgreSQL, apply the 16 source deltas followed by 20 AWS overlays,
    and fail closed on any count/key/hash/FK/tenant/timestamp discrepancy.
21. Execute the resumable Cognito cohort; reconcile all 96 users, 95 memberships,
    roles, inactive state and the membership-less platform administrator before
    changing authentication.
22. Execute the create-only S3 copy and reconcile both objects by bytes, SHA-256,
    metadata, owner and tenant prefix.
23. Deploy the digest-pinned AWS-native runtime with Supabase, Vercel and Brevo
    fields absent; require healthy targets and unauthenticated health checks.
24. With separate traffic authority, update the reviewed Route 53 application
    aliases; keep the exact inverse records ready.
25. Run module smoke tests for login/MFA readiness, platform administration,
    Support Mode, settings, onboarding, importer, Fleet, equipment, armory,
    off-duty, range, training, certifications, notifications and storage.
26. Reopen writes only after database, identity, object, tenant-negative, email
    feedback and backup gates pass. Otherwise execute the appropriate rollback;
    after any AWS-native write, rollback requires freeze-and-reconcile rather
    than blind DNS reversal.
27. Observe for at least 168 hours with Supabase sealed and unchanged as the
    rollback source. Decommission only under a later destructive authorization.
28. After the rollback window closes, enable Route 53 DNSSEC, publish the new DS,
    verify chain-of-trust propagation, and only then retire obsolete Wix state.

The detailed operator commands, minute marks, thresholds and inverse operations
remain in `aws-production-cutover-package-20260912.md`; this checkpoint updates
the current gates without rewriting prior evidence.

## Consolidated owner authorization still required

1. **Pre-cutover production foundations:** deploy the reviewed full-AWS storage,
   RDS, Cognito, SES worker, Backup, Config/CloudTrail and WAF changes while
   preserving the $150 Budget and prohibiting the 100-GiB rolling sensitivity.
2. **Immutable artifacts:** run production CodeBuild, publish runtime/migration
   images to ECR and perform the production scan; no deployment or traffic.
3. **Identity decisions:** migrate the inactive-only identity disabled without
   email (or specify another disposition), and authorize a global platform-admin
   migration path that does not invent a department membership.
4. **Current legacy runtime disposition:** either scale the unreferenced
   legacy-configured ECS service to zero until cutover or explicitly retain it;
   its public ALB is live even though TracePoint DNS does not point to it.
5. **Delegation and SES:** after transfer, authorize the nameserver change, SES
   access-request resubmission, monitored SNS subscription confirmation and one
   non-customer smoke email.
6. **Live migration/cutover:** authorize the maintenance window, write freeze,
   final database/object movement, 96-user Cognito transition, AWS-native runtime
   deployment, Route 53 traffic change and rollback authority.
7. **Post-cutover:** authorize Supabase/Vercel/Brevo credential revocation and
   later decommission only after the 168-hour observation; separately authorize
   Route 53 DNSSEC and new parent DS publication.
8. **Optional security services:** decide whether to enable paid Inspector and an
   account Access Analyzer; neither is silently included in readiness credit.

The single next action when the registrar transfer completes is: **verify the
old DS is absent at the `.com` authority and two public resolvers, then request
the consolidated nameserver-delegation authorization.**
