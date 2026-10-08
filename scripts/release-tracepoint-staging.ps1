[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}-aws-native-staging$')][string]$ImageTag,
    [Parameter(Mandatory)][string]$CertificateArn,
    [switch]$IncludeReviewedNativeNotificationMode,
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
$script:ReleasePhase = 'baseline-health'
function Set-ReleasePhase([string]$Phase) { $script:ReleasePhase=$Phase; Write-Host "RELEASE_PHASE=$Phase" }
function Write-ReleaseFailure([System.Management.Automation.ErrorRecord]$Failure) {
    $reason=($Failure.Exception.Message -replace '[\r\n]+',' ')
    Write-Host "FAILED_PHASE=$script:ReleasePhase"
    Write-Host "FAILED_ASSERTION=$reason"
    if ($env:GITHUB_STEP_SUMMARY) { "## Staging release failure`n`nFAILED_PHASE=$script:ReleasePhase`n`nFAILED_ASSERTION=$reason" | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY }
}
function Invoke-StagingNodeGate {
    param([string[]]$Arguments,[string]$Phase)
    Set-ReleasePhase $Phase
    # Native stderr under Windows PowerShell must not interrupt the child before
    # its finally block removes disposable fixtures. Gate on its final exit code.
    $previousPreference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; & node @Arguments; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$previousPreference }
    if($code -ne 0){throw "Node gate exited $code after child cleanup completed."}
}
if ($AuthenticationProvider -eq 'bridge') {
    Invoke-StagingNodeGate -Arguments @('--import','tsx',(Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs'),'--execute','--fixtures-only')
} else {
    Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'test-staging-native-login.mjs')) -Phase 'cognito-preflight'
}
$previous = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
if ($LASTEXITCODE -ne 0 -or $previous -notmatch '^arn:aws:ecs:us-east-1:559054714699:task-definition/') { throw 'A previous task revision is required for automatic rollback.' }
# A preceding rolling replacement can leave a deregistering target behind even
# after ECS reports a completed rollout. Start a fresh bounded convergence window
# for this pre-deploy baseline rather than treating that normal state as an
# immediate failure.
Set-ReleasePhase 'baseline-health'
& (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
try {
    Set-ReleasePhase 'template-preflight'
    & (Join-Path $PSScriptRoot 'deploy-tracepoint-staging.ps1') -Action DeployRuntime -ImageTag $ImageTag -CertificateArn $CertificateArn -StorageProvider $StorageProvider -IncludeReviewedNativeNotificationMode:$IncludeReviewedNativeNotificationMode
    Set-ReleasePhase 'ecs-rollout'
    & aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
    if ($LASTEXITCODE -ne 0) { throw 'ECS failed to stabilize.' }
    Set-ReleasePhase 'alb-convergence'
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
    if ($AuthenticationProvider -eq 'bridge') {
        Invoke-StagingNodeGate -Arguments @('--import','tsx',(Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs'),'--execute','--range-documents','--extended-workflows')
        Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'test-staging-brevo-delivery.mjs'),'--send-to-account-owner')
    } else {
        Invoke-StagingNodeGate -Arguments @('--import','tsx',(Join-Path $PSScriptRoot '..\infra\scripts\rehearse-cognito.mts'),'--execute') -Phase 'authenticated-smoke'
    }
    Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'collect-staging-release-evidence.mjs'),'--image',$ImageTag)
} catch {
    $failure = $_
    Write-ReleaseFailure $failure
    Set-ReleasePhase 'recovery'
    $current = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
    if ($LASTEXITCODE -ne 0) { throw 'Release failed and current revision cannot be verified. Manual staging recovery is required.' }
    if ($current -ne $previous) { & (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $previous -Execute }
    throw $failure
}
