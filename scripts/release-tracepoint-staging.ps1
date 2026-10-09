[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}-aws-native-staging$')][string]$ImageTag,
    [Parameter(Mandatory)][string]$CertificateArn,
    [switch]$IncludeReviewedNativeNotificationMode,
    [ValidateSet('bridge','cognito')][string]$AuthenticationProvider = 'cognito',
    [ValidateSet('s3')][string]$StorageProvider = 's3',
    [string]$SummaryPath = $env:GITHUB_STEP_SUMMARY,
    [string]$ResultPath = $(if ($env:RUNNER_TEMP) { Join-Path $env:RUNNER_TEMP 'release-result.json' } else { Join-Path ([IO.Path]::GetTempPath()) 'release-result.json' })
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
$script:ReleaseResult = [ordered]@{candidateSha=$ImageTag.Substring(0,40);phase='baseline-health';status='running';failedPhase=$null;failedAssertion=$null;recoveryAttempted=$false;recoverySucceeded=$false}
if ($SummaryPath) { Set-Content -LiteralPath $SummaryPath -Value '' -NoNewline }
function Write-ReleaseResult { $script:ReleaseResult | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath -NoNewline }
Write-ReleaseResult
function Set-ReleasePhase([string]$Phase) { $script:ReleasePhase=$Phase; Write-Host "RELEASE_PHASE=$Phase" }
function Write-ReleaseFailure([System.Management.Automation.ErrorRecord]$Failure) {
    $reason=($Failure.Exception.Message -replace '[\r\n]+',' ')
    $script:ReleaseResult.phase=$script:ReleasePhase;$script:ReleaseResult.status='failed';$script:ReleaseResult.failedPhase=$script:ReleasePhase;$script:ReleaseResult.failedAssertion=$reason;Write-ReleaseResult
    Write-Host "FAILED_PHASE=$script:ReleasePhase"
    Write-Host "FAILED_ASSERTION=$reason"
    if ($SummaryPath) { "## Staging release failure`n`nFAILED_PHASE=$script:ReleasePhase`n`nFAILED_ASSERTION=$reason" | Add-Content -LiteralPath $SummaryPath }
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
trap {
    if ($script:ReleaseResult.status -ne 'failed') { Write-ReleaseFailure $_ }
    throw
}
if ($AuthenticationProvider -eq 'bridge') {
    Invoke-StagingNodeGate -Arguments @('--import','tsx',(Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs'),'--execute','--fixtures-only')
} else {
    Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'test-staging-native-login.mjs')) -Phase 'cognito-preflight'
}
$previous = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
if ($LASTEXITCODE -ne 0 -or $previous -notmatch '^arn:aws:ecs:us-east-1:559054714699:task-definition/') { throw 'A previous task revision is required for automatic rollback.' }
$previousDefinition = & aws.exe ecs describe-task-definition --task-definition $previous --region us-east-1 --output json
if ($LASTEXITCODE -ne 0) { throw 'The pre-rollout task definition cannot be read for rollback pinning.' }
$previousDefinition = ($previousDefinition -join [Environment]::NewLine) | ConvertFrom-Json
$previousContainers = @($previousDefinition.taskDefinition.containerDefinitions)
if ($previousContainers.Count -ne 1 -or $previousContainers[0].name -ne 'tracepoint') { throw 'The pre-rollout task definition has an unexpected container shape.' }
$previousImage = [string]$previousContainers[0].image
if ($previousImage -notmatch '^559054714699\.dkr\.ecr\.us-east-1\.amazonaws\.com/tracepoint-staging@(?<digest>sha256:[0-9a-f]{64})$') { throw 'The pre-rollout image must be digest-pinned for automatic recovery.' }
$previousImageDigest = $Matches.digest
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
        Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'test-staging-native-login.mjs'),'--post-deploy') -Phase 'mobile-invalid-bearer-postdeploy'
        Invoke-StagingNodeGate -Arguments @('--import','tsx',(Join-Path $PSScriptRoot '..\infra\scripts\rehearse-cognito.mts'),'--execute') -Phase 'authenticated-smoke'
    }
    Invoke-StagingNodeGate -Arguments @((Join-Path $PSScriptRoot 'collect-staging-release-evidence.mjs'),'--image',$ImageTag) -Phase 'evidence-collection'
} catch {
    $failure = $_
    Write-ReleaseFailure $failure
    $script:ReleaseResult.recoveryAttempted=$true;Write-ReleaseResult
    Set-ReleasePhase 'recovery'
    $current = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
    if ($LASTEXITCODE -ne 0) { throw 'Release failed and current revision cannot be verified. Manual staging recovery is required.' }
    if ($current -ne $previous) { & (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $previous -ExpectedImageDigest $previousImageDigest -Execute }
    $script:ReleaseResult.recoverySucceeded=$true;Write-ReleaseResult
    throw $failure
}
$script:ReleaseResult.phase='complete';$script:ReleaseResult.status='success';Write-ReleaseResult
