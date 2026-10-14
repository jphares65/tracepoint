# TracePoint application release runbook

This is the application-only release path. It uses existing AWS resources and does not run CDK, CloudFormation, IAM, networking, WAF, DNS, Cognito, SES, RDS configuration, backup, or secret-architecture operations.

## Live targets

| Environment | AWS account | Region | ECS cluster/service | ECR repository | Health endpoint |
| --- | --- | --- | --- | --- | --- |
| Staging | `559054714699` | `us-east-1` | `tracepoint-staging` / `tracepoint-staging` | `tracepoint-staging` | `https://staging.tracepointhq.com/api/health` |
| Production | `193644343389` | `us-east-1` | `tracepoint-production` / `tracepoint-production` | `tracepoint-production` | `https://tracepointhq.com/api/health` |

The required SSO roles are `TracePointMigrationStaging` and `TracePointMigrationProduction`. The scripts reject an account, region, or role mismatch before any release action.

## Staging application release

For the controlled entitlement release, use the reviewed application commit while running the reviewed release-tooling commit from its clean descendant checkout. The consolidated script builds and verifies the exact application image, requires the contiguous 001–041 ledger with exactly migration 042 pending, prompts before database mutation, checks the post-migration ledger, then prompts before changing the application service:

```powershell
$toolingCommit = (git rev-parse HEAD).Trim()
.\scripts\release-entitlements-staging.ps1 -ToolingCommit $toolingCommit -ApplicationCommit '353933a6b98ad7e6c3ac082b786c6a8c7b7aedb8'
```

`deploy-app.ps1` runs reliable local application checks before ECS changes, builds and scan-checks a SHA-tagged ECR image, registers a task revision copied from the current application definition with only that image changed, and updates only the application ECS service. It then requires ECS steady state, expected desired/running/pending counts, healthy non-draining ALB targets, a `200` TracePoint health response, and exact running image digest before declaring success. Deployment-safe remote smoke failures roll back to the preceding healthy task revision.

Post-deployment workstation/sandbox diagnostics are reported as `DEPLOYMENT SUCCEEDED WITH LOCAL VALIDATION WARNING`; they cannot roll back a release that passed deployment-authoritative evidence. A concrete HTTP failure from the deployed service remains a deployment failure and rolls back.

## Database lane

The staging application image tag is `<application-sha>-aws-native-staging`. `migrate-db.ps1` requires that exact tag, a clean completed scan, and the same pinned application image digest through status and apply. The separate migration runner is built from the reviewed release-tooling HEAD, pinned by its immutable migration tag and digest, and records the reviewed application SHA in the ledger. Its one-off ECS task receives the existing RDS secret and CA only through its copied task definition. The task returns a machine-readable report through its configured CloudWatch log stream; missing logs, malformed JSON, version gaps, filename/hash drift, duplicate migration versions, or an unrecognized migration set stop the release. The migration source preserves the original Agency Documents lineage at versions 038–041; module catalog and agency entitlement provisioning is the additive migration 042. Before apply, status must account for migrations 001–041 with exactly `042_default_module_entitlements.sql` pending. The runner repeats that check under its PostgreSQL advisory lock, applies only 042 in its own transaction, and verifies an empty pending set afterward. `baseline` remains staging-only.

`scripts/release-entitlements-staging.ps1` is the consolidated interactive migration-first release procedure. It checks the staging account and role, clean reviewed commits, TypeScript and AWS-native boundaries, current ECS/ALB/health state, RDS PITR freshness, exact pending migration, and the built image digest. It requires typed confirmation before applying migration 042 and again before changing the application ECS service. If migration execution or its report fails, application deployment is skipped. A committed additive migration is never reversed automatically.

Production status is supported, but production migration application is deliberately rejected by the wrapper pending separate production release authorization.

## Golden Path smoke

`smoke-staging.ps1` runs the existing disposable staging harness. It establishes an authenticated session using generated test identities and exercises dashboard/API, firearms, equipment/custody, fleet, range/training, and settings workflows. The harness uses only generated `acceptance-<UUID>` tenants/users, verifies audit/custody evidence, and removes its exact generated fixtures before success.

## Rollback

The deploy command prints the prior healthy revision. To use it later:

```powershell
.\scripts\deploy-app.ps1 staging -RollbackTaskDefinitionArn arn:aws:ecs:us-east-1:559054714699:task-definition/<family>:<previous-revision>
```

The rollback validates that the revision is an older active revision of the same application family and reruns ECS, ALB, digest, and health checks.

## Production promotion

Do not rebuild a different source commit for production. Promotion is tied to the reviewed source SHA and its staging validation evidence. The current architecture deliberately compiles environment-specific public values into separate staging and production images, in separate ECR repositories; therefore a staging image digest cannot safely be deployed verbatim to production. A true cross-account, same-digest promotion would require an approved architecture/security change to make runtime configuration artifact-neutral. Until then, production uses the same reviewed SHA with the existing production build project and separately validates its production digest; no production deployment is authorized by this runbook.
