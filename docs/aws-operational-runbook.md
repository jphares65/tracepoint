# AWS operational runbook

## Signals

Monitor ALB healthy targets/5xx/latency/rejected connections, ECS desired vs
running tasks/restarts/deployment failures, application error rate and health,
log-delivery failures, ECR findings, secret age, external Supabase/Brevo latency,
database connections/CPU/storage/replica lag after migration, queue age/failures,
and security-baseline findings. Alarm only when an owner and response exist.

## Triage

1. Declare incident/correlation ID; record environment/account/region without
   copying secrets or sensitive payloads.
2. Check deployment/image change, ALB target health, task events/logs and provider
   health. Preserve evidence and CloudTrail references.
3. Contain with reversible controls: stop rollout, route canary back, revoke a
   compromised identity/secret through approved responders. Do not delete data.
4. Escalate tenant-isolation, credential, audit or public-safety data events to
   security/data owners immediately; follow breach/legal procedures.
5. Recover using immutable prior image/config or tested database/provider
   rollback. Validate health, authorization and audit before reopening.
6. Document timeline/root cause/corrective controls and retain evidence per policy.

## Routine operations

Weekly: failed deployments, alarms, vulnerabilities, stale access and cost/tag
exceptions. Monthly: restore sample, secret/role review, dependency/base-image
updates and quota/cost forecast. Quarterly: incident/tabletop, tenant-boundary
suite, backup restore, access recertification and runbook contact verification.

## Staging deployment procedure (future only)

Confirm member account via STS, real synth, secret-free scan, image digest/scan,
and reviewed `cdk diff`; approve change set; deploy foundation before runtime;
verify HTTPS/health/logs/tenant negatives; record evidence. This document does
not authorize bootstrap, deployment, DNS, certificate, secret or billing action.
