Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null

$service = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Unable to describe the staging ECS service.' }
$service = (($service -join [Environment]::NewLine) | ConvertFrom-Json).services | Select-Object -First 1
if (-not $service -or $service.status -eq 'INACTIVE') { throw 'The staging runtime service is not deployed.' }
Write-Host "ECS desired/running/pending: $($service.desiredCount)/$($service.runningCount)/$($service.pendingCount)"
if ($service.desiredCount -ne 1 -or $service.runningCount -ne 1 -or $service.pendingCount -ne 0) {
    throw 'Staging must have exactly one desired and running task, with no pending task.'
}
if (@($service.deployments).Count -ne 1 -or $service.deployments[0].rolloutState -ne 'COMPLETED') {
    throw 'ECS rollout is not complete.'
}
Write-Host "Task definition: $($service.taskDefinition)"
if (-not $service.loadBalancers.Count) { throw 'Staging service has no ALB target group.' }
if ($service.loadBalancers.Count) {
    $targetArn = $service.loadBalancers[0].targetGroupArn
    $health = & aws.exe elbv2 describe-target-health --target-group-arn $targetArn --region us-east-1 --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Unable to query staging target health.' }
    $states = @((($health -join [Environment]::NewLine) | ConvertFrom-Json).TargetHealthDescriptions.TargetHealth.State)
    Write-Host "Target states: $($states -join ', ')"
    if ($states.Count -ne 1 -or $states[0] -ne 'healthy') { throw 'Expected exactly one healthy ALB target.' }
}
$logs = & aws.exe logs describe-log-streams --log-group-name /tracepoint/staging/application --order-by LastEventTime --descending --limit 5 --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Unable to query staging log streams.' }
$streamCount = @((($logs -join [Environment]::NewLine) | ConvertFrom-Json).logStreams).Count
Write-Host "Recent CloudWatch log streams returned: $streamCount"
