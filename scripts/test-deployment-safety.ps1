Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:TracePointTestScenario = 'healthy'
$global:TracePointTestAccount = '559054714699'
$global:TracePointTestRole = 'TracePointMigrationStaging'
$global:TracePointTestMutations = 0
$global:TracePointTargetStateSequence = @('healthy')
$global:TracePointTargetStateIndex = 0
function Set-TargetStates([string[]]$Sequence) {
    $global:TracePointTargetStateSequence=$Sequence
    $global:TracePointTargetStateIndex=0
}
function global:Start-Sleep { param([int]$Seconds) }
function global:aws.exe {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    if ($command -match 'update-service|start-build|put-object') { $global:TracePointTestMutations++; throw 'Unexpected mutation in safety test' }
    if ($command -like 'sts get-caller-identity*') { return (@{Account=$global:TracePointTestAccount;Arn="arn:aws:sts::$($global:TracePointTestAccount):assumed-role/$($global:TracePointTestRole)/test"} | ConvertTo-Json -Compress) }
    if ($command -like 'ecs describe-services*') {
        $count = if ($global:TracePointTestScenario -eq 'zero') {0} else {1}
        $rollout = if ($global:TracePointTestScenario -eq 'rolling') {'IN_PROGRESS'} else {'COMPLETED'}
        return (@{services=@(@{status='ACTIVE';desiredCount=1;runningCount=$count;pendingCount=0;taskDefinition='arn:aws:ecs:us-east-1:559054714699:task-definition/tracepoint:7';deployments=@(@{rolloutState=$rollout});loadBalancers=@(@{targetGroupArn='test-target'})})} | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($command -like 'elbv2 describe-target-health*') {
        $index=[Math]::Min($global:TracePointTargetStateIndex,$global:TracePointTargetStateSequence.Count-1)
        $states=@($global:TracePointTargetStateSequence[$index] -split ',')
        $global:TracePointTargetStateIndex++
        return (@{TargetHealthDescriptions=@($states | ForEach-Object {@{TargetHealth=@{State=$_}}})} | ConvertTo-Json -Depth 5 -Compress)
    }
    if ($command -like 'logs describe-log-streams*') {return '{"logStreams":[{}]}'}
    throw 'Unexpected mocked AWS query'
}
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
function Must-Reject([scriptblock]$Action) {
    $rejected=$false
    try { & $Action } catch { $rejected=$true }
    if (-not $rejected) {throw 'Safety gate incorrectly accepted an invalid state'}
}
try {
    Assert-TracePointStagingIdentity | Out-Null
    foreach($account in @('265544358665','111111111111')) {
        $global:TracePointTestAccount=$account
        Must-Reject {Assert-TracePointStagingIdentity | Out-Null}
    }
    $global:TracePointTestAccount='559054714699';$global:TracePointTestRole='UnrelatedRole'
    Must-Reject {Assert-TracePointStagingIdentity | Out-Null}
    $global:TracePointTestRole='TracePointMigrationStaging'
    Must-Reject {Assert-TracePointStagingHostname -Hostname 'tracepointhq.com'}
    Set-TargetStates @('healthy')
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1')
    Set-TargetStates @('healthy,draining','healthy')
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 1 -PollSeconds 0
    foreach($states in @('draining','unhealthy','healthy,unhealthy','','healthy,healthy')) {
        Set-TargetStates @($states)
        Must-Reject {& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1')}
    }
    Set-TargetStates @('healthy,initial')
    Must-Reject {& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1')}
    Set-TargetStates @('healthy,draining')
    Must-Reject {& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1')}
    foreach($scenario in @('zero','rolling','unhealthy')) {
        $global:TracePointTestScenario=$scenario
        Must-Reject {& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1')}
    }
    if($global:TracePointTestMutations -ne 0){throw 'Safety tests attempted mutation'}
    $scan = '{"imageScanStatus":{"status":"COMPLETE"},"imageScanFindings":{"findingSeverityCounts":{}}}' | ConvertFrom-Json
    Assert-TracePointImageScan -Scan $scan
    foreach($state in @('IN_PROGRESS','FAILED','UNSUPPORTED_IMAGE')) {
        $scan.imageScanStatus.status=$state
        Must-Reject {Assert-TracePointImageScan -Scan $scan}
    }
    foreach($severity in @('INFORMATIONAL','LOW','MEDIUM','HIGH','CRITICAL','UNDEFINED')) {
        $scan = ('{"imageScanStatus":{"status":"COMPLETE"},"imageScanFindings":{"findingSeverityCounts":{"'+$severity+'":1}}}') | ConvertFrom-Json
        Must-Reject {Assert-TracePointImageScan -Scan $scan}
    }
    Must-Reject {Assert-TracePointImageScan -Scan ([pscustomobject]@{})}
    Write-Host 'Passed staging identity, runtime, and ALB convergence safety cases; zero AWS API calls.'
} finally {Remove-Item Function:/aws.exe,Function:/Start-Sleep}
