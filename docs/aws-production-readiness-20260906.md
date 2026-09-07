# AWS production-readiness continuation

Status: **technical preparation advanced; production account and cutover remain
unauthorized/unavailable**. Weighted readiness remains **66.50%**. This work
does not repeat or re-credit staging acceptance and does not claim production
capacity, backup/PITR, account authorization, deployment, certificate, DNS or
traffic completion.

## Completed safely

The production assembly now contains seven termination-protected stacks:
network, security, compute, image build, runtime, enforced request controls and
encrypted alert delivery. It retains production Supabase database/auth/storage
and Brevo; Cognito and SES remain disabled. Production adds two-to-four ECS
capacity, enhanced Container Insights, CPU and p99 latency alarms, ALB and build
source access logs, encrypted CodeBuild artifacts, WAF redaction/enforcement,
and an encrypted SNS-to-SQS receipt/DLQ path. A human alert subscription is
deliberately absent until an on-call owner approves and confirms it.

Strict offline synthesis passed for all seven stacks with AWS Solutions Checks
and zero unsuppressed findings. Suppressions are resource-specific and explain
only service-required ECR/log-stream/KMS wildcard suffixes, exact public ALB
listener ingress behind WAF, non-secret ECS provider selectors, terminal log
buckets, and vendor-coordinated secret rotation. The recovery validator proves
retained immutable hosting rollback artifacts and explicitly reports production
PITR as false.

The production secret schema contains names/constraints only. Tracked secret
inventory contains one value-free environment example and the value-free
staging/production schemas, no PEM files and no credential instance. Production
publication still validates the exact eight keys, rejects staging/provider
cross-contamination, uses tracked-only source and requires a completed zero-
finding ECR scan before returning an immutable digest.

A bounded live test reused the staging acceptance concurrency helper: 200
health requests at concurrency 8 passed at 233 ms p95; 20 invalid-auth requests
returned no protected data at 73 ms p95; 20 post-failure health requests passed
at 41 ms p95; HTTP redirected to HTTPS. This validates production-equivalent
edge behavior against non-production. It does not validate production account
capacity, autoscaling or provider quotas, so the corresponding weighted check
remains incomplete.

## Certificate and DNS readiness

The production certificate must be requested in the dedicated production
account in `us-east-1`, use DNS validation, cover `tracepointhq.com`, reach
`ISSUED`, have an approved key algorithm, and be referenced by the reviewed
target ARN. Capture the ACM-generated validation CNAME before any DNS action.
Certificate-validation records and the later apex ALIAS/traffic change are
separate change classes: neither was created here. Before cutover, verify TLS
externally, certificate chain/hostname/expiry, HTTP redirect, headers and WAF;
the production ALB alias requires its own explicit traffic authorization.

## Operational state

The production composite alarm observes application 5xx, memory, ALB 5xx rate,
unhealthy targets, request flood, CPU and p99 latency. Queues are encrypted,
TLS-only, retained for 14 days and include a DLQ. Still required live: named
human/on-call subscription and alarm-delivery test, production log/queue/zero-
alarm baseline, centrally owned CloudTrail/Config/GuardDuty/Security Hub, and
production rollback. The two historical staging unclassified events remain a
historical log-classification issue; this work neither exposed nor reclassified
sensitive text.

The deterministic production planning model is $99.23/month baseline and
$124.55/month at four continuously running tasks. It includes conservative
allowances for enhanced Container Insights, WAF, logs and account security
services but excludes Supabase/Brevo and is not a measured bill or approved
budget. A production owner must approve a ceiling and create budget/anomaly
alerts in the dedicated account.

## Remaining blockers by authority

- Technical: production-account diff/change set, actual immutable production
  image/scan, production provider probes, production deploy/health/load/quota
  test, production rollback, isolated Supabase database and object recovery,
  production log/alarm/queue baseline, and secret rotation/revocation rehearsal.
- Account/permission: determine the dedicated production account through an
  authorized Organizations inventory; validate its region/SCPs/security
  services; obtain the exact production role; bootstrap CDK; prepare/request
  the production ACM certificate; configure measured cost evidence.
- Agency/business approval: account owner and payer, effective guardrails,
  data classification/control review, recovery RPO/RTO, cost ceiling, named
  on-call recipient, pilot/cutover window and rollback owner.
- DNS/traffic authorization: ACM validation record if not already delegated,
  production apex ALIAS/traffic change, external acceptance and DNS rollback.

Machine evidence is in `aws-production-readiness-evidence-20260906.json`; the
account path, recovery requirements and cost model are documented separately.
