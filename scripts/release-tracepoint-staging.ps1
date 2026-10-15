[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}-aws-native-staging$')][string]$ImageTag,
    [Parameter(Mandatory)][string]$CertificateArn,
    [ValidateSet('s3')][string]$StorageProvider = 's3',
    [string]$ResultPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Force
# Use disposable staging fixtures instead of stored acceptance passwords.
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ([string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ID)) {
    $script:ReleaseRunId = 'local-' + [guid]::NewGuid().ToString('N')
} else {
    $attempt = if ([string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ATTEMPT)) { '1' } else { $env:GITHUB_RUN_ATTEMPT }
    $script:ReleaseRunId = $env:GITHUB_RUN_ID + '-' + $attempt
}
if ([string]::IsNullOrWhiteSpace($ResultPath)) {
    $resultRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) { [IO.Path]::GetTempPath() } else { $env:RUNNER_TEMP }
    $ResultPath = Join-Path $resultRoot ('tracepoint-staging-release-' + $script:ReleaseRunId + '.json')
}
$script:ReleasePhase = 'identity'
$script:FirstReleaseFailure = $null
$script:RollbackOutcome = 'not_needed'
$script:RollbackFailure = $null
$script:ReleaseChangedTask = $false
$script:FailureAssertion = @{
    identity = 'STAGING_IDENTITY_GATE_FAILED'
    fixtures = 'DISPOSABLE_FIXTURE_GATE_FAILED'
    prior_revision = 'PRIOR_TASK_REVISION_UNAVAILABLE'
    baseline_health = 'BASELINE_RUNTIME_GATE_FAILED'
    deploy = 'STAGING_DEPLOYMENT_FAILED'
    stabilization = 'ECS_STABILITY_GATE_FAILED'
    runtime_health = 'POST_DEPLOY_RUNTIME_GATE_FAILED'
    acceptance = 'DISPOSABLE_ACCEPTANCE_GATE_FAILED'
    brevo = 'BREVO_DELIVERY_GATE_FAILED'
    evidence = 'RELEASE_EVIDENCE_GATE_FAILED'
    rollback = 'AUTOMATIC_ROLLBACK_FAILED'
}
function Write-ReleaseResult {
    $outcome = if ($null -eq $script:FirstReleaseFailure) { 'succeeded' } else { 'failed' }
    $result = [ordered]@{
        schemaVersion = 1
        runId = $script:ReleaseRunId
        outcome = $outcome
        phase = if ($outcome -eq 'succeeded') { 'complete' } else { 'failed' }
        imageTag = $ImageTag
        failure = $script:FirstReleaseFailure
        rollback = [ordered]@{ outcome = $script:RollbackOutcome; failure = $script:RollbackFailure }
    }
    $fullPath = [IO.Path]::GetFullPath($ResultPath)
    $parent = Split-Path -Parent $fullPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    [IO.File]::WriteAllText($fullPath, ($result | ConvertTo-Json -Depth 5) + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
    $summaryPath = $env:GITHUB_STEP_SUMMARY
    if (-not [string]::IsNullOrWhiteSpace($summaryPath)) {
        $summary = @('## Staging release result', '', ('- Run: `' + $script:ReleaseRunId + '`'), ('- Outcome: **' + $outcome + '**'), ('- Rollback: **' + $script:RollbackOutcome + '**'))
        if ($script:FirstReleaseFailure) { $summary += ('- First failure: `' + $script:FirstReleaseFailure.phase + '` / `' + $script:FirstReleaseFailure.assertion + '`') }
        [IO.File]::AppendAllText($summaryPath, ($summary -join [Environment]::NewLine) + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
    }
    Write-Output ('STAGING_RELEASE_RESULT=' + ($result | ConvertTo-Json -Compress -Depth 5))
}
function Invoke-StagingNodeGate {
    param([string[]]$Arguments, [string]$Phase)
    # Native stderr under Windows PowerShell must not interrupt the child before
    # its finally block removes disposable fixtures. Gate on its final exit code.
    $previousPreference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $childOutput = @(& node @Arguments 2>&1); $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$previousPreference }
    if($code -ne 0){
        $assertion = $script:FailureAssertion[$Phase]
        foreach ($line in $childOutput) {
            try {
                $payload = (($line | Out-String).Trim()) | ConvertFrom-Json -ErrorAction Stop
                if ($Phase -eq 'acceptance' -and $payload.acceptanceHarness -eq 'failed' -and $payload.stage -match '^(fixture-setup|authenticated-acceptance|browser-recovery|custody-evidence|document-evidence)$') { $assertion = 'ACCEPTANCE_' + $payload.stage.ToUpperInvariant().Replace('-', '_') + '_FAILED'; break }
                if ($Phase -eq 'brevo' -and $payload.brevoDelivery -eq 'failed' -and $payload.stage -match '^(identity|secret|task-configuration|account-metadata|sender-metadata|submission|delivery-events)$') { $assertion = 'BREVO_' + $payload.stage.ToUpperInvariant().Replace('-', '_') + '_FAILED'; break }
            } catch { }
        }
        $script:FailureAssertion[$Phase] = $assertion
        throw 'Staging Node gate failed after child cleanup completed.'
    }
}

$previous = $null
$releaseException = $null
try {
    $script:ReleasePhase = 'identity'
    Assert-TracePointStagingIdentity | Out-Null
    $script:ReleasePhase = 'fixtures'
    Invoke-StagingNodeGate -Phase 'fixtures' -Arguments @('--import','tsx',(Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs'),'--execute','--fixtures-only')
    $script:ReleasePhase = 'prior_revision'
    $previous = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
    if ($LASTEXITCODE -ne 0 -or $previous -notmatch '^arn:aws:ecs:us-east-1:559054714699:task-definition/') { throw 'A previous task revision is required for automatic rollback.' }
    $script:RollbackOutcome = 'not_needed'
    $script:ReleasePhase = 'baseline_health'
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
    $script:ReleasePhase = 'deploy'
    $script:ReleaseChangedTask = $true
    & (Join-Path $PSScriptRoot 'deploy-tracepoint-staging.ps1') -Action DeployRuntime -ImageTag $ImageTag -CertificateArn $CertificateArn -StorageProvider $StorageProvider
    $script:ReleasePhase = 'stabilization'
    & aws.exe ecs wait services-stable --cluster tracepoint-staging --services tracepoint-staging --region us-east-1
    if ($LASTEXITCODE -ne 0) { throw 'ECS failed to stabilize.' }
    $script:ReleasePhase = 'runtime_health'
    & (Join-Path $PSScriptRoot 'test-tracepoint-staging-runtime.ps1') -WaitSeconds 900
    $script:ReleasePhase = 'acceptance'
    Invoke-StagingNodeGate -Phase 'acceptance' -Arguments @('--import','tsx',(Join-Path $PSScriptRoot 'run-disposable-staging-acceptance.mjs'),'--execute','--range-documents','--extended-workflows')
    $script:ReleasePhase = 'brevo'
    Invoke-StagingNodeGate -Phase 'brevo' -Arguments @((Join-Path $PSScriptRoot 'test-staging-brevo-delivery.mjs'),'--send-to-account-owner')
    $script:ReleasePhase = 'evidence'
    Invoke-StagingNodeGate -Phase 'evidence' -Arguments @((Join-Path $PSScriptRoot 'collect-staging-release-evidence.mjs'),'--image',$ImageTag)
} catch {
    $releaseException = $_
    if ($null -eq $script:FirstReleaseFailure) {
        $assertion = $script:FailureAssertion[$script:ReleasePhase]
        $script:FirstReleaseFailure = [ordered]@{ phase = $script:ReleasePhase; assertion = $assertion }
    }
    if ($script:ReleaseChangedTask -and $null -ne $previous) {
        try {
            $current = & aws.exe ecs describe-services --cluster tracepoint-staging --services tracepoint-staging --region us-east-1 --query 'services[0].taskDefinition' --output text
            if ($LASTEXITCODE -ne 0) { throw 'Could not verify deployed revision.' }
            if ($current -ne $previous) {
                $script:RollbackOutcome = 'attempted'
                & (Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1') -TaskDefinitionArn $previous -Execute
                $script:RollbackOutcome = 'succeeded'
            } else { $script:RollbackOutcome = 'not_needed' }
        } catch {
            $script:RollbackOutcome = 'failed'
            $script:RollbackFailure = 'AUTOMATIC_ROLLBACK_OR_REVISION_VERIFICATION_FAILED'
        }
    }
} finally {
    Write-ReleaseResult
}
if ($null -ne $releaseException) { throw 'Staging release failed; see the run-scoped result artifact for the sanitized first failure and rollback outcome.' }
