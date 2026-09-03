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

## Staging deployment procedure

The foundation is deployed. For runtime prerequisites, exact human inputs,
guarded helper scripts, smoke coverage, and rollback constraints, follow
`docs/aws-staging-runtime-readiness.md`. Runtime remains conditional: confirm the
member account via STS, secret-free build, immutable image digest/scan, and a
reviewed `cdk diff`; then verify HTTPS, health, logs, session behavior, and tenant
negatives. The helpers do not request certificates, modify DNS, install Docker,
or copy local environment files.

Start each live session with the metadata-only inventory:

```powershell
.\scripts\get-tracepoint-staging-inventory.ps1 -Profile tracepoint-member-staging
```

It reads no secret values, objects, application logs, database data, or DNS
records. The manual GitHub Actions foundation workflow uses OIDC and the protected
`aws-staging` environment; it synthesizes and diffs with runtime disabled before
deploying only network, security, and compute.
