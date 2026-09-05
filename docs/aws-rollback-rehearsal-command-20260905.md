# Controlled staging rollback and return

`scripts/rehearse-staging-rollback.ps1` captures the healthy current task ARN and validates its exact immutable image, completed zero-finding scan, alarms, targets and public routes. It validates an older ACTIVE revision using the existing rollback gate. Without `-Execute` it performs no mutation.

With `-Execute`, it rolls back, checks health, and restores the captured current ARN in a finally block even if the older revision fails. A no-op CDK deploy cannot repair this temporary ECS drift because CloudFormation already describes the current revision. The script therefore restores that exact task ARN, waits for stable ECS/ALB, and requires current-image/log/alarm evidence. Restoration failures remain failures. Output includes both durations and final restoration status.

```powershell
./scripts/rehearse-staging-rollback.ps1 -CurrentImageTag FULL_CURRENT_COMMIT -PriorTaskDefinitionArn PRIOR_ACTIVE_STAGING_TASK_ARN -Execute
```

Four offline orchestration cases prove success, baseline denial without mutation, restoration after rollback failure, and surfaced restoration failure. The shared scan gate now requires zero findings at every severity, including LOW/MEDIUM/INFORMATIONAL/UNDEFINED. Nineteen identity/hostname/runtime/scan rejection cases pass without network calls.

Live timing and final image evidence must be recorded separately after execution. This command never changes production DNS, data or infrastructure.

Live rehearsal completed: revision 14 (image 34633a75d23c6edcd7aca364506159624a48ab28, digest sha256:e5f3ce876be51a0f24340ca3efadc236af231811c30d0c4ad7c9c5de2d1fb7ea) rolled back to revision 13 in 428.073 seconds, then returned to revision 14 in 423.733 seconds. Both completed strict ECS/ALB/public checks; final current-task logs had zero matching errors. No image was rebuilt for the rehearsal.
