# TracePoint application release runbook

This is the application-only release path. It uses existing AWS resources and does not run CDK, CloudFormation, IAM, networking, WAF, DNS, Cognito, SES, RDS configuration, backup, or secret-architecture operations.

## Live targets

| Environment | AWS account | Region | ECS cluster/service | ECR repository | Health endpoint |
| --- | --- | --- | --- | --- | --- |
| Staging | `559054714699` | `us-east-1` | `tracepoint-staging` / `tracepoint-staging` | `tracepoint-staging` | `https://staging.tracepointhq.com/api/health` |
| Production | `193644343389` | `us-east-1` | `tracepoint-production` / `tracepoint-production` | `tracepoint-production` | `https://tracepointhq.com/api/health` |

The required SSO roles are `TracePointMigrationStaging` and `TracePointMigrationProduction`. The scripts reject an account, region, or role mismatch before any release action.

## Staging application release

From a clean, reviewed commit:

```powershell
.\scripts\deploy-app.ps1 staging
.\scripts\migrate-db.ps1 staging -Action status
.\scripts\smoke-staging.ps1
```

`deploy-app.ps1` treats workstation checks as optional diagnostics. Its existing CodeBuild project is the authoritative pre-deployment environment: it runs `npm ci` (10 minutes), lint (5 minutes), the application suite (20 minutes), and the migration-runner integrity test (5 minutes) before building and pushing the SHA-tagged image. Any timeout, lint/build failure, or test failure aborts CodeBuild and leaves ECS unchanged. Only after that scan-clean artifact exists does the script register a task revision copied from the current application definition with only that image changed and update the application ECS service. It then requires ECS steady state, expected desired/running/pending counts, healthy non-draining ALB targets, a `200` TracePoint health response, and exact running image digest before declaring success. Deployment-safe remote smoke failures roll back to the preceding healthy task revision.

Post-deployment workstation/sandbox diagnostics are reported as `DEPLOYMENT SUCCEEDED WITH LOCAL VALIDATION WARNING`; their hangs, dependency differences, transport limits, or unexplained exits cannot roll back or block a release that passed CodeBuild and deployment-authoritative evidence. A concrete HTTP failure from the deployed service remains a deployment failure and rolls back.

## Database lane

`migrate-db.ps1 staging -Action status` first verifies the final SHA-tagged application image and its scan, then launches the established one-off ECS migration task from a separate immutable `SHA-aws-native-migration` image built from that same commit. The task receives the existing RDS secret and CA only through its copied live task definition. It validates the `public.tracepoint_aws_schema_migrations` ledger against the numeric, SHA-256 checked files in `database/aws/`; drift stops the task. `-Action apply` runs only pending files, each in its own file-owned transaction with an advisory lock and ledger insertion. `baseline` is staging-only. A successful status with no pending entries is the safe no-op release evidence.

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
