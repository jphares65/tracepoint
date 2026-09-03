Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
Assert-TracePointStagingIdentity | Out-Null

$service = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Unable to describe the staging ECS service.' }
$service = (($service -join [Environment]::NewLine) | ConvertFrom-Json).services | Select-Object -First 1
if (-not $service -or $service.status -eq 'INACTIVE') { throw 'The staging runtime service is not deployed.' }
Write-Host "ECS desired/running/pending: $($service.desiredCount)/$($service.runningCount)/$($service.pendingCount)"
if ($service.loadBalancers.Count) {
    $targetArn = $service.loadBalancers[0].targetGroupArn
    $health = & aws.exe elbv2 describe-target-health --target-group-arn $targetArn --region us-east-1 --output json 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Unable to query staging target health.' }
    $states = @((($health -join [Environment]::NewLine) | ConvertFrom-Json).TargetHealthDescriptions.TargetHealth.State)
    Write-Host "Target states: $($states -join ', ')"
}
$logs = & aws.exe logs describe-log-streams --log-group-name /tracepoint/staging/application --order-by LastEventTime --descending --limit 5 --region us-east-1 --output json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Unable to query staging log streams.' }
$streamCount = @((($logs -join [Environment]::NewLine) | ConvertFrom-Json).logStreams).Count
Write-Host "Recent CloudWatch log streams returned: $streamCount"
