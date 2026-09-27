param()

$ErrorActionPreference = 'Stop'
$profileName = 'tracepoint-production'
$awsRegion = 'us-east-1'
$clusterName = 'tracepoint-production'
$serviceName = 'tracepoint-production-phase3c-rehearsal-app'
$expectedTask = 'arn:aws:ecs:us-east-1:193644343389:task-definition/tracepoint-production-phase3c-rehearsal-app:23'
$targetGroup = 'arn:aws:elasticloadbalancing:us-east-1:193644343389:targetgroup/tracep-Targe-7OUSA2XRQM5A/bd67f4134e0c93f4'

function Invoke-Aws {
    param([string[]] $Arguments)
    $result = & aws @Arguments --profile $profileName --region $awsRegion
    if ($LASTEXITCODE -ne 0) { throw "AWS_COMMAND_FAILED:$($Arguments[0]):$($Arguments[1])" }
    return $result
}

function Get-RehearsalService {
    $json = Invoke-Aws -Arguments @('ecs', 'describe-services', '--cluster', $clusterName,
        '--services', $serviceName, '--query', 'services[0]', '--output', 'json')
    return ($json | Out-String | ConvertFrom-Json)
}

$account = Invoke-Aws -Arguments @('sts', 'get-caller-identity', '--query', 'Account', '--output', 'text')
if ($account.Trim() -ne '193644343389') { throw 'AWS_ACCOUNT_MISMATCH' }
$before = Get-RehearsalService
if ($before.serviceName -ne $serviceName -or $before.status -ne 'ACTIVE' -or
    $before.taskDefinition -ne $expectedTask -or $before.desiredCount -ne 1 -or
    $before.runningCount -ne 1 -or $before.pendingCount -ne 0 -or
    $before.loadBalancers.Count -ne 1 -or
    $before.loadBalancers[0].targetGroupArn -ne $targetGroup -or
    $before.deployments.Count -ne 1 -or
    $before.deployments[0].rolloutState -ne 'COMPLETED') {
    throw 'REHEARSAL_SERVICE_BASELINE_MISMATCH'
}

$restoreNeeded = $true
try {
    Invoke-Aws -Arguments @('ecs', 'update-service', '--cluster', $clusterName,
        '--service', $serviceName, '--desired-count', '0', '--query',
        'service.desiredCount', '--output', 'text') | Out-Null
    Invoke-Aws -Arguments @('ecs', 'wait', 'services-stable', '--cluster', $clusterName,
        '--services', $serviceName) | Out-Null
    $down = Get-RehearsalService
    if ($down.desiredCount -ne 0 -or $down.runningCount -ne 0 -or
        $down.pendingCount -ne 0) { throw 'REHEARSAL_WRITER_DID_NOT_STOP' }
}
finally {
    if ($restoreNeeded) {
        Invoke-Aws -Arguments @('ecs', 'update-service', '--cluster', $clusterName,
            '--service', $serviceName, '--desired-count', '1', '--query',
            'service.desiredCount', '--output', 'text') | Out-Null
        Invoke-Aws -Arguments @('ecs', 'wait', 'services-stable', '--cluster', $clusterName,
            '--services', $serviceName) | Out-Null
        $after = Get-RehearsalService
        if ($after.desiredCount -ne 1 -or $after.runningCount -ne 1 -or
            $after.pendingCount -ne 0 -or
            $after.deployments[0].rolloutState -ne 'COMPLETED') {
            throw 'REHEARSAL_WRITER_RESTORE_FAILED'
        }
        $healthJson = Invoke-Aws -Arguments @('elbv2', 'describe-target-health',
            '--target-group-arn', $targetGroup, '--query',
            'TargetHealthDescriptions[].TargetHealth.State', '--output', 'json')
        $health = @($healthJson | Out-String | ConvertFrom-Json)
        if (@($health | Where-Object { $_ -eq 'healthy' }).Count -ne 1 -or
            @($health | Where-Object { $_ -ne 'healthy' -and $_ -ne 'draining' }).Count -ne 0) {
            throw 'REHEARSAL_TARGET_HEALTH_NOT_RESTORED'
        }
    }
}

[pscustomobject]@{
    status = 'ISOLATED_ECS_SCALE_INVERSE_REHEARSED'
    account = '193644343389'
    service = $serviceName
    originalDesired = 1
    stoppedDesired = 0
    stoppedRunning = 0
    restoredDesired = 1
    restoredRunning = 1
    targetHealth = 'healthy'
    publicProductionChanged = $false
    checkedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json -Compress
