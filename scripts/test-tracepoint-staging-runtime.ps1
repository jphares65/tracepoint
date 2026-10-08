param(
    [ValidateRange(0,900)][int]$WaitSeconds = 0,
    [ValidateRange(0,60)][int]$PollSeconds = 15
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null

function Test-SettledRuntime {
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
    $states = @((($health -join [Environment]::NewLine) | ConvertFrom-Json).TargetHealthDescriptions.TargetHealth.State | ForEach-Object { [string]$_ })
    Write-Host "Target states: $($states -join ', ')"
    $healthyCount=@($states | Where-Object { $_ -eq 'healthy' }).Count
    $drainingCount=@($states | Where-Object { $_ -eq 'draining' }).Count
    $initialCount=@($states | Where-Object { $_ -eq 'initial' }).Count
    $unexpected=@($states | Where-Object { $_ -notin @('healthy','draining','initial') })
    if($unexpected.Count){throw "ALB has unhealthy or unsupported target state(s): $($unexpected -join ', ')"}
    if($healthyCount -ne 1){throw "Expected exactly one healthy ALB target; observed $healthyCount."}
    if($drainingCount -gt 0 -or $initialCount -gt 0){
        return [pscustomobject]@{NeedsTargetConvergence=$true;DrainingCount=$drainingCount;InitialCount=$initialCount}
    }
}
$logs = & aws.exe logs describe-log-streams --log-group-name /tracepoint/staging/application --order-by LastEventTime --descending --limit 5 --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Unable to query staging log streams.' }
$streamCount = @((($logs -join [Environment]::NewLine) | ConvertFrom-Json).logStreams).Count
Write-Host "Recent CloudWatch log streams returned: $streamCount"

}
$deadline=[DateTimeOffset]::UtcNow.AddSeconds($WaitSeconds)
do {
 $assessment=Test-SettledRuntime
 if(-not $assessment -or -not $assessment.NeedsTargetConvergence){break}
 if([DateTimeOffset]::UtcNow -ge $deadline){throw "ALB target convergence timed out with $($assessment.DrainingCount) draining and $($assessment.InitialCount) initial target(s)."}
 Write-Host 'Waiting for draining/initial ALB targets to converge after the completed rollout.'
 Start-Sleep -Seconds $PollSeconds
} while($true)
