Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Staging task definitions pin the application image by digest, so rollback is validated against the digest the
# release captured before rollout (-ExpectedImageDigest), and the running task must serve exactly that digest.
$script:RollbackHelper = Join-Path $PSScriptRoot 'invoke-tracepoint-staging-rollback.ps1'
$script:RollbackTarget = 'arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:9'
$script:RollbackCurrent = 'arn:aws:ecs:us-east-1:559054714699:task-definition/synthetic:10'
$script:RollbackImageDigest = 'sha256:' + ('0' * 64)
$script:RollbackRepository = '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging'
$script:RollbackImage = $script:RollbackRepository + '@' + $script:RollbackImageDigest
$script:RollbackTemp = Join-Path ([IO.Path]::GetTempPath()) ('tracepoint-rollback-helper-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $script:RollbackTemp | Out-Null
$script:RollbackExecutable = Join-Path $script:RollbackTemp 'invoke-tracepoint-staging-rollback.ps1'
Copy-Item -LiteralPath $script:RollbackHelper -Destination $script:RollbackExecutable
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'TracePoint.Staging.psm1') -Destination $script:RollbackTemp
@'
param([int]$WaitSeconds)
$global:RollbackTestRuntimeCalls++
if ($WaitSeconds -ne 600) { throw 'Unexpected mocked health wait.' }
'@ | Set-Content -LiteralPath (Join-Path $script:RollbackTemp 'test-tracepoint-staging-runtime.ps1')
$global:RollbackTestScenario = 'read_only'
$global:RollbackTestTarget = $script:RollbackTarget
$global:RollbackTestCurrent = $script:RollbackCurrent
$global:RollbackTestRepository = $script:RollbackRepository
$global:RollbackTestImageDigest = $script:RollbackImageDigest
$global:RollbackTestServiceReads = 0
$global:RollbackTestRuntimeCalls = 0
$global:RollbackTestUpdated = $false
$global:RollbackTestImage = ''
$global:RollbackTestScanDigests = @()
$global:RollbackTestCalls = @()
function global:aws.exe {
    $global:LASTEXITCODE = 0
    $command = $args -join ' '
    $global:RollbackTestCalls += $command
    if ($command -like 'sts get-caller-identity*') {
        return '{"Account":"559054714699","Arn":"arn:aws:sts::559054714699:assumed-role/TracePointMigrationStaging/test"}'
    }
    if ($command -like 'ecs describe-services*') {
        $global:RollbackTestServiceReads++
        $servingArn = $global:RollbackTestCurrent
        $runningCount = 1
        if ($global:RollbackTestUpdated -and $global:RollbackTestScenario -ne 'fallback') { $servingArn = $global:RollbackTestTarget }
        if ($global:RollbackTestUpdated -and $global:RollbackTestScenario -eq 'unhealthy') { $runningCount = 0 }
        return (@{ services = @(@{ taskDefinition = $servingArn; desiredCount = 1; runningCount = $runningCount; pendingCount = 0; deployments = @(@{ rolloutState = 'COMPLETED' }) }) } | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($command -like 'ecs describe-task-definition*') {
        if ($command -match 'synthetic:10') { $revision = 10; $taskImage = $global:RollbackTestRepository + '@sha256:' + ('a' * 64) } else { $revision = 9; $taskImage = $global:RollbackTestImage }
        return (@{ taskDefinition = @{ family = 'tracepoint-staging'; revision = $revision; status = 'ACTIVE'; containerDefinitions = @(@{ name = 'tracepoint'; image = $taskImage }) } } | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($command -like 'ecr describe-images*') {
        if ($command -notmatch 'imageDigest=(sha256:[0-9a-f]{64})') { throw 'Rollback image lookup must be by digest.' }
        return (@{ imageDetails = @(@{ imageDigest = $Matches[1] }) } | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($command -like 'ecr describe-image-scan-findings*') {
        if ($command -match 'imageDigest=([^ ]+)') { $global:RollbackTestScanDigests += $Matches[1] }
        return (@{ imageScanStatus = @{ status = 'COMPLETE' }; imageScanFindings = @{ findingSeverityCounts = @{} }; imageId = @{ imageDigest = $global:RollbackTestImageDigest } } | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($command -like 'ecs update-service*') {
        if ($global:RollbackTestScenario -eq 'update_error') { $global:LASTEXITCODE = 1; return '{}' }
        $global:RollbackTestUpdated = $true
        return '{"service":{}}'
    }
    if ($command -like 'ecs wait*') {
        if ($global:RollbackTestScenario -eq 'wait_error') { $global:LASTEXITCODE = 1 }
        return
    }
    if ($command -like 'ecs list-tasks*') { return '{"taskArns":["arn:aws:ecs:us-east-1:559054714699:task/tracepoint-staging/mock"]}' }
    if ($command -like 'ecs describe-tasks*') {
        $digest = $global:RollbackTestImageDigest
        if ($global:RollbackTestScenario -eq 'digest_mismatch') { $digest = 'sha256:' + ('1' * 64) }
        return (@{ failures = @(); tasks = @(@{ lastStatus = 'RUNNING'; taskDefinitionArn = $global:RollbackTestTarget; containers = @(@{ name = 'tracepoint'; image = $global:RollbackTestImage; imageDigest = $digest }) }) } | ConvertTo-Json -Depth 8 -Compress)
    }
    throw 'Unexpected AWS call in local rollback contract test.'
}

$savedRegion = $env:AWS_REGION
$savedDefaultRegion = $env:AWS_DEFAULT_REGION
try {
    # Read-only validation of a digest-pinned rollback revision.
    $global:RollbackTestImage = $script:RollbackImage
    $global:RollbackTestScanDigests = @()
    $global:RollbackTestCalls = @()
    & $script:RollbackHelper -TaskDefinitionArn $script:RollbackTarget -ExpectedImageDigest $script:RollbackImageDigest
    if ($global:RollbackTestScanDigests.Count -ne 1 -or $global:RollbackTestScanDigests[0] -cne $script:RollbackImageDigest) { throw 'The rollback image was not scanned under its exact digest.' }
    if ($global:RollbackTestCalls -match 'ecs update-service') { throw 'Read-only validation unexpectedly updated the ECS service.' }

    # Mutable tags, other repositories, accounts or regions, and a digest other than the captured one are refused
    # after the task definitions are read and before any scan query.
    $notPinned = 'Rollback image must be a digest-pinned tracepoint-staging artifact.'
    $unsafe = @(
        @{ image = $script:RollbackRepository + ':latest'; message = $notPinned },
        @{ image = $script:RollbackRepository + ':' + ('b' * 40) + '-aws-native-staging'; message = $notPinned },
        @{ image = '559054714699.dkr.ecr.us-east-1.amazonaws.com/tracepoint-production@' + $script:RollbackImageDigest; message = $notPinned },
        @{ image = '999999999999.dkr.ecr.us-east-1.amazonaws.com/tracepoint-staging@' + $script:RollbackImageDigest; message = $notPinned },
        @{ image = '559054714699.dkr.ecr.us-west-2.amazonaws.com/tracepoint-staging@' + $script:RollbackImageDigest; message = $notPinned },
        # PowerShell -match is case-insensitive, so an uppercase digest is refused by the digest comparison instead.
        @{ image = $script:RollbackRepository + '@sha256:' + ('A' * 64); message = 'Rollback image digest does not match the pre-rollout task definition.' },
        @{ image = $script:RollbackRepository + '@sha256:' + ('2' * 64); message = 'Rollback image digest does not match the pre-rollout task definition.' }
    )
    foreach ($case in $unsafe) {
        $global:RollbackTestImage = $case.image
        $global:RollbackTestScanDigests = @()
        $global:RollbackTestCalls = @()
        $rejectionMessage = $null
        try { & $script:RollbackHelper -TaskDefinitionArn $script:RollbackTarget -ExpectedImageDigest $script:RollbackImageDigest } catch { $rejectionMessage = $_.Exception.Message }
        if ($rejectionMessage -cne $case.message) { throw "Unsafe rollback image '$($case.image)' was not refused as expected (got: $rejectionMessage)." }
        if ($global:RollbackTestScanDigests.Count -ne 0) { throw 'An unsafe image reached the ECR scan query.' }
        if (@($global:RollbackTestCalls | Where-Object { $_ -like 'ecs describe-task-definition*' }).Count -ne 2) { throw 'Unsafe reference was rejected before both task definitions had been inspected.' }
    }

    $executeCases = @(
        @{ name = 'intended revision'; expectedError = $null },
        @{ name = 'fallback to prior revision'; scenario = 'fallback'; expectedError = 'Rollback stabilized on an unexpected task definition.' },
        @{ name = 'unhealthy service'; scenario = 'unhealthy'; expectedError = 'Requested rollback service is not healthy and stable.' },
        @{ name = 'update error'; scenario = 'update_error'; expectedError = 'Rollback metadata query failed.' },
        @{ name = 'wait error'; scenario = 'wait_error'; expectedError = 'Rollback failed to stabilize.' },
        @{ name = 'image digest mismatch'; scenario = 'digest_mismatch'; expectedError = 'Running rollback image does not match the scanned image digest.' }
    )
    foreach ($case in $executeCases) {
        $global:RollbackTestScenario = if ($case.ContainsKey('scenario')) { $case['scenario'] } else { 'execute_success' }
        $global:RollbackTestImage = $script:RollbackImage
        $global:RollbackTestScanDigests = @()
        $global:RollbackTestCalls = @()
        $global:RollbackTestServiceReads = 0
        $global:RollbackTestRuntimeCalls = 0
        $global:RollbackTestUpdated = $false
        $executionError = $null
        try { & $script:RollbackExecutable -TaskDefinitionArn $script:RollbackTarget -ExpectedImageDigest $script:RollbackImageDigest -Execute } catch { $executionError = $_.Exception.Message }
        if ($null -eq $case.expectedError) {
            if ($executionError) { throw "Execute path rejected the intended revision: $executionError" }
            if ($global:RollbackTestServiceReads -ne 3 -or $global:RollbackTestRuntimeCalls -ne 1) { throw 'Successful execute path did not verify the requested revision after stabilization and health checks.' }
            if (-not ($global:RollbackTestCalls -match 'ecs update-service') -or -not ($global:RollbackTestCalls -match 'ecs wait services-stable') -or -not ($global:RollbackTestCalls -match 'ecs describe-tasks')) { throw 'Successful execute path skipped an expected mocked ECS operation.' }
        } else {
            if ($executionError -cne $case.expectedError) { throw "Execute path failed the $($case.name) case with an unexpected result: $executionError" }
            if ($global:RollbackTestRuntimeCalls -ne 0) { throw "Health validation ran after the $($case.name) failure." }
        }
        if ($global:RollbackTestScenario -eq 'update_error' -and $global:RollbackTestUpdated) { throw 'Injected update failure still mutated the mock service.' }
    }
    Write-Host 'Passed rollback helper checks: digest-pinned revision, seven unsafe references, intended Execute revision, wrong-revision fallback, unhealthy service, update/wait errors, and running digest mismatch. All AWS calls were mocked.'
    $global:LASTEXITCODE = 0
} finally {
    Remove-Item Function:/aws.exe -ErrorAction SilentlyContinue
    $resolvedTemp = [IO.Path]::GetFullPath($script:RollbackTemp)
    if ([IO.Path]::GetDirectoryName($resolvedTemp).TrimEnd('\') -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or [IO.Path]::GetFileName($resolvedTemp) -notlike 'tracepoint-rollback-helper-test-*') { throw 'Rollback test cleanup boundary failed.' }
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    if ($null -eq $savedRegion) { Remove-Item Env:AWS_REGION -ErrorAction SilentlyContinue } else { $env:AWS_REGION = $savedRegion }
    if ($null -eq $savedDefaultRegion) { Remove-Item Env:AWS_DEFAULT_REGION -ErrorAction SilentlyContinue } else { $env:AWS_DEFAULT_REGION = $savedDefaultRegion }
}
