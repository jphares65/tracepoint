# Application-only deployment workflow

This is the canonical deployment path for a reviewed TracePoint application commit. It uses the existing AWS-native ECS services and does not synthesize, diff, or deploy CDK/CloudFormation.

| Environment | AWS account | Region | ECS cluster / service | ECR repository | Public health endpoint |
| --- | --- | --- | --- | --- | --- |
| Staging | `559054714699` | `us-east-1` | `tracepoint-staging` / `tracepoint-staging` | `tracepoint-staging` | `https://staging.tracepointhq.com/api/health` |
| Production | `193644343389` | `us-east-1` | `tracepoint-production` / `tracepoint-production` | `tracepoint-production` | `https://tracepointhq.com/api/health` |

These values were read from the existing repository deployment configuration and the live ECS identities/services on 2026-09-30. Staging uses the `tracepoint-member-staging` profile and `TracePointMigrationStaging` role; production uses `tracepoint-production` and `TracePointMigrationProduction`.

## Deploy

From a clean, reviewed checkout:

```powershell
.\scripts\deploy-app.ps1 -Environment staging
.\scripts\deploy-app.ps1 -Environment production
```

The script validates the account, region, and expected assumed role before it reads or changes deployment state. It archives the reviewed Git SHA, runs the existing environment-specific CodeBuild image build, tags the immutable ECR image with that SHA (production retains its existing `-aws-native-production` suffix), waits for a clean ECR scan, and copies the live application task-definition pattern while changing only the `tracepoint` container image to the matching immutable digest. It then calls `ecs update-service` only for the existing application service.

Before ECS changes, the script runs account, source-state, and required local application validation. A failure there stops the workflow before it registers or deploys an application revision.

After ECS changes, rollback-authoritative checks are limited to evidence about the deployment: ECS steady state and task counts, active (non-draining) ALB target health, public `/api/health`, the running task-definition/image digest, and deployment-safe remote smoke requests. ALB targets in `draining` state are expected during deregistration and do not invalidate an otherwise healthy new release.

The existing staging HTTP smoke suite runs afterward as a post-deployment diagnostic. A local Node, sandbox, dependency, or workstation-network failure produces `DEPLOYMENT SUCCEEDED WITH LOCAL VALIDATION WARNING`; it cannot roll back a release that passed the AWS and remote checks.

If a prior run built the same immutable SHA image but stopped before the ECS update, rerun the command. The script verifies and reuses that exact scan-clean image rather than trying to overwrite its ECR tag.

No IAM, CDK/CloudFormation, WAF, Route 53, Cognito, SES, RDS, backup, network, secret-architecture, or other infrastructure operation is included.

## Rollback

On a post-update failure, the script automatically restores the task revision that was healthy immediately before the deployment. It prints the exact manual rollback command on success. To roll back later, use that recorded revision:

```powershell
.\scripts\deploy-app.ps1 -Environment staging -RollbackTaskDefinitionArn arn:aws:ecs:us-east-1:559054714699:task-definition/<family>:<previous-revision>
```

The rollback path accepts only an older active revision of the same live application task family, verifies its ECR image, updates only the ECS application service, and runs the same steady-state, ALB, release-digest, and health checks.
