[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}-aws-native-staging$')][string]$ImageTag,
    [Parameter(Mandatory)][string]$CertificateArn,
    [switch]$IncludeReviewedNativeNotificationMode,
    [switch]$AllowKnownStagingLoginDiagnostic,
    [ValidateSet('bridge','cognito')][string]$AuthenticationProvider = 'cognito',
    [ValidateSet('s3')][string]$StorageProvider = 's3'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
# Use disposable staging fixtures instead of stored acceptance passwords.
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Assert-TracePointStagingIdentity | Out-Null
Assert-TracePointStagingDatabaseReleaseLease | Out-Null
# The recovery lane advanced from 8599a3b via abb60e2b to 3b12302 without adding
# mobile routes. The exception remains bound to this exact running recovery digest.
# Keep this exception pinned to the exact deployed recovery digest, rather than
# treating any old image or any 404 as acceptable.
$knownDiagnosticRecoveryDigest = 'sha256:cd1ccf7cd76a4e2a666e03609501a8096937536e56a53f45580d3fcef6ab1a53'

function Assert-KnownDiagnosticRecoveryBaseline {
    # The only baseline exception is tied to the exact fail-closed recovery image.
    # It is never a general allowance for a missing mobile route.
    $taskArn = & aws.exe ecs list-tasks --cluster tracepoint-staging --service-name tracepoint-staging --desired-status RUNNING --region us-east-1 --query 'taskArns[0]' --output text
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($taskArn) -or $taskArn -eq 'None') { throw 'Known diagnostic recovery task is unavailable.' }
    $taskText = & aws.exe ecs describe-tasks --cluster tracepoint-staging --tasks $taskArn --region us-east-1 --output json
    if ($LASTEXITCODE -ne 0) { throw 'Known diagnostic recovery task cannot be described.' }
    $task = ($taskText | ConvertFrom-Json).tasks | Select-Object -First 1
    $digest = [string]($task.containers | Select-Object -First 1).imageDigest
    if ($digest -ne $knownDiagnosticRecoveryDigest) { throw 'Diagnostic baseline is not the approved recovery image.' }
    Write-Host 'Verified exact fail-closed recovery baseline for the one-shot diagnostic.'
}
function Invoke-StagingNodeGate {
    param([string[]]$Arguments)
    # Native stderr under Windows PowerShell must not interrupt the child before
    # its finally block removes disposable fixtures. Gate on its final exit code.
    $previousPreference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; & node @Arguments; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$previousPreference }
    if($code -ne 0){throw 'Staging Node gate failed after child cleanup completed.'}
}
if ($AuthenticationProvider -eq 'bridge') {
    Invoke-StagingNodeGate -Arguments @('--import','tsx',(Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs'),'--execute','--fixtures-only')
} else {
    $nativeArguments=@((Join-Path $PSScriptRoot 'test-staging-native-login.mjs'))
    if($AllowKnownStagingLoginDiagnostic){
        Assert-KnownDiagnosticRecoveryBaseline
        $nativeArguments+='--allow-known-diagnostic-rejection'
        $nativeArguments+='--allow-known-diagnostic-baseline-mobile-404'
    }
    Invoke-StagingNodeGate -Arguments $nativeArguments
}
$previous = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
if ($LASTEXITCODE -ne 0 -or $previous -notmatch '^arn:aws:ecs:us-east-1:559054714699:task-definition/') { throw 'A previous task revision is required for automatic rollback.' }
# A preceding rolling replacement can leave a deregistering target behind even
# after ECS reports a completed rollout. Start a fresh bounded convergence window
# for this pre-deploy baseline rather than treating that normal state as an
# immediate failure.
& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
try {
    & (Join-Path $PSScriptRoot 'deploy-tracepoint-staging.ps1') -Action DeployRuntime -ImageTag $ImageTag -CertificateArn $CertificateArn -StorageProvider $StorageProvider -IncludeReviewedNativeNotificationMode:$IncludeReviewedNativeNotificationMode
    & aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
    if ($LASTEXITCODE -ne 0) { throw 'ECS failed to stabilize.' }
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
    if ($AuthenticationProvider -eq 'bridge') {
        Invoke-StagingNodeGate -Arguments @('--import','tsx',(Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs'),'--execute','--range-documents','--extended-workflows')
        Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'test-staging-brevo-delivery.mjs'),'--send-to-account-owner')
    } else {
        if ($AllowKnownStagingLoginDiagnostic) {
            # The exception ends once the candidate is serving: mobile bearer routes
            # must exist and reject invalid credentials before diagnostic capture.
            Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'test-staging-native-login.mjs'),'--verify-mobile-bearer-only')
            Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'test-staging-native-login.mjs'),'--allow-known-diagnostic-rejection')
            throw 'One-shot Cognito diagnostic evidence captured; automatic rollback is required.'
        }
        Invoke-StagingNodeGate -Arguments @('--import','tsx',(Join-Path $PSScriptRoot '..\infra\scripts\rehearse-cognito.mts'),'--execute')
    }
    Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'collect-staging-release-evidence.mjs'),'--image',$ImageTag)
} catch {
    $failure = $_
    $current = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
    if ($LASTEXITCODE -ne 0) { throw 'Release failed and current revision cannot be verified. Manual staging recovery is required.' }
    if ($current -ne $previous) { & (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $previous -Execute }
    throw $failure
}
