# Controlled staging rollback and return

`scripts/rehearse-staging-rollback.ps1` captures the healthy current task ARN and validates its exact immutable image, completed zero-finding scan, alarms, targets and public routes. It validates an older ACTIVE revision using the existing rollback gate. Without `-Execute` it performs no mutation.

With `-Execute`, it rolls back, checks health, and restores the captured current ARN in a finally block even if the older revision fails. A no-op CDK deploy cannot repair this temporary ECS drift because CloudFormation already describes the current revision. The script therefore restores that exact task ARN, waits for stable ECS/ALB, and requires current-image/log/alarm evidence. Restoration failures remain failures. Output includes both durations and final restoration status.

```powershell
./scripts/rehearse-staging-rollback.ps1 -CurrentImageTag FULL_CURRENT_COMMIT -PriorTaskDefinitionArn PRIOR_ACTIVE_STAGING_TASK_ARN -Execute
```

Four offline orchestration cases prove success, baseline denial without mutation, restoration after rollback failure, and surfaced restoration failure. The shared scan gate now requires zero findings at every severity, including LOW/MEDIUM/INFORMATIONAL/UNDEFINED. Nineteen identity/hostname/runtime/scan rejection cases pass without network calls.

Live timing and final image evidence must be recorded separately after execution. This command never changes production DNS, data or infrastructure.
