# TracePoint AWS cost-optimization review

**Review date:** 2026-09-12

**Pricing region:** `us-east-1`

**Scope:** offline analysis plus implemented, non-deployed Tier 1 CDK/security controls

**Recommendation:** deploy the implemented Tier 1 target only after the consolidated owner authorization and listed live preflight checks.

## Executive result

The supplied `$265.44/month` production model was not complete. After correcting its omissions and adding the required managed WAF groups, security-event metrics/alarms, and narrowly scoped CloudTrail S3 data events, the hardened comparison baseline is **$280.34/month**. This is a target-architecture estimate, not current incurred spend: no production RDS instance exists yet and the complete application stack has not been deployed.

The implemented initial-production configuration is **$131.72/month steady state**, **$144.38 during a normal two-task rolling deployment**, and **$153.58 if the database has grown from 20 to its 100 GiB autoscaling maximum during that deployment**. The `$4.30` increase over the approved optimization proposal is entirely attributable to required pre-deployment controls: three AWS-managed WAF groups (`+$3.00`), three CloudTrail-derived security metrics plus alarms (`+$1.20`), and a 100,000-event S3 object-audit allowance (`+$0.10`). It keeps the AWS-native architecture, ALB, WAF, Cognito, RLS/RBAC, private encrypted RDS, S3, SES, secrets, CloudTrail, security services, durable feedback queues, backup/PITR, restore and rollback mechanisms. It does not depend on AWS free-tier eligibility.

The primary availability trade is explicit: Tier 1 has one steady application task and one Single-AZ database. It therefore loses continuous service through a task-host/AZ failure and RDS automatic standby failover. Recovery, encryption, isolation and audit controls remain. Tier 2 restores Multi-AZ database and worker endpoint redundancy without changing application code or database technology.

The current staging model is corrected from `$115.42` to **$118.42/month** because the AWS-native source defines at least six CMKs. A coordinated business-hours ECS/RDS schedule reduces it to **$104.19/month** while leaving its ALB, WAF, private database, storage, backups, endpoints and test capability intact. A retained legacy build key would add `$1/month` to either current staging figure.

## Production before/after detail

All values are monthly USD and use 730 hours. “Current” means the presently modeled full production target, corrected for demonstrated omissions.

| Resource / service | Current configuration | Current | Tier 1 recommendation | Recommended | Savings | Security impact | Availability / operational impact | Scale-up trigger |
|---|---|---:|---|---:|---:|---|---|---|
| RDS compute | PostgreSQL 17.9, `db.t4g.medium`, Multi-AZ | $94.17 | `db.t4g.small`, Single-AZ | $23.36 | $70.81 | None: private subnets, TLS, KMS, roles and RLS unchanged | No synchronous standby or automatic AZ failover; maintenance/AZ events can interrupt service | SLA requires AZ failover; sustained CPU >50%, free memory <512 MiB, or credit surplus charges |
| RDS gp3 storage | 100 GiB Multi-AZ, max 500 GiB | $23.00 | 20 GiB Single-AZ, max 100 GiB | $2.30 | $20.70 | None | Less headroom; 5-GiB free-space alarm and autoscaling retained | 40 GiB allocated/forecast, sustained IOPS/throughput pressure, or forecast breach |
| Fargate CPU | Two 0.25-vCPU tasks | $14.77 | One 0.25-vCPU task, autoscaling max two | $7.39 | $7.38 | None | One-task steady state; rolling deployment temporarily uses two | CPU >50% for three days, queue/latency pressure, or contractual redundancy |
| Fargate memory | Two 0.5-GiB tasks | $3.25 | One 0.5-GiB task, autoscaling max two | $1.62 | $1.63 | None | Same as CPU | Memory >65% sustained or OOM/task restarts |
| Task public IPv4 | Two addresses | $7.30 | One address | $3.65 | $3.65 | Task SG remains ALB-only inbound; avoids a NAT gateway | Single task aligned with the database AZ | Second steady task enabled |
| ALB hours | One public ALB | $16.43 | Retain | $16.43 | $0.00 | HTTPS, WAF association and access logs retained | Health checks and rolling routing retained | Keep in every tier |
| ALB LCU | One-LCU allowance | $5.84 | Retain one-LCU allowance | $5.84 | $0.00 | None | Automatically grows with traffic | Review when actual LCUs approach one |
| ALB public IPv4 | Two AZ addresses | $7.30 | Retain | $7.30 | $0.00 | None | ALB remains multi-AZ even though Tier 1 target capacity is one AZ | Keep in every tier |
| PrivateLink | Secrets Manager + SNS endpoints in two AZs | $29.20 | Both endpoints and feedback worker in one isolated AZ | $14.60 | $14.60 | Private API access and signed-envelope verification unchanged | Feedback remains durably buffered by SQS, but worker processing pauses if that AZ fails | Tier 2, multi-AZ SLA, or feedback RTO <1 hour |
| KMS | Eight permanent CMKs | $8.00 | Retain all eight | $8.00 | $0.00 | No blast-radius consolidation | Rotation sensitivity shown below | Revisit only after policies and rotation billing are measured |
| Secrets Manager | Four secrets plus API allowance | $1.65 | Retain | $1.65 | $0.00 | No change | No change | Growth in secret count/API calls |
| WAF | Regional ACL, rate rule plus three AWS-managed groups, low requests | $9.06 | Retain the same hardened protections | $9.06 | $0.00 | Common, known-bad-input and IP-reputation protections enforced; no exclusions configured without evidence | Monitor labels/blocked requests and switch only an offending managed group to count under rollback authority | Threat review or materially higher request volume |
| CloudWatch alarms/security metrics | 18 billed alarm metrics, one composite and three CloudTrail custom metrics | $3.20 | Retain | $3.20 | $0.00 | Root, privileged IAM and security-control changes now enter the existing encrypted human/durable alert path | Missing-data semantics are explicit for every metric alarm | Add alarms only for a new actionable failure mode |
| CloudTrail S3 data events | Exact private object bucket, 100,000-event allowance | $0.10 | Retain | $0.10 | $0.00 | Identity-aware read/write object audit evidence | Variable with object request volume | Review at 75,000 monthly data events |
| CloudWatch logs | 20-GiB allowance | $10.00 | 2.5-GiB allowance; 90-day hot application/operational retention, 365-day audit trail | $1.25 | Audit trail retained; current flow/worker/RDS log encryption gaps must be fixed | Less immediately queryable history; archive policy owns older evidence | Actual ingestion >2 GiB/month or retention obligation >90 days |
| Enhanced Container Insights | Enabled | $13.40 | Disable in Tier 1 | $0.00 | No security control removed; basic ECS/ALB metrics, alarms and logs remain | Loses per-container/task telemetry detail | Multiple services/tasks, repeated task incidents, or formal SLO debugging |
| S3 | 5 GiB + requests + access logs | $0.87 | Retain encryption, bucket key, versioning, access logs and lifecycle | $0.87 | None | No change | Storage/request growth |
| ECR | 5-GiB allowance, immutable/scanned | $0.50 | Retain | $0.50 | None | No change | Image inventory exceeds lifecycle allowance |
| AWS Backup | 20-GiB warm allowance | $1.90 | Retain through restore proof | $1.90 | No recovery reduction | Daily RDS copy overlaps native PITR; optimize only after measured RPO/RTO | Proven redundant restore path and owner-approved retention policy |
| CodeBuild | 600 paid minutes | $3.00 | 60 paid minutes | $0.30 | Immutable build and scan gates unchanged | More builds increase variable spend | >60 paid minutes/month |
| Cognito | 96 MAU | $0.00 | Retain | $0.00 | None | No change | MAU/pricing tier change |
| SES | 10,000-message allowance | $1.00 | Retain | $1.00 | None | No change | Message volume/attachment growth |
| SNS/SQS/Lambda feedback | Low-volume allowance | $0.50 | Retain | $0.50 | Durable bounce/complaint handling unchanged | Single-AZ processing boundary as noted above | Queue age or delivery volume rises |
| Route 53 | Zone + one million queries | $0.90 | Retain | $0.90 | None | No change | Query growth |
| Internet transfer | 10-GiB allowance | $10.00 | 5-GiB allowance | $5.00 | None | Variable estimate only | Forecast or observed transfer >4 GiB/month |
| Account security services | GuardDuty, Security Hub, Config and audit allowance | $15.00 | Retain `$15` allowance | $15.00 | No control removed | Exact GuardDuty/Security Hub/Config usage remains a forecast uncertainty | Forecast >$15 or enabled-plan change |
| **Total** |  | **$280.34** |  | **$131.72** | **$148.62** |  |  |  |

The optimized estimate deliberately retains a conservative `$15` security-services reserve. A synthesized target-only Security Hub Essentials lower bound is about `$7.52/month` before all live IAM/resources and threat/security-data processing; the older `$10` combined reserve did not have defensible headroom.

## Staging before/after

| Resource / service | Current | Recommended | Effect |
|---|---:|---:|---|
| Persistent fixed resources | $94.08 | $94.08 | Keep ALB, WAF, two-AZ endpoints, storage, backups, secrets, six CMKs, governance and DNS |
| RDS compute | $11.68 | $4.80 | Run 300 hours/month: 60 hours/week plus 40 hours contingency |
| Fargate task + public IPv4 | $12.66 | $5.21 | ECS desired count zero outside the same active window |
| Schedule allowance | $0.00 | $0.10 | Small EventBridge/Lambda or automation allowance |
| **Total** | **$118.42** | **$104.19** | **$14.23/month saved** |

Safe scheduling order is: scale ECS to zero, stop RDS, then on resume start RDS and wait for `available` before restoring ECS desired count one. The daily backup window must be inside the active period; SQS must retain SES feedback while the database is stopped; scheduled unhealthy-target alarms must be deliberately suppressed without weakening unscheduled alerting; and a manual override must exist for demonstrations and rehearsals. RDS automatically starts after seven consecutive stopped days and does not create automated backups while stopped, so an invariant check is required. This schedule is a proposal only and was not applied.

A one-AZ endpoint option would reduce staging by another `$14.60/month` but weakens production-equivalent AZ testing. It is not the primary recommendation while staging is still the cutover rehearsal environment.

## Totals and budget

| Measure | Monthly cost |
|---|---:|
| Corrected current production steady state | **$280.34** |
| Optimized production steady state | **$131.72** |
| Optimized production rolling peak | **$144.38** |
| Optimized rolling peak with RDS at 100 GiB | **$153.58** |
| Corrected current staging | **$118.42** |
| Optimized staging | **$104.19** |
| Combined current baseline | **$398.76** |
| Combined optimized baseline | **$235.91** |
| Combined monthly savings | **$162.85** |

Recommended production AWS Budget: **$175/month**, with actual-spend alerts at 70%, 85% and 100%, forecast at 90% and 100%, and the existing immediate `$10` cost-anomaly threshold. A Budget is an alert, not an enforcement cap. CDK now expresses the approved `$175` target. The live production budget was `$150` with `$11.13` actual spend at the last read-only check; changing it remains a separately authorized deployment action.

KMS automatic rotation is a sensitivity: the first paid rotation of eight keys makes steady state **$139.72**, and the second makes it **$147.72**. After the second paid rotation, a normal rolling deployment reaches `$160.38`; with database storage at 100 GiB it reaches `$169.58`. These remain below the recommended budget, but actual security-service usage must also fit the remaining headroom.

## Tier plan

| Tier | Configuration | Planning estimate | Entry / exit criteria |
|---|---|---:|---|
| **1 — Initial production** | Single-AZ `db.t4g.small`, 20–100 GiB gp3; one 0.25-vCPU/0.5-GiB task, max two; ALB/WAF; one-AZ feedback endpoints; essential metrics/logs; all security and recovery controls | **$131.72 steady** | Current 3 departments / 96 identities / very low concurrency. Exit on an uptime commitment requiring AZ failover, five active agencies, 50 concurrent users, sustained task CPU >50%, memory >65%, DB CPU >50%, free memory <512 MiB, material CPU-credit charges, or 40-GiB storage forecast |
| **2 — Growth** | Multi-AZ `db.t4g.small`, 20 GiB gp3; two steady tasks/max four; two-AZ endpoints; Enhanced Container Insights; managed WAF rules after count-mode review | **about $211.92 steady** | Use when the first HA/SLA trigger is met. Resize to `t4g.medium` only from measured DB pressure. Add scheduled load tests and tighter on-call SLOs |
| **3 — Mature / HA** | Multi-AZ `db.t4g.medium`, 100 GiB gp3; four steady tasks; two-AZ worker/endpoints; stronger monitoring/security reserve; cross-account/region backup based on approved RTO/RPO | **about $317.36 steady**, before higher traffic/storage | 20+ agencies, 200+ concurrent users, sustained database/resource pressure, 99.95%+ contractual SLA, second active region/account, or retirement of the sealed rollback source |

Movement from Tier 1 to Tier 2 is an in-place RDS configuration change and ECS desired-count/config update. It does not require application redesign, a new provider, or migration to another database technology.

## RDS decision and later Multi-AZ upgrade

Current modeled RDS is PostgreSQL 17.9, `db.t4g.medium`, Multi-AZ, 100 GiB gp3 with a 500-GiB autoscaling ceiling, private/no public access, forced TLS, KMS encryption, 35-day automated backup/PITR, retained automated backups, deletion protection, snapshot-on-removal, PostgreSQL log export and seven-day Performance Insights.

Tier 1 changes only instance size, storage bounds and AZ topology. The exact later upgrade procedure is:

1. Confirm a successful automated backup, a current manual/AWS Backup recovery point and a completed restore rehearsal; reconcile source/target counts and hashes.
2. Schedule a maintenance window and ensure application retry/connection-pool behavior is active. Record the DB instance identifier, parameter group, subnet group, security groups, KMS key, backup settings and latest restorable time.
3. Submit one reviewed `ModifyDBInstance` change setting Multi-AZ true and, if metrics require it, `db.t4g.medium`. Keep the same database, endpoint, parameter group, private subnet group, KMS key and backup policy. Prefer the maintenance window; use immediate application only under a separately authorized window.
4. RDS takes a snapshot, provisions a standby in another AZ and establishes synchronous replication. Monitor RDS events, free storage, CPU, connections, replica state and application latency; expect possible I/O degradation and a brief interruption even though AWS describes the conversion as minimal/no downtime.
5. After the instance is `available`, run login, tenant-negative, write/read, importer and file-reference smoke tests. Perform a controlled failover test in a later authorized window, verify the endpoint remains stable, and record measured recovery time.
6. Roll back only through a separately reviewed restore or topology modification if the conversion fails; never delete the source recovery points during the observation period.

The lost availability in Tier 1 is automatic standby failover and continuous service through DB-host/AZ maintenance/failure. Encryption, private networking, TLS, authentication/authorization, backups, PITR, deletion protection, restore capability and immutable application deployment remain unchanged.

## ECS, networking and load balancing

- The application task is already at Fargate’s smallest configured shape: 0.25 vCPU / 0.5 GiB. Live production metrics over the observed window showed average CPU about 0.15%, maximum about 75.6% during a short spike, average memory 22.7%, maximum 29.5%, 16,862 ALB requests and average target response time about 28 ms. One steady task with max two is proportionate; the circuit breaker, 100% minimum healthy and 200% maximum deployment settings preserve a two-task rolling replacement.
- ARM64 Fargate pricing is about 20% below x86 compute. The Docker stages have multi-architecture upstream images and no obvious application-level blocker, but the immutable build pipeline is x86-only and the complete dependency/native-image path has not been built, scanned and exercised on ARM. The maximum saving is only about `$1.80/month` per continuously running task. Defer ARM until a parallel ARM image and parity suite pass; it is not needed to meet the target.
- There are no NAT Gateways. The design has one free S3 gateway endpoint, two paid interface endpoint services, one ALB, ALB public addresses and task public addresses. Tier 1 aligns the database, task, feedback worker and feedback endpoints to one AZ to avoid routine cross-AZ data transfer. The database remains private.
- Retain the ALB. It materially supplies HTTPS/TLS termination, ECS routing, health checks, WAF association, deletion protection, access logging and safe rolling deployment behavior. Removing it would save too little relative to the security and operational complexity introduced.

## Logging, backup and security review

Implemented offline; live deployment evidence remains required before cutover:

- VPC Flow Log, SES feedback-worker, RDS PostgreSQL export, application, build, WAF, audit and migration logs are KMS-encrypted. Tier 1 uses 90-day hot operational retention and keeps `ALL` VPC traffic.
- Every metric alarm declares missing-data behavior. RDS telemetry gaps are actionable (`BREACHING`); sparse event/error metrics are `NOT_BREACHING`; connection thresholds are 50 for Tier 1 and 100 for HA layouts.
- AWS Config’s selective continuous recorder covers 41 reviewed resource types. Exact-list validation detects drift and the SCP change set confines recorder/channel replacement to the production migration or CDK execution role.
- The unconditional EventBridge-to-SNS/KMS grants are removed; CloudWatch and EventBridge publish only from the exact alarm/rule ARN in the exact account.
- Production enforces the Common, Known Bad Inputs and Amazon IP Reputation AWS-managed WAF groups with no unevidenced exclusions, plus the existing rate limit. Pre-traffic monitoring owns false-positive detection and scoped rollback.
- CloudTrail captures all object reads/writes only for the private application bucket. Root, privileged IAM and security-control changes feed three event-driven alarms into the existing composite.
- The production target requires `contact@tracepointhq.com`; confirming the generated SNS subscription and proving controlled delivery remain live no-go gates.
- Production uses reversible governance-mode Vault Lock at 35–365 days. Compliance mode remains deferred until the dated evidence trigger in `aws-tier1-deployment-readiness-20260912.md`.

Controls classified as useful but deferrable at current scale are Enhanced Container Insights, RDS Enhanced Monitoring, Database Insights Advanced, CloudTrail Insights, continuous Inspector rescanning, cross-region Security Hub aggregation and cross-account/region backup copy. Each becomes required at the Tier 2/3 triggers above or when the sealed rollback source is retired. CloudTrail management events, GuardDuty foundational coverage, Security Hub/Config coverage, immutable ECR scanning, WAF, RDS logs/metrics, backups and recovery testing are retained.

Daily AWS Backup for RDS overlaps 35-day native automated backups/PITR. Do not remove it before measured restores prove native RPO/RTO and the owner approves a retention policy. At that point, retain native daily/PITR plus monthly vault recovery points; keep AWS Backup for S3. S3 versioning, bucket keys, access logs and lifecycle policies remain because their cost is negligible at current scale.

## Pricing basis and exclusions

The deterministic model is `docs/aws-cost-optimization-model-20260912.json`. RDS rates were verified through the AWS Price List API published 2026-09-11/effective 2026-09-01: `db.t4g.medium` Multi-AZ `$0.129/hour` (SKU `SCBZU9XX357QUA4D`), `db.t4g.small` Single-AZ `$0.032/hour` (SKU `S9H3AXMBHSKRFJTA`), gp3 Multi-AZ `$0.23/GiB-month` and gp3 Single-AZ `$0.115/GiB-month`. Other rate inputs and URLs are recorded in the JSON model and the earlier production model.

Excluded: taxes, AWS Support plan, third-party costs, one-time cutover transfer/compute, T4g unlimited credit overage, workload growth beyond stated allowances, and KMS rotations beyond the separately shown sensitivity. Security service usage is a conservative allowance because actual GuardDuty/Security Hub/Config dimensions can change with resource inventory and event volume. The model must be refreshed after the first full production month.

## Implemented CDK diff and validation boundary

The non-deployed implementation adds `rds-single-az` as a fail-closed target combination requiring exactly one desired task and maximum two. It changes only that explicit target to:

- `db.t4g.small`, 20 GiB gp3, maximum 100 GiB, Single-AZ, while retaining 35-day PITR, AWS Backup, encryption, deletion protection and snapshot retention;
- one desired Fargate task/max two, aligned to the initial database AZ;
- one-AZ Secrets Manager/SNS endpoints and feedback worker;
- 90-day application-log retention and basic ECS service metrics instead of Enhanced Container Insights.

The existing Multi-AZ and Aurora target combinations remain unchanged and still require two desired tasks/max four. `infra/full-aws-production-tier1-proposed.json` is intentionally a non-deployable placeholder-account preview. No live infrastructure, account policy, Budget, database, application, staging schedule or DNS setting was changed by this review.

Offline validation completed:

- deterministic production/staging cost-model tests: 4 passed;
- infrastructure TypeScript build: passed;
- complete infrastructure regression suite: 49 passed, 0 failed;
- focused Tier 1 and shared provider tests: 12 passed, including fail-closed target combinations, RDS recovery/security properties, one-task/two-task rolling capacity, one-AZ endpoint placement, encrypted log retention, explicit alarm semantics, Vault Lock and staging compatibility;
- production cost, security, IAM, Config, publication, reconciliation, recovery and cutover validators: 44 passed, 0 failed (42 Node tests plus two TypeScript-aware recovery-assembly tests);
- 13-stack Tier 1 CDK synthesis with `cdk-nag`: succeeded with no error findings;
- two-stack production account-baseline/cost-controls synthesis with `cdk-nag`: succeeded with no error findings;
- synthesized-template audit: 15 templates, seven encrypted log groups, 17 alarms with explicit missing-data handling, three managed WAF groups, one exact-bucket data selector and one governance-locked vault;
- AWS-native provider reachability: 154 entry points / 322 reachable modules, zero static or unapproved dynamic legacy-provider edges and zero unapproved legacy endpoints;
- root and infrastructure TypeScript checks: passed;
- `git diff --check`: passed. CDK emitted only the repository's acknowledged deterministic offline-AZ warnings.
