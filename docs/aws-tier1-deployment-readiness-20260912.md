# TracePoint Tier 1 production deployment readiness

**Date:** 2026-09-12

**Scope:** code, tests, synthesized CloudFormation, and documentation only

**Live changes performed:** none

The approved Tier 1 production target is implemented as Single-AZ PostgreSQL
17.9 on `db.t4g.small`, 20 GiB gp3 with a 100 GiB autoscaling maximum, one
0.25-vCPU/0.5-GiB ECS task with maximum two, and the existing ALB, full-AWS
provider boundary, encryption, audit, backup, and rollback controls.

## Finding disposition

| # | Finding | Status | Implementation and offline evidence | Residual deployment risk | Monthly impact |
|---:|---|---|---|---|---:|
| 1 | Production log encryption | CLEARED | Application, image-build, WAF, CloudTrail, VPC Flow Log, SES feedback-worker, RDS PostgreSQL export, database-migration, and identity-migration log groups use customer-managed KMS keys. The shared data-key policy admits the regional Logs service only for the six exact production name patterns. | Deployment must verify each created log group has a KMS key and receives events; CloudWatch log ingestion is not proved offline. | $0 incremental; existing eight-key allowance retained |
| 2 | Alarm missing-data behavior | CLEARED | Every metric alarm now sets `TreatMissingData`. Continuously emitted RDS CPU/connections/storage metrics use `breaching`; sparse WAF, SQS, and Lambda metrics use `notBreaching`. Database connections are bounded at 50 for Tier 1 and 100 for HA layouts. | A planned RDS maintenance event can alert because loss of continuous telemetry is intentionally actionable. | $0 for semantics |
| 3 | AWS Config coverage | CLEARED | The selective continuous recorder expands from 26 to 41 reviewed types, adding Backup, CloudWatch alarms, Cognito, EventBridge, IAM policies, Lambda, RDS, S3 bucket policies, and SES configuration sets. Exact-list validation fails closed on scope drift; the SCP change set denies unauthorized recorder/channel replacement. | The live recorder must be updated and then show `SUCCESS`; AWS Config represents embedded relationship/policy state for resources that have no separately supported Config type. | Included in $15 security-services allowance |
| 4 | Alert topic policies | CLEARED | The EventBridge SNS helper that generated unconditional service-principal grants was removed. CloudWatch and EventBridge may publish only from the exact composite-alarm/rule ARN and account; synth-negative tests inspect every such SNS/KMS statement. Durable SQS receipt remains. | Live publish and delivery still require a post-deploy controlled alarm test. | $0 |
| 5 | WAF managed protections | CLEARED | Production enforces `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesKnownBadInputsRuleSet`, and `AWSManagedRulesAmazonIpReputationList` after the existing IP rate rule. No exclusions or per-rule overrides are configured because no evidence justifies one; sampled requests remain disabled and sensitive fields remain redacted. | Watch managed-rule labels/blocks during pre-traffic smoke testing. Any demonstrated false positive changes only the offending group to count under rollback authority. | +$3.00 |
| 6 | CloudTrail S3 data events | CLEARED | The multi-region trail records read and write object data events only for `tracepoint-production-private-193644343389`, while retaining all management events and log-file validation. | Volume is variable; alarm at the cost threshold if object usage grows materially. | +$0.10 allowance for 100,000 events |
| 7 | Human alert delivery | CLEARED | The production target now requires the exact owner-approved `contact@tracepointhq.com` endpoint; CDK creates its SNS email subscription and the composite includes runtime, database, SES feedback, backup, root, IAM, and security-control alarms. | The mailbox owner must confirm the subscription after deployment, then an explicitly authorized controlled alarm must prove delivery. Unconfirmed status is a cutover no-go. | $0 |
| 8 | Backup Vault Lock | CLEARED | Production uses reversible governance-mode Vault Lock with minimum retention 35 days and maximum 365 days, matching daily/monthly plan lifecycles. Compliance mode is deliberately not enabled. | Adopt compliance mode only after 30 consecutive successful backup days and two restore rehearsals, no earlier than 2026-10-15, with separate owner approval because the resulting lock becomes immutable. | $0 |

## Additional audit alerts

The account baseline derives three one-minute security metrics from the encrypted
CloudTrail log group and exposes alarms named:

- `tracepoint-production-account-root-activity`
- `tracepoint-production-account-privileged-iam-change`
- `tracepoint-production-account-security-control-change`

They are observed by the existing encrypted production composite alert. Missing
matching events are expected, so these event-driven metrics use
`notBreaching`; delivery failure is covered independently by the durable SNS/SQS
path and deployment validation.

## Cost gate

The required security corrections raise the approved proposal by **$4.30/month**:

- three AWS-managed WAF groups: **+$3.00**;
- three CloudTrail custom metrics and alarms: **+$1.20**;
- scoped S3 object data-event allowance: **+$0.10**.

The resulting deterministic projection is **$131.72/month steady**, **$144.38
rolling**, and **$153.58 rolling at 100 GiB RDS storage**. All are below the
approved **$175/month** Budget target. First and second paid KMS rotation steady
states are $139.72 and $147.72; the second-rotation plus rolling plus 100-GiB
case is $169.58.

## Live deployment verification gate

Production deployment remains separately unauthorized. Before traffic cutover,
the operator must inspect the deployed templates/resources and record sanitized
evidence that: every named log group has a KMS key and current events; all alarms
have the intended state/missing-data setting; Config exactly matches the 41-type
definition and reports successful continuous recording; the CloudTrail S3
selector names only the private application bucket; the alert topic/key contain
no unconditional CloudWatch or EventBridge allows; the email subscription is
confirmed; the WAF groups are present; and the backup vault reports governance
lock with 35/365-day bounds. Any mismatch is a no-go and does not earn live
readiness credit.
